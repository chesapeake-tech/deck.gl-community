// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, type Effect, type MapViewState} from '@deck.gl/core';
import {CORTAOEffect} from '@deck.gl-community/experimental';
import {luma} from '@luma.gl/core';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {getStandaloneExampleContainer} from '../../mount-example';
import {getScene, SCENES, type SceneId} from '../ambient-occlusion/scenes';
import {createMovingLayers} from './moving-objects';
import {
  TemporalUpscaleEffect,
  type TemporalDebugView,
  type TemporalFrame
} from './temporal-upscale-effect';

/** The settings of the demo. The panel and the URL parameters set them. */
type Settings = {
  scene: SceneId;
  motion: boolean;
  objvel: boolean;
  kernel?: number;
  responsiveness?: number;
  /** Scale of the scene buffers: 1, 0.75 or 0.5. */
  scale: number;
  /** Temporal anti-aliasing at the render size. */
  taa: boolean;
  /** Temporal upscaling to the output size. */
  upscale: boolean;
  /** Sharpening strength, 0 to 1. */
  sharpness: number;
  /** Debug view of the temporal pass. */
  debug: TemporalDebugView;
  /** CORTAO ambient occlusion. */
  ao: boolean;
  /** Show the occlusion only. */
  showAO: boolean;
  /** A new CORTAO noise pattern each frame, for the temporal pass to average. */
  aoNoise: boolean;
  /** Slow camera rotation, in degrees per second. 0 stops the camera. */
  orbit: number;
  /**
   * Projection jitter without a temporal pass. A script averages such frames to get a
   * supersampled reference image. URL parameter only.
   */
  forceJitter: boolean;
};

const parameters = new URLSearchParams(location.search);
const flag = (name: string, fallback: boolean) =>
  parameters.has(name) ? parameters.get(name) !== '0' : fallback;
const number = (name: string, fallback: number) =>
  parameters.has(name) && !Number.isNaN(Number(parameters.get(name)))
    ? Number(parameters.get(name))
    : fallback;

/** Empty or invalid inputs leave the library default in effect. */
function getOptionalNumber(value: string | null, min: number, max: number): number | undefined {
  if (value === null || value.trim() === '' || !Number.isFinite(Number(value))) return undefined;
  return Math.max(min, Math.min(max, Number(value)));
}

const settings: Settings = {
  motion: parameters.get('motion') === '1',
  objvel: flag('objvel', true),
  kernel: getOptionalNumber(parameters.get('kernel'), 0.5, 1),
  responsiveness: getOptionalNumber(parameters.get('resp'), 0, 1),
  scene: getScene(parameters.get('scene')).id,
  scale: number('scale', 0.5),
  taa: flag('taa', true),
  upscale: flag('upscale', true),
  sharpness: number('sharpness', 0.3),
  debug: (parameters.get('debug') ?? 'none') as TemporalDebugView,
  ao: flag('ao', true),
  showAO: flag('showao', false),
  aoNoise: flag('aonoise', true),
  orbit: number('orbit', 0),
  forceJitter: flag('jitter', false)
};

const container = getStandaloneExampleContainer();
container.style.position = 'relative';

const device = await luma.createDevice({
  type: 'webgpu',
  adapters: [webgpuAdapter],
  // Deck.gl creates its post-process buffers as rgba8unorm. The layer pipelines use the canvas
  // format, so the canvas uses the same format.
  createCanvasContext: {
    container,
    useDevicePixels: false,
    colorFormat: 'rgba8unorm',
    alphaMode: 'premultiplied'
  }
});

const motionEpoch = performance.now();
let frozenMotionTime = getOptionalNumber(parameters.get('motiontime'), -Infinity, Infinity) ?? null;

/** Returns the frozen scene time or elapsed wall-clock seconds. */
function getMotionTime(): number {
  return frozenMotionTime ?? (performance.now() - motionEpoch) / 1000;
}

/** Freezes motion at a time in seconds; null resumes the wall clock. */
function setMotionTime(time: number | null): void {
  if (time !== null && !Number.isFinite(time))
    throw new Error('Motion time must be finite or null');
  frozenMotionTime = time;
  updateMotion();
}

let scene = getScene(settings.scene);
let viewState: MapViewState = {...scene.viewState};
let isReady = false;
let generation = 0;
let frameCount = 0;
let lastFrame: TemporalFrame | null = null;
/** The times of the last frames, in milliseconds. */
const frameTimes: number[] = [];
let lastFrameTime = 0;

