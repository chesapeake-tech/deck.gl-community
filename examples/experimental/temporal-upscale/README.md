# Temporal upscaling (local prototype)

This example joins two local prototypes:

- the luma.gl `TemporalUpscaler` (an FSR 2-style temporal upscaler, without a neural network);
- the deck.gl `_temporal` prop (projection jitter, render scale and a velocity buffer).

It draws the test scenes of the ambient occlusion example at a reduced size and upscales them to
the canvas size. It needs WebGPU.

## How to run it

The example builds deck.gl and the upscaler from local source, through Vite aliases. Set the two
paths:

```bash
DECK_GL_SOURCE=<deck.gl checkout with the _temporal prop> \
LUMA_GL_SOURCE=<luma.gl checkout with effects/temporal-upscale> \
yarn vite --config ./vite.config.mjs --port 5473
```

The other luma.gl packages come from `node_modules`. The upscaler imports `@luma.gl/core` only.

## Controls

| Control | URL parameter | Function |
| --- | --- | --- |
| Scene | `scene` | The test scene. |
| Render scale | `scale` | Size of the scene buffers: 1, 0.75 or 0.5. |
| Temporal anti-aliasing | `taa` | Accumulates frames at the render size. |
| Temporal upscaler | `upscale` | Accumulates frames at the output size. It includes anti-aliasing. |
| Sharpening | `sharpness` | Strength of the contrast-adaptive sharpening, 0 to 1. |
| Show velocity | `debug=velocity` | Red and green: motion in pixels. Blue: no valid history. |
| Ambient occlusion | `ao` | The CORTAO effect. |
| Show occlusion only | `showao` | The occlusion as a gray image. |
| New occlusion noise each frame | `aonoise` | Lets the temporal pass average the grain. |
| Rotate the camera slowly | `orbit` | Degrees per second. |

With both temporal modes off, the example makes a bilinear copy of the scene buffer. This is the
baseline. `controls=0` hides the panel.

## Limits

- Camera motion only. Moving objects have no motion vectors.
- The first viewport only.
- The camera redraws each frame (`_animate`), so that the history converges.
