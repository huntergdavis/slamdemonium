# WP3 test track

The implementation is [track.ts](track.ts), with geometry configuration in [trackConfig.ts](trackConfig.ts), shared placement data in [trackLayout.ts](trackLayout.ts), procedural materials in [materials.ts](materials.ts), and the collider seam in [trackPhysics.ts](trackPhysics.ts).

Defaults implement design section 9 and docs/design/visual-direction.md: one 150 m paved disc including the infield; ring paint at 110/150 m, center dashes at 130 m; 15/30 m skidpad circles; red/white curbs; cyan/white posts; a 128-box wall; exponential fog and a following shadow light. Dashes, ticks, curbs, posts and wall each use a single InstancedMesh. Geometry is static after construction.

## Bind to the renderer and physics loop

```ts
import { createTestTrack, installTrackColliders } from './world/track';

const track = createTestTrack(view.scene, {
  maxAnisotropy: view.renderer.capabilities.getMaxAnisotropy(),
});
view.renderer.shadowMap.enabled = true;

// Replace WP1's temporary ground and thin wall, once per physics world:
const bodies = installTrackColliders(world, track.config, track.barrierBoxes);
// bodies.ground is one BodyId; bodies.barriers contains 128 BodyIds.

// Define once outside hot loops; carBody is owned by the vehicle.
const respawn = (pose: typeof track.spawn) => {
  world.setTransform(carBody, pose.position, pose.rotation, true);
};

// After each physics step, using a reused position scratch object:
track.checkKillPlane(currentPosition, respawn);
// Once per render, with the interpolated chassis position:
track.updateLighting(interpolatedPosition);
```

`createTestTrack` does not allocate physics bodies or touch main.ts. Developer 1 confirmed `createStaticBox(center, halfExtents, rotY, friction, restitution, surfaceId): number`, Y-up, meters and yaw radians. The structural TrackPhysicsPort matches that subset of IPhysicsWorld; no Jolt imports. Pass the real IPhysicsWorld directly when WP1 lands. This avoids depending on a not-yet-merged adapter module.

**Remove the proof-scene ground and wall before installing these colliders.** WP1's temporary ground has half-extents (40,0.5,40); this track installs one replacement ground with top Y=0 covering the paved disc and full barrier footprint. Its rectangular corners outside the circular wall are unreachable. Only ground and wall have colliders; paint, curbs, posts and outer scenery are visual only. Ground collider metadata uses the configured ground surfaceId (default asphalt 0); barriers use concrete 2. Canonical wheel surfaces come from the registered-body resolver below, not from raw engine metadata.

Wall boxes are centered at radius 153 m, Y=0.5, with local half-size X=1 radial, Y=0.5 vertical, Z tangent. Placement: X=R*cos(theta), Z=-R*sin(theta), yaw=theta. Tangent half-length is outerRadius*tan(pi/segmentCount): outside corners meet and inner corners overlap. Chord lengths would create small gaps. Corners extend roughly 4.6 cm beyond the ideal outer circle, the expected straight-box approximation. Visuals and colliders use identical descriptors.

Wall friction/restitution default to 0.05/0.25. Supply current tuning values in creation config. They are captured when bodies are installed; live engine material updates require the physics owner's API. Install once per world; the caller owns physics body lifetime. Visual `track.dispose()` does not remove engine bodies.

## Spawn, kill plane and lifetime

`track.isOnKerb(x, z): boolean` tests world X/Z coordinates in metres against the actual visual kerb-box layout. It ignores Y; callers decide whether a tire is grounded and whether haptics are enabled. It uses the configured widths, lengths, clearance and clipped seam blocks, not an ideal annulus. Edges are inclusive with a 1e-9 m roundoff tolerance. Non-finite inputs and disposed tracks return false. The query changes neither colliders nor surface grip.

Angular candidate buckets and packed box transforms are allocated once during construction. Calls use scalar arithmetic and existing arrays only; they create no objects, arrays or vectors. As with the track colliders, keep the root/parent at identity and recreate the track to change geometry. `tests/kerb-footprint.test.ts` compares the result with Three.js box transforms for default/custom layouts, every corner, seam pieces and off-kerb points.