const cortao = new CORTAOEffect({});
const temporal = new TemporalUpscaleEffect({
  onFrame: frame => {
    lastFrame = frame;
    // A new noise pattern each frame lets the temporal pass average the grain of the occlusion.
    const isAccumulating = settings.taa || settings.upscale;
    cortao.setProps({
      randomSeed: frame && isAccumulating && settings.aoNoise ? frame.frameIndex : 0
    });
  }
});

/** Tests whether the temporal pass accumulates frames. */
const isTemporal = () => settings.taa || settings.upscale;

function getEffects(): Effect[] {
  return [...(scene.lighting ? [scene.lighting] : []), ...(settings.ao ? [cortao] : []), temporal];
}

function createLayers() {
  const current = ++generation;
  isReady = false;
  return scene.createLayers(() => {
    if (current === generation) {
      isReady = true;
    }
  });
}

/** The deck.gl props that depend on the settings. */
function getSettingsProps() {
  cortao.setProps({showOcclusion: settings.showAO});
  temporal.setProps({
    antialiasing: settings.taa,
    upscaling: settings.upscale,
    sharpness: settings.sharpness,
    kernelSharpness: settings.kernel,
    responsiveness: settings.responsiveness,
    debugView: settings.debug
  });
  return {
    effects: getEffects(),
    // The opt-in temporal inputs of the local deck.gl build.
    _temporal: {
      jitter: isTemporal() || settings.forceJitter,
      velocity: true,
      objectVelocity: settings.objvel,
      renderScale: settings.scale
    },
    // The accumulation needs new frames when the camera is still.
    _animate: true
  };
}

const deck = new Deck<MapView>({
  parent: container as HTMLDivElement,
  device,
  views: new MapView({controller: true}),
  viewState,
  onViewStateChange: ({viewState: next}) => {
    viewState = next as MapViewState;
    deck.setProps({viewState});
  },
  onAfterRender: () => {
    frameCount++;
    const now = performance.now();
    if (lastFrameTime) {
      frameTimes.push(now - lastFrameTime);
      if (frameTimes.length > 240) {
        frameTimes.shift();
      }
    }
    lastFrameTime = now;
    if (pendingCapture) {
      const resolve = pendingCapture;
      pendingCapture = null;
      // The microtask runs after deck.gl submits the frame, and before the browser presents it.
      queueMicrotask(() => resolve(captureCanvas()));
    }
  },
  layers: [],
  ...(getSettingsProps() as object)
});
let sceneLayers = createLayers();
function updateMotion(): void {
  deck.setProps({
    layers: [
      ...sceneLayers,
      ...(settings.motion ? createMovingLayers(scene, getMotionTime(), settings.objvel) : [])
    ]
  });
}
updateMotion();

function applySettings(changes: Partial<Settings> = {}): void {
  const previousScene = settings.scene;
  Object.assign(settings, changes);
  if (settings.scene !== previousScene) {
    scene = getScene(settings.scene);
    viewState = {...scene.viewState};
    sceneLayers = createLayers();
    deck.setProps({viewState});
  }
  updateMotion();
  deck.setProps(getSettingsProps() as object);
  updatePanel();
  const url = new URL(location.href);
  for (const [name, value] of Object.entries({
    motion: Number(settings.motion),
    objvel: Number(settings.objvel),
    kernel: settings.kernel,
    resp: settings.responsiveness,
    scene: settings.scene,
    scale: settings.scale,
    taa: Number(settings.taa),
    upscale: Number(settings.upscale),
    sharpness: settings.sharpness,
    debug: settings.debug,
    ao: Number(settings.ao),
    showao: Number(settings.showAO),
    aonoise: Number(settings.aoNoise),
    orbit: settings.orbit
  })) {
    if (value === undefined) url.searchParams.delete(name);
    else url.searchParams.set(name, String(value));
  }
  history.replaceState(null, '', url);
}

function setViewState(next: MapViewState): void {
  viewState = {...next};
  deck.setProps({viewState});
}

