# R1: Jolt integration — use the separate single-thread WASM build

Checked 2026-09-20 against published **`jolt-physics@1.1.0`** and
**`@dimforge/rapier3d-compat@0.20.0`**. Keep Jolt for the spike. Its required APIs
work; the main hazards are ownership and accidentally importing the wrong build.
This note supports [design §4.2 and §5.3](../vertical-slice-design.md), not a G0 sign-off.
Versions came from the [Jolt registry](https://registry.npmjs.org/jolt-physics/1.1.0)
and [Rapier registry](https://registry.npmjs.org/@dimforge/rapier3d-compat/0.20.0).

## Install and boot

```sh
npm install --save-exact jolt-physics@1.1.0
```

```ts
import initJolt from 'jolt-physics/wasm';
import wasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';

async function bootPhysics() {
  return initJolt({
    locateFile: (path, prefix) => path.endsWith('.wasm') ? wasmUrl : prefix + path,
  });
}
```

`jolt-physics/wasm` is **single-thread, separate binary**. Both the bare
`jolt-physics` import and `jolt-physics/wasm-compat` are **single-thread, embedded
base64 WASM**; initialize either with `await initJolt()`. `compat` does not mean
asm.js. Only entrypoints ending in `multithread` select threads. Use none of those
for this slice; no cross-origin isolation headers are needed. The upstream README's
separate-WASM example currently imports the bare package: use `/wasm` explicitly.
[Published export map][package] · [Upstream usage][readme]

## CCD, force at a point, torque

These are the **published JS signatures**, including the activation argument that
C++ examples sometimes omit. `bodyInterface` comes from
`jolt.GetPhysicsSystem().GetBodyInterface()`; `id` identifies an added dynamic body.

```ts
creationSettings.mMotionQuality = Jolt.EMotionQuality_LinearCast; // before creation
bodyInterface.SetMotionQuality(id, Jolt.EMotionQuality_LinearCast); // or later

// Allocate these once; mutate with Set(x, y, z) each step.
const force = new Jolt.Vec3(0, 0, -1000);       // world-space newtons
const worldPoint = new Jolt.RVec3(1, 1, 0);    // world-space metres
const torque = new Jolt.Vec3(0, 100, 0);        // world-space newton metres
bodyInterface.AddForce(id, force, worldPoint, Jolt.EActivation_Activate);
bodyInterface.AddTorque(id, torque, Jolt.EActivation_Activate);
jolt.Step(1 / 120, 1);
```

Force at an offset already produces its moment about the centre of mass. Do not
add that moment again. Transform a chassis-local assist torque into world space.
These are forces, not impulses: do not multiply by `dt` before passing them in.
Jolt clears accumulated force/torque after the update. `LinearCast` addresses linear
sweeps; do not assume complete rotational CCD. Still run the prescribed 85 m/s
thin-wall test. [Published declarations][types] · [Body API][body] · [BodyInterface API][body-interface]

## Raycast: fraction to distance, then world normal

Allocate `ray = new Jolt.RRayCast()`, `raySettings = new Jolt.RayCastSettings()`,
`collector = new Jolt.CastRayClosestHitCollisionCollector()`, and the filters once:

```ts
const bpFilter = new Jolt.DefaultBroadPhaseLayerFilter(
  jolt.GetObjectVsBroadPhaseLayerFilter(), LAYER_MOVING);
const objectFilter = new Jolt.DefaultObjectLayerFilter(
  jolt.GetObjectLayerPairFilter(), LAYER_MOVING);
const bodyFilter = new Jolt.IgnoreSingleBodyFilter(chassisId);
const shapeFilter = new Jolt.ShapeFilter();
```

With `physicsSystem = jolt.GetPhysicsSystem()`, a unit direction `(dx,dy,dz)` and
positive `maxLen`, fill the caller-owned `out` record:

```ts
ray.mOrigin.Set(ox, oy, oz);
ray.mDirection.Set(dx * maxLen, dy * maxLen, dz * maxLen);
collector.Reset(); // mandatory before EVERY reused query
physicsSystem.GetNarrowPhaseQuery().CastRay(
  ray, raySettings, collector, bpFilter, objectFilter, bodyFilter, shapeFilter);
if (collector.HadHit()) {
  const hit = collector.mHit;
  out.distance = hit.mFraction * maxLen; // fraction is not metres!
  const point = ray.GetPointOnRay(hit.mFraction);
  const body = physicsSystem.GetBodyLockInterfaceNoLock().TryGetBody(hit.mBodyID);
  const normal = body.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, point);
  out.normal.x = normal.GetX();
  out.normal.y = normal.GetY();
  out.normal.z = normal.GetZ();
  // Map hit.mBodyID.GetIndexAndSequenceNumber() to our surfaceId here.
}
```

This binding's narrow-phase query uses a collector; do not copy a C++ boolean
`CastRay(ray, result)` overload that is absent here. `NoLock` is suitable for our
single-thread adapter when no step/removal runs concurrently. Ignore the chassis,
then filter suspension hits to driveable surfaces; a wall is not a wheel load.
Ray hit, point and normal above are borrowed/scratch values: copy immediately,
**do not destroy them**. [Official ray example][ray-example] · [Declarations][types]

## Ownership: distinguish owned objects from borrowed returns

| Object | Correct lifetime |
|---|---|
| Our `new Jolt.Vec3/RVec3/Quat`, ray, settings, collectors and ordinary filters | Reuse in the hot path; `Jolt.destroy(x)` when finished. Inline constructor arguments leak if their ownership is lost. |
| `Vec3.Clone()`, `RVec3.Clone()`, `Quat.Clone()`, `BodyID.Clone()` | These helpers allocate with `new`; also destroy them. |
| `Body`, world interfaces, body IDs returned by reference, collector members | Borrowed. Never independently `Jolt.destroy` them. Remove an added body with `RemoveBody(id)`, then `DestroyBody(id)`. |
| Bound `[Value]` returns such as `Body.GetPosition()`, `GetPointOnRay()`, `GetWorldSpaceSurfaceNormal()` | Shared static scratch storage per generated method. Next call can overwrite it, even for another body. Copy scalars; never destroy the scratch result. Prefer output-parameter methods for retained transforms. |
| Ref-counted shapes/settings/materials and transferred infrastructure | `AddRef` only for a reference we retain; balance with `Release`. Bodies/settings retain shapes. JoltInterface owns the three collision-layer interfaces passed in its settings; do not double-delete them. |

`ShapeSettings.Create()` also returns a reused result retaining a shape reference:
follow the upstream `shapeResult.Clear()` / explicit shape ownership pattern.
Destroy temporary `BodyCreationSettings` after body creation; destroy the
`JoltInterface` at adapter teardown. A JS wrapper becoming unreachable does not
free an owned WASM allocation. Hot reload must dispose the previous world.
[Cleanup example][cleanup] · [Clone helpers][helpers] · [Binding generator][binder]

The probed module reserves **134,217,728 bytes (128 MiB)** for its WASM heap.
A flat `HEAPU8.byteLength` therefore does **not** prove no leaks: also monitor
`Jolt.JoltInterface.prototype.sGetFreeMemory()` after warmup and repeated teardown,
plus JS heap. Memory-profiler builds are available for investigation.
[Build settings][cmake] · [Memory helper][jolt-header]

## Determinism and payload

**There is no deterministic npm entrypoint.** The pinned release's CI invokes the
default build without `CROSS_PLATFORM_DETERMINISTIC`; the underlying Jolt 5.6.0
option defaults OFF. If native/WASM cross-platform matching becomes necessary,
build from source with `./build.sh Distribution -DCROSS_PLATFORM_DETERMINISTIC=ON`.
The runtime `mDeterministicSimulation` setting is not that compiler switch.
For this slice, verify same-browser replay with fixed steps, identical creation
order and recorded inputs; do not block WP1 on the optional cross-platform goal.
[Build invocation][ci] · [Build script][build] · [Core option][core-cmake] · [IDL][idl]

Measured directly from the npm tarballs; gzip is Python `gzip.compress`, level 9,
`mtime=0`. These are individual files, not installation size or a load-time promise.

| Published file | Raw bytes | gzip-9 bytes |
|---|---:|---:|
| Jolt separate `.wasm` | 2,021,569 | 740,847 |
| Jolt separate loader `.wasm.js` | 964,712 | 135,156 |
| Jolt embedded `.wasm-compat.js` | 3,222,495 | 903,712 |
| Rapier `.wasm` | 2,021,200 | 761,373 |
| Rapier compat `rapier.mjs` (includes WASM) | 2,857,590 | 1,083,251 |

Rapier is not automatically the smaller transfer here. Compat consumers do not
also fetch the loose Rapier WASM file. [Jolt tarball][jolt-tar] · [Rapier tarball][rapier-tar]

## Vite gotchas

1. Import the **exported** WASM asset path with `?url`; a `dist/…` deep import is
   blocked by package exports. Pass the resulting URL to `locateFile`; this also
   handles hashed production assets and non-root deployment bases. Include
   `vite/client` types. Serve WASM as `application/wasm`. [Vite assets][vite]
2. Initialize asynchronously inside boot, so top-level-await target support is
   unnecessary. Initialize once, before exposing `window.__game.ready`.
3. Vite 8.3.0 production builds of both flavors emitted a `node:module` browser
   externalization warning from Emscripten's Node branch and a large-chunk warning.
   Do not add Node polyfills speculatively; verify the served browser build.
4. Dynamic-import the adapter after first paint if startup needs it. Compress on
   the static host. Embedded base64 simplifies loading but puts more data in JS.
5. `vite build` alone does not validate fetching/instantiation. Test production
   output under the deployment base, including browser console and network errors.

## Rapier fallback: same contract, different force lifetime

```ts
import RAPIER from '@dimforge/rapier3d-compat'; // pin 0.20.0
await RAPIER.init(); // put inside async boot
const world = new RAPIER.World({ x: 0, y: -14.7, z: 0 });
world.timestep = 1 / 120;
const car = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true));
world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.5, 2), car);
car.enableCcd(true); // runtime equivalent

// ONCE at the beginning of each preStep, before any wheel/assist adds a force:
car.resetForces(true);
car.resetTorques(true);
car.addForceAtPoint(forceVector, worldPointVector, true);
car.addTorque(torqueVector, true);
world.step();

// Reuse ray; its direction must be unit length for timeOfImpact to be metres.
const hit = world.castRayAndGetNormal(
  ray, maxLen, true, undefined, undefined, undefined, car);
if (hit) {
  out.distance = hit.timeOfImpact;
  out.normal.x = hit.normal.x;
  out.normal.y = hit.normal.y;
  out.normal.z = hit.normal.z;
  // Map hit.collider.handle to our surfaceId.
}
// At teardown: world.free(); separately free any separately owned EventQueue.
```

Rapier forces **persist** across steps. Clear them once per body per preStep, never
inside each `applyForceAtPoint` call (that would erase earlier wheel forces).
Queries use the current collision structures; perform a world step after initial
setup before this sample query. Removing a body uses `world.removeRigidBody(car)`.
Ordinary JS vectors/ray-hit records do not use `Jolt.destroy`; the high-level query
does allocate a hit record, so profile any strict allocation requirement.
[Force guide][rapier-forces] · [World types][rapier-world] · [Rigid-body types][rapier-body]

Rapier documents deterministic JS/WASM simulation given identical initial state
and inputs; JS-side nondeterministic calculations can still spoil a replay.
[Determinism guide](https://rapier.rs/docs/user_guides/javascript/determinism/)

## Evidence and remaining gate

An isolated Node probe of these exact packages set CCD, applied force-at-point and
torque, stepped at 120 Hz, and raycast past an excluded chassis to a floor: both
returned 4 m (Jolt within floating-point tolerance) and normal `(0,1,0)`. Jolt
`GetPosition()` returned the same scratch pointer for two different bodies.
Both Jolt flavors built with Vite 8.3.0 using `/test/` as deployment base,
then booted from the served production output in headless Chromium with no
console/page errors. No WASM plugin or Node polyfill was needed.
The thin-wall sweep, performance budget, five-minute soak, deterministic replay,
and Safari/Firefox checks remain **WP1's gate**, not claims established by this note.
`deja` recall returned no matching prior session; no prior findings were reused.

[package]: https://unpkg.com/jolt-physics@1.1.0/package.json
[types]: https://unpkg.com/jolt-physics@1.1.0/dist/types.d.ts
[readme]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/README.md
[idl]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/JoltJS.idl
[body]: https://jrouwe.github.io/JoltPhysics/class_body.html
[body-interface]: https://jrouwe.github.io/JoltPhysics/class_body_interface.html
[ray-example]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/Examples/ray_cast.html
[cleanup]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/Examples/proper_cleanup.html
[helpers]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/helpers.js
[binder]: https://github.com/emscripten-core/emscripten/blob/main/tools/webidl_binder.py
[cmake]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/CMakeLists.txt
[jolt-header]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/JoltJS.h
[ci]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/ci/build-examples.sh
[build]: https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/build.sh
[core-cmake]: https://github.com/jrouwe/JoltPhysics/blob/v5.6.0/Build/CMakeLists.txt
[jolt-tar]: https://registry.npmjs.org/jolt-physics/-/jolt-physics-1.1.0.tgz
[rapier-tar]: https://registry.npmjs.org/@dimforge/rapier3d-compat/-/rapier3d-compat-0.20.0.tgz
[vite]: https://vite.dev/guide/assets.html
[rapier-forces]: https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/
[rapier-world]: https://unpkg.com/@dimforge/rapier3d-compat@0.20.0/dist/pipeline/world.d.ts
[rapier-body]: https://unpkg.com/@dimforge/rapier3d-compat@0.20.0/dist/dynamics/rigid_body.d.ts
