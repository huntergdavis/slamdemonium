# Car visual integration and preview

D4 implements design 10.3 and the [D1 dimensions/palette](../visual-direction.md#2-box-car-read-the-physics). The producer contract was agreed with developer 1 and the PM before implementation, including the PM's spin wrapping and `spinning`/`locked` amendments. It owns only `src/render/carVisual.ts` and `src/render/carVisualState.ts` within `src/render/`; developer 1 owns mounting it in WP6, the camera, skid marks and renderer.

Run `npm run dev` and open `/docs/design/car-preview/`. The page imports the actual car and track modules. It holds the chassis in place while feeding synthetic render state: cruise, braking, reverse, drift/handbrake, spinning rear wheels, locked rear wheels and airborne suspension. Front/rear/side/top views, steering, animation pause and the actual WP4 G action make every visual independently inspectable. Synthetic suspension motion is deliberately exaggerated; this is not a physics demonstration. DOM telemetry is throttled to 30 Hz; wheel animation runs at render rate.

## Mount and update

```ts
import { createCarVisual } from './render/carVisual';
import type { VehicleVisualState } from './render/carVisualState';

const car = createCarVisual(scene);
// In the input owner, once per sampled step (never replay the same action count):
if (input.actions.gizmos % 2) car.toggleDebug();
// In the render owner, after chassis AND wheel-state interpolation:
car.update(visualState satisfies VehicleVisualState);
// On teardown:
car.dispose();
```

`root` is the posed chassis group; `update(state)`, `setDebugVisible(boolean)`, `toggleDebug()` and `dispose()` are the complete public API. No renderer, camera, physics body or keyboard listener is created by this module. Gizmos start off. The preview uses the existing `KeyboardInput`/`InputMapper`, so G ignores editing targets, modifiers and repeat. In the game, the existing loop owns that routing. Toggle takes effect while paused using the most recently supplied state.

The function mounts a chassis group and a separate world-space gizmo group into the scene; disposal removes both. Do not reparent/transform the chassis independently after update, or add another transform to the scene: supplied positions are world coordinates. Materials and geometries are shared within one car, owned by that car, and disposed once. Update creates no new vectors, colors, arrays or scene objects and never mutates producer state. Flags are carried for WP6 skid marks and WP8 telemetry; the producer's absolute spin angle already represents their motion effect.

## State contract

The authoritative TypeScript declarations are [carVisualState.ts](../../../src/render/carVisualState.ts). All components must be finite; quaternion must be unit length. Plain records are accepted; no Jolt or Three.js type is required. Producer records can be reused between frames. Units: meters, seconds, radians, Newtons; +X right, +Y up, -Z forward.

| Field | Producer responsibility |
| --- | --- |
| `position`, `rotation` | Interpolated geometric chassis center and orientation, with no visual yaw filter. |
| `velocityWorld` | World velocity in m/s; gizmo uses X/Z projection, ignoring vertical speed. |
| `brake01`, `handbrake01` | Filtered actual applied braking in [0,1]. Reverse throttle alone supplies zero brake. Rear strip uses their maximum, clamped to [0,1], and linear RGB interpolation between D1 idle/brake colors. |
| `wheels` | Exactly four entries, FL / FR / RL / RR. |
| Wheel `centerLocal` | Interpolated center including suspension displacement, in chassis space. Nominal X/Z ±0.8/±1.3; Y comes from suspension, not mount Y. |
| Wheel `steerAngle` | Radians about local +Y, positive left. Front wheels use it directly; rear pivots remain at zero. |
| Wheel `spinAngle` | Render-ready rotation about the steered local +X axle, wrapped into [0,2π). Forward (-Z) motion decreases angle. Locked wheels hold the supplied angle; spinning wheels advance faster. |
| Wheel `grounded`, `spinning`, `locked` | Actual producer flags. Airborne wheels hide force gizmos; rendering does not recompute spin from flags or infer contact. |
| Wheel `contactPointWorld` | World contact point. Can retain stale finite values while airborne; hidden in that case. |
| Wheel `tireForceWorld` | Combined lateral/longitudinal tire force in world Newtons, excluding spring force. Do not supply body-local force or a per-step impulse. |

Keep physics spin bounded each step. For smooth interpolation across 0/2π, retain the **signed angular advance for the current step** and evaluate `wrap(previousAngle + alpha * stepAdvance)`; interpolating two wrapped endpoints numerically would make the wheel reverse almost a full turn at the seam. Do not reconstruct the advance with shortest-arc interpolation when wheelspin can exceed π per step. `wrap(a) = ((a % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI)`. Renderer also wraps defensively and never integrates time, so pause/slow motion/respawn have no separate visual clock.

## Visual and debug behavior

Chassis is 1.8 × 1 × 4 m. Chevron centerlines, nose continuation and rear strip match D1 exactly. Each 0.24 × 0.68 × 0.68 m wheel has a steering pivot and a child spin pivot. One 0.05 × 0.34 m witness stripe runs from hub to edge, 3 mm outside each outer X face. Body/wheels cast and receive shadows; the host enables shadow maps. Marks and lights are unlit, with tone mapping disabled to preserve their bright sRGB identity; no bloom or external textures.

Ground gizmos retain world-space coordinates but use depth-test-disabled overlay materials to stay visible over the car, paint and shadows. H is cream with a geometric H label, 4.6 m long at Y=0.045 m. V is cyan with a V label, length `clamp(horizontalSpeed * 0.12, 0.75, 7)` m at Y=0.035 m. Their directions share the same projected chassis origin, so the angle is the slide angle. Both have arrowheads and tail dots. V hides below 0.25 m/s; H hides if the nose is nearly vertical and has no stable ground projection. Arrow length is a readability aid, not a speed gauge.

Amber tire-force vectors start 0.06 m above the supplied contact point, follow the full 3D world force, and use 1 m / 2 kN, capped at 4 m. Force below 1 N or an airborne wheel hides the vector; there is no fake minimum force length. Debug scales are fixed visual aids, not new tuning parameters. All debug geometry, vectors and materials are allocated at mount. Debug updates are skipped when hidden.

## Verification

With the dev server running on port 4185, run `node docs/design/car-preview/verify.mjs`. Optional first argument is the full demo URL; optional second argument is the screenshot output directory (default `/tmp/slamdemonium-car-preview`). `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a locally installed Chromium. It checks brake/reverse colors, locked/spinning wheels, bounded angles, airborne force hiding and actual G focus/repeat handling, and saves front, rear-braking and top-drift screenshots. Install the project's Playwright Chromium first if absent.

`npx vitest run tests/car-visual.test.ts` checks exact dimensions and chevron endpoints, suspension and steering separation, negative forward spin, wrap continuity, producer-controlled lock/spin, actual-brake colors, world-space/degenerate gizmos, stable object identity and disposal of every owned resource exactly once. Browser review uses the live demo with software WebGL where hardware rendering is unavailable; this is correctness evidence, not a target-device performance benchmark.