// Slow camera rotation.
let lastOrbitTime = performance.now();
function orbit(now: number): void {
  const seconds = (now - lastOrbitTime) / 1000;
  lastOrbitTime = now;
  if (settings.orbit !== 0) {
    setViewState({...viewState, bearing: (viewState.bearing ?? 0) + settings.orbit * seconds});
  }
  if (settings.motion && frozenMotionTime === null) updateMotion();
  requestAnimationFrame(orbit);
}
requestAnimationFrame(orbit);

// The settings panel.
const panel = document.createElement('div');
panel.style.cssText =
  'position:absolute;top:12px;left:12px;z-index:2;padding:8px 12px;border-radius:6px;' +
  'background:rgba(255,255,255,0.92);font:13px sans-serif;line-height:1.8;max-width:300px';
panel.innerHTML = `
  <label>Scene <select name="scene">${SCENES.map(
    item => `<option value="${item.id}">${item.label}</option>`
  ).join('')}</select></label><br>
  <label>Render scale <select name="scale">
    <option value="1">1.0</option><option value="0.75">0.75</option><option value="0.5">0.5</option>
  </select></label><br>
  <label><input type="checkbox" name="taa"> Temporal anti-aliasing (TAA)</label><br>
  <label><input type="checkbox" name="upscale"> Temporal upscaler</label><br>
  <label>Sharpening <input type="range" name="sharpness" min="0" max="1" step="0.05">
    <span name="sharpnessValue"></span></label><br>
  <label><input type="checkbox" name="motion"> Moving objects</label><br>
  <label><input type="checkbox" name="objvel"> Per-object velocity</label><br>
  <label>Kernel sharpness <input type="number" name="kernel" min="0.5" max="1" step="0.05"
    placeholder="Default" style="width:75px"></label><br>
  <label>Responsiveness <input type="number" name="responsiveness" min="0" max="1" step="0.05"
    placeholder="Default" style="width:75px"></label><br>
  <label><input type="checkbox" name="velocity"> Show velocity</label><br>
  <label><input type="checkbox" name="ao"> Ambient occlusion (CORTAO)</label><br>
  <label><input type="checkbox" name="showAO"> Show occlusion only</label><br>
  <label><input type="checkbox" name="aoNoise"> New occlusion noise each frame</label><br>
  <label><input type="checkbox" name="orbit"> Rotate the camera slowly</label><br>
  <div name="stats" style="color:#555;line-height:1.3;white-space:pre"></div>`;
const get = <T extends Element>(name: string) => panel.querySelector(`[name="${name}"]`) as T;
const controls = {
  motion: get<HTMLInputElement>('motion'),
  objvel: get<HTMLInputElement>('objvel'),
  kernel: get<HTMLInputElement>('kernel'),
  responsiveness: get<HTMLInputElement>('responsiveness'),
  scene: get<HTMLSelectElement>('scene'),
  scale: get<HTMLSelectElement>('scale'),
  taa: get<HTMLInputElement>('taa'),
  upscale: get<HTMLInputElement>('upscale'),
  sharpness: get<HTMLInputElement>('sharpness'),
  sharpnessValue: get<HTMLSpanElement>('sharpnessValue'),
  velocity: get<HTMLInputElement>('velocity'),
  ao: get<HTMLInputElement>('ao'),
  showAO: get<HTMLInputElement>('showAO'),
  aoNoise: get<HTMLInputElement>('aoNoise'),
  orbit: get<HTMLInputElement>('orbit'),
  stats: get<HTMLDivElement>('stats')
};
if (flag('controls', true)) {
  container.append(panel);
}

function updatePanel(): void {
  controls.motion.checked = settings.motion;
  controls.objvel.checked = settings.objvel;
  controls.kernel.value = settings.kernel === undefined ? '' : String(settings.kernel);
  controls.responsiveness.value =
    settings.responsiveness === undefined ? '' : String(settings.responsiveness);
  controls.scene.value = settings.scene;
  controls.scale.value = String(settings.scale);
  controls.taa.checked = settings.taa;
  controls.upscale.checked = settings.upscale;
  controls.sharpness.value = String(settings.sharpness);
  controls.sharpnessValue.textContent = settings.sharpness.toFixed(2);
  controls.velocity.checked = settings.debug === 'velocity';
  controls.ao.checked = settings.ao;
  controls.showAO.checked = settings.showAO;
  controls.aoNoise.checked = settings.aoNoise;
  controls.orbit.checked = settings.orbit !== 0;
}
updatePanel();
controls.motion.onchange = () => applySettings({motion: controls.motion.checked});
controls.objvel.onchange = () => applySettings({objvel: controls.objvel.checked});
controls.kernel.onchange = () =>
  applySettings({kernel: getOptionalNumber(controls.kernel.value, 0.5, 1)});
