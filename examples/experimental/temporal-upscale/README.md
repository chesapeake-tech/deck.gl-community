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
| Moving objects | `motion=1` | Adds 12 moving cubes and four translating poles. Off by default. |
| Per-object velocity | `objvel` | Enables the object velocity pass and mesh motion vectors. Defaults to 1. |
| Frozen motion time | `motiontime` | Starts motion at a fixed time in seconds. URL or script only. |
| Kernel sharpness | `kernel` | Reconstruction kernel sharpness, 0.5 to 1. Blank uses the library default (0.85). |
| Responsiveness | `resp` | History responsiveness, 0 to 1. Blank uses the library default (0.5). |
| Show velocity | `debug=velocity` | Red and green: motion in pixels. Blue: no valid history. |
| Ambient occlusion | `ao` | The CORTAO effect. |
| Show occlusion only | `showao` | The occlusion as a gray image. |
| New occlusion noise each frame | `aonoise` | Lets the temporal pass average the grain. |
| Rotate the camera slowly | `orbit` | Degrees per second. |

With both temporal modes off, the example makes a bilinear copy of the scene buffer. This is the
baseline. `controls=0` hides the panel.

## Moving objects and capture scripts

Use `?scene=city&motion=1&objvel=1&debug=velocity` to inspect object motion vectors.
The cubes animate `getPosition`. The poles animate their layer's `modelMatrix` translation.
City cubes measure 30 m on each side. Poles measure 2 m × 2 m × 120 m.
The overlay follows each scene's origin and scales with its default zoom. Terrain objects sit
above the canyon. Object colors stay saturated without lighting.

Positions depend only on scene time. Tracks reverse at their endpoints. Speeds target roughly
1 to 8 output pixels per frame at 60 fps, calibrated at track centers for a 1920 × 1080 default
camera. Perspective changes their apparent speed along the tracks. Check visibility and speed
in the browser, especially where buildings occlude the objects.

Start with `motion=1&motiontime=0` for a frozen scene. Scripts can then use:

```js
temporalDemo.setMotionTime(1.5); // Freeze at 1.5 seconds. The next frame shows it.
await temporalDemo.renderFrames(2);
const time = temporalDemo.getMotionTime();
temporalDemo.setMotionTime(null); // Resume elapsed wall-clock time.
```

Keep the camera still (`orbit=0`) for deterministic object captures. Resuming the wall clock
includes time spent frozen. Each target keeps separate upscaler history and intermediate buffers.
The effect prunes unused targets after 120 render calls and frees all resources on cleanup.
Older deck.gl builds without a target id share one fallback state.

## Limits

- Instance orientation and scale changes have no motion vectors.
- `TripsLayer`-style colour animation has no geometric motion.
- Overlapping views disable temporal inputs.
- The camera redraws each frame (`_animate`) so history converges.
