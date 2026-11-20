// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  log,
  type Effect,
  type EffectContext,
  type PostRenderOptions,
  type PreRenderOptions
} from '@deck.gl/core';
import type {Device, Framebuffer, Texture} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';
// The luma.gl temporal upscaler is local source. See `vite.config.mjs`.
import {TemporalUpscaler} from 'luma-temporal-upscale';

/**
 * The temporal inputs of one frame. Deck.gl supplies them when its `_temporal` prop is set.
 * This type mirrors the `TemporalFrame` type of the local deck.gl build.
 */
export type TemporalFrame = {
  frameIndex: number;
  renderScale: number;
  renderSize: [number, number];
  outputSize: [number, number];
  jitter: [number, number];
  jitterClip: [number, number];
  phaseCount: number;
  depthTexture: Texture | null;
  velocityTexture: Texture | null;
  reset: boolean;
};

type TemporalOptions = {temporal?: TemporalFrame};

/** The debug views of the effect. */
export type TemporalDebugView = 'none' | 'velocity' | 'disocclusion' | 'history-weight';

/** Props of {@link TemporalUpscaleEffect}. */
export type TemporalUpscaleEffectProps = {
  id?: string;
  /** Temporal accumulation at the render resolution (temporal anti-aliasing). */
  antialiasing?: boolean;
  /** Temporal accumulation at the output resolution. It includes anti-aliasing. */
  upscaling?: boolean;
  /** Sharpening strength, from 0 (off) to 1. */
  sharpness?: number;
  /** Debug view. */
  debugView?: TemporalDebugView;
  /** Called at the start of each frame with the temporal inputs, or `null` without them. */
  onFrame?: (frame: TemporalFrame | null) => void;
};

const BLIT_WGSL = /* wgsl */ `\
@group(0) @binding(auto) var colorTexture: texture_2d<f32>;
@group(0) @binding(auto) var colorTextureSampler: sampler;

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4f {
  return textureSampleLevel(colorTexture, colorTextureSampler, vec2f(inputs.uv.x, 1.0 - inputs.uv.y), 0.0);
}
`;

/**
 * The last post-process effect of the demo. It draws the scene buffers of deck.gl to the canvas.
 *
 * - Both modes off: a bilinear copy. This is the baseline without a temporal pass.
 * - `antialiasing`: temporal accumulation at the render size, then a bilinear copy.
 * - `upscaling`: temporal accumulation at the output size.
 */
export class TemporalUpscaleEffect implements Effect {
  id: string;
  props: Required<Omit<TemporalUpscaleEffectProps, 'onFrame'>> &
    Pick<TemporalUpscaleEffectProps, 'onFrame'>;
  readonly useInPicking = false;

  private device: Device | null = null;
  private blit: ClipSpace | null = null;
  private upscaler: TemporalUpscaler | null = null;
  private upscalerSizes = '';
  /** The target of the accumulation at the render size, when the output is larger. */
  private intermediate: Framebuffer | null = null;
  private resetHistory = true;

  constructor(props: TemporalUpscaleEffectProps = {}) {
    this.props = {
      id: 'temporal-upscale',
      antialiasing: true,
      upscaling: true,
      sharpness: 0.3,
      debugView: 'none',
      ...props
    };
    this.id = this.props.id;
  }

  setup({device}: EffectContext): void {
    this.device = device;
    this.blit = new ClipSpace(device, {
      id: `${this.id}-blit`,
      source: BLIT_WGSL,
      parameters: {depthWriteEnabled: false, depthCompare: 'always'}
    });
    if (!TemporalUpscaler.isSupported(device)) {
      log.warn('TemporalUpscaleEffect: the temporal pass needs WebGPU. It makes a plain copy.')();
    }
  }