The cached spawn is (130,0.86,0), identity quaternion, forward -Z: counter-clockwise from +X. `checkKillPlane` invokes the callback strictly below Y=-50 and returns whether it fired. The callback must zero linear/angular velocity via the adapter flag. Vehicle non-finite-state guards remain the vehicle owner's responsibility.

`updateLighting(position)` updates the light and target without allocation. Shadow map is 2048 px with ±35 m bounds; the renderer must enable shadows. The world installs matching sky/fog and restores previous scene fog/background on disposal if another owner has not replaced them. Disposal is idempotent and releases instance resources, shared geometries, materials, asphalt texture and shadow map. Recreate outside the hot loop to change geometry config. Keep the root/parent at identity transform so geometry units and physics descriptors agree.

## Materials and placement

The asphalt generator produces a 1024×1024 sRGB DataTexture once at startup: repeat wrapping, mipmaps, trilinear minification, linear magnification and the renderer's maximum anisotropy. Tile size is 8 m, roughness 0.95, tint white. One paved disc gives ring and infield continuous UVs. `options.asphalt` forwards seed, grainScale, blotchScale, contrast and size overrides; production defaults stay 1024 px.

Ordinary dashes/gaps are 3/6 m, with 90 dashes; the circumference remainder creates one longer join gap. Quads have an exact 3 m tangent length; curvature over that distance at r=130 is negligible. There are 36 radial ticks per edge. Posts follow 12 m arc steps per row, leaving the wrap remainder. Curbs follow 2 m arc steps with a shortened last block and alternating colors. Paint sits at Y=0.005 with depth bias. Geometry values live in the config; colors/material defaults are in materials.ts.

## Review and checks

Run `npm run dev`, then open `/docs/design/track-preview/index.html`. It imports the actual src/world modules and offers chase-scale, overview, infield and a 40 m/s camera tour. The orange box is only a scale marker; no vehicle physics is implemented by the preview. This is a development page, not a production Vite entry.

`npm test -- tests/world-track.test.ts` checks spacing, barrier coverage at every joint and three radial depths, shared render/collision transforms, texture setup, kill-plane boundaries and cleanup. The browser exercises default 1024 px generation; unit tests use 128 px output to focus on world integration quickly.

Remaining integration: the WP1/main-loop owner mounts this world, replaces proof colliders, enables shadows, calls the update hooks and wires vehicle respawn. Adapter/vehicle CCD remains required; barrier overlap does not replace it.

Validation on 2026-09-20: all 39 repository unit tests passed; the final seven world tests also passed after adding a ground-overlap regression. The outer ground is an annulus starting at the paved edge, preventing distant depth fighting. Chromium 153 rendered chase, overview and infield views and exercised the camera tour with no page errors or failed requests. Actual instance counts: 90 dashes, 72 ticks, 818 curbs, 137 posts, 128 barriers. World construction measured 587.7 ms in that shared-host run (including the default 1024 px asphalt); this is not a target-hardware frame-rate benchmark. The preview renders stationary views on demand and offers a fog toggle for geometry inspection.

## Shared surfaces (F0)

After installation, call `track.createSurfaceResolver(trackBodies)` once and pass the returned function to Vehicle. It uses the same authored kerb footprint and a snapshot of the installed ground/barrier IDs. It never trusts raw ray surface metadata. Paint inherits its substrate; both kerb colours resolve to the same ground surface. Unknown bodies and invalid hits return null with preallocated diagnostics, and disposal immediately marks every issued resolver disposed.

The render-free `createTrackSurfaceResolver` lives in `trackSurfaces.ts`. `createGroundDescriptor(config)` in `trackPhysics.ts` is the single ground-box definition for installation and tests. See [the F0 contract](../../docs/design/surfaces.md) for lookup safety, profile keys, boundary tolerances and live diagnostic lifetime.