controls.responsiveness.onchange = () =>
  applySettings({responsiveness: getOptionalNumber(controls.responsiveness.value, 0, 1)});
controls.scene.onchange = () => applySettings({scene: controls.scene.value as SceneId});
controls.scale.onchange = () => applySettings({scale: Number(controls.scale.value)});
controls.taa.onchange = () => applySettings({taa: controls.taa.checked});
controls.upscale.onchange = () => applySettings({upscale: controls.upscale.checked});
controls.sharpness.oninput = () => applySettings({sharpness: Number(controls.sharpness.value)});
controls.velocity.onchange = () =>
  applySettings({debug: controls.velocity.checked ? 'velocity' : 'none'});
controls.ao.onchange = () => applySettings({ao: controls.ao.checked});
controls.showAO.onchange = () => applySettings({showAO: controls.showAO.checked});
controls.aoNoise.onchange = () => applySettings({aoNoise: controls.aoNoise.checked});
controls.orbit.onchange = () => applySettings({orbit: controls.orbit.checked ? 3 : 0});

/** The mean frame time of the last frames, in milliseconds. */
function getFrameTime(count = 120): number {
  const times = frameTimes.slice(-count);
  return times.length ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
}

setInterval(() => {
  const frameTime = getFrameTime(60);
  const size = lastFrame
    ? `${lastFrame.renderSize.join(' x ')} -> ${lastFrame.outputSize.join(' x ')}`
    : '-';
  controls.stats.textContent =
    `Frame: ${frameTime.toFixed(1)} ms (${frameTime ? (1000 / frameTime).toFixed(0) : '-'} fps)\n` +
    `Render -> output: ${size}\n` +
    `Jitter phases: ${lastFrame?.phaseCount ?? '-'}`;
}, 500);

/** Resolves the capture of the next rendered frame. */
let pendingCapture: ((dataUrl: string) => void) | null = null;

/** Copies the WebGPU canvas over a white page, as the browser composites it. Returns a PNG. */
function captureCanvas(): string {
  const source = deck.getCanvas()!;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext('2d')!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, copy.width, copy.height);
  context.drawImage(source, 0, 0);
  return copy.toDataURL('image/png');
}

/**
 * Moves the camera along a path, one pose for each rendered frame. Returns a PNG of the frame of
 * the last pose. An empty path captures the next frame.
 */
async function runPath(poses: MapViewState[]): Promise<string> {
  for (const pose of poses.slice(0, -1)) {
    setViewState(pose);
    await renderFrames(1);
  }
  if (poses.length) {
    setViewState(poses[poses.length - 1]);
  }
  return new Promise<string>(resolve => {
    pendingCapture = resolve;
  });
}

/** Resolves after `count` more rendered frames. */
function renderFrames(count: number): Promise<void> {
  const end = frameCount + count;
  return new Promise(resolve => {
    const test = () => (frameCount >= end ? resolve() : requestAnimationFrame(test));
    test();
  });
}

/**
 * Measures the mean time of a frame, in milliseconds, as throughput: it renders `count` frames
 * and then waits until the GPU queue is empty. Run it in a browser without a frame rate limit.
 * With a frame rate limit, the result is the display interval.
 */
async function measureFrames(count: number): Promise<number> {
  const {queue} = device.handle as {queue: {onSubmittedWorkDone: () => Promise<void>}};
  await queue.onSubmittedWorkDone();
  const start = performance.now();
  await renderFrames(count);
  await queue.onSubmittedWorkDone();
  return (performance.now() - start) / count;
}

// Lets scripts set the state and read the frame statistics.
(globalThis as Record<string, unknown>).temporalDemo = {
  deck,
  settings,
  applySettings,
  setViewState,
  setMotionTime,
  getMotionTime,
  renderFrames,
  runPath,
  measureFrames,
  getFrameTime,
  clearFrameTimes: () => {
    frameTimes.length = 0;
  },
  get viewState() {
    return viewState;
  },
  get frameCount() {
    return frameCount;
  },
  get lastFrame() {
    return lastFrame;
  },
  get ready() {
    return isReady;
  }
};