  setProps(props: TemporalUpscaleEffectProps): void {
    const previous = this.props;
    this.props = {...this.props, ...props};
    if (
      previous.antialiasing !== this.props.antialiasing ||
      previous.upscaling !== this.props.upscaling
    ) {
      this.resetHistory = true;
    }
  }

  preRender(options: PreRenderOptions): void {
    this.props.onFrame?.((options as PreRenderOptions & TemporalOptions).temporal ?? null);
  }

  postRender(options: PostRenderOptions & TemporalOptions): Framebuffer | null {
    const device = this.device!;
    const output = (options.target !== undefined ? options.target : options.swapBuffer) ?? null;
    const colorTexture = options.inputBuffer.colorAttachments[0].texture;
    const {temporal} = options;
    const {antialiasing, upscaling, debugView} = this.props;
    const isTemporal =
      (antialiasing || upscaling || debugView !== 'none') &&
      temporal?.velocityTexture &&
      temporal.depthTexture &&
      TemporalUpscaler.isSupported(device);
    if (!isTemporal) {
      this.resetHistory = true;
      this.copy(colorTexture, output);
      return output;
    }

    const renderSize: [number, number] = [colorTexture.width, colorTexture.height];
    const targetSize: [number, number] = output
      ? [output.width, output.height]
      : temporal.outputSize;
    const isSameSize = renderSize[0] === targetSize[0] && renderSize[1] === targetSize[1];
    // Without `upscaling`, the pass accumulates at the render size.
    const accumulateSize = upscaling ? targetSize : renderSize;
    const sizes = [...renderSize, ...accumulateSize].join();
    if (!this.upscaler || this.upscalerSizes !== sizes) {
      this.upscaler?.destroy();
      this.upscaler = new TemporalUpscaler(device, {
        id: `${this.id}-upscaler`,
        renderSize,
        outputSize: accumulateSize,
        outputFormat: colorTexture.props.format
      });
      this.upscalerSizes = sizes;
    }
    const direct = upscaling || isSameSize;
    const target = direct ? output : this.getIntermediate(renderSize, colorTexture);
    this.upscaler.render({
      colorTexture,
      depthTexture: temporal.depthTexture!,
      velocityTexture: temporal.velocityTexture!,
      jitter: temporal.jitter,
      target,
      sharpness: this.props.sharpness,
      reset: temporal.reset || this.resetHistory,
      debugView,
      clear: true
    });
    this.resetHistory = false;
    if (!direct) {
      this.copy(this.intermediate!.colorAttachments[0].texture, output);
    }
    return output;
  }

  cleanup(): void {
    this.blit?.destroy();
    this.blit = null;
    this.upscaler?.destroy();
    this.upscaler = null;
    this.destroyIntermediate();
    this.device = null;
  }

  /** Draws a texture to a framebuffer with bilinear filtering. */
  private copy(texture: Texture, output: Framebuffer | null): void {
    const device = this.device!;
    const blit = this.blit!;
    blit.setBindings({colorTexture: texture});
    const renderPass = device.beginRenderPass({
      id: `${this.id}-blit`,
      framebuffer: output,
      clearColor: [0, 0, 0, 0],
      clearDepth: false,
      clearStencil: false
    });
    blit.draw(renderPass);
    renderPass.end();
  }

  private getIntermediate(size: [number, number], like: Texture): Framebuffer {
    const [width, height] = size;
    if (this.intermediate?.width !== width || this.intermediate?.height !== height) {
      this.destroyIntermediate();
      this.intermediate = this.device!.createFramebuffer({
        id: `${this.id}-intermediate`,
        width,
        height,
        colorAttachments: [
          this.device!.createTexture({
            format: like.props.format,
            width,
            height,
            sampler: {minFilter: 'linear', magFilter: 'linear'}
          })
        ]
      });
    }
    return this.intermediate;
  }

  private destroyIntermediate(): void {
    this.intermediate?.colorAttachments[0].texture.destroy();
    this.intermediate?.destroy();
    this.intermediate = null;
  }
}
