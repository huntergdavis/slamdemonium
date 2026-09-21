# F0: one identity for grip, sound and effects

The world classifies a physical contact once. Tyres, audio and haptics consume the
canonical nullable `wheel.surfaceId`; the physics adapter's reused `wheel.hit`
remains raw engine data. Consumers must not infer surfaces from material names,
controller-specific geometry queries, or a previous wheel sample.

## Content and units

`src/content/surfaces.ts` owns frozen, JSON-compatible definitions. IDs are
persistent: append new IDs; never reorder or reuse existing ones.

| ID / key     | Context | Grip multiplier | Visual / UV reference   | Audio / FX profile  | Haptic profile |
| ------------ | ------- | --------------- | ----------------------- | ------------------- | -------------- |
| 0 / asphalt  | ground  | 1               | asphalt / asphalt-world | asphalt / asphalt   | smooth         |
| 1 / kerb     | ground  | 1               | kerb / untextured       | kerb / kerb         | kerb           |
| 2 / concrete | contact | null            | concrete / untextured   | concrete / concrete | solid          |

A ground surface's grip multiplier multiplies the retained live `surfaceGrip`
tuning value. Both default ground multipliers are 1: F0 does not retune handling.
Concrete is the material used by barrier geometry. It is impact/scrape content,
with no tyre grip setting; `null` is not a zero-grip ground material. A ground
multiplier of zero remains a valid setting.

Visual and audio/effects references are plain keys, not Three, Jolt, Howler or
browser objects. Renderer-owned material objects resolve through
`materials.forSurface(id)`. The asphalt-world UV reference is world X/Z mapping
at 8 metres per repeat; `TrackConfig.tileMeters` retains its explicit authoring
override. Untextured references require no UV scale. Existing asphalt texture,
roughness, palette and instancing are unchanged.

White edge lines, dashes, ticks and skidpad paint inherit their substrate. They
are not separate physical surfaces. Both red and white kerb blocks have ID 1;
colour does not oscillate the tyre or haptic identity. Kerbs remain visual-only:
this change creates no kerb bodies and raises no collision geometry.

## Setup API versus hot-path API

| Function                                               | Intended caller                                                | Invalid / unavailable input                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `getSurfaceDefinition(id: number)`                     | Setup, content validation, diagnostics                         | Throws `RangeError` for unknown/noninteger/nonfinite IDs. Never use in a physics step.                                  |
| `getKnownSurfaceDefinition(id: SurfaceId)`             | Hot consumer holding an ID proven by the catalog/body registry | Indexed immutable read; no throw/allocation. Casting a raw physics number to `SurfaceId` does not establish that proof. |
| `resolveGroundedSurface(grounded, id: number \| null)` | Tyres and tyre audio/haptics                                   | Returns a ground definition or `null`; never throws or substitutes asphalt. Airborne returns before lookup.             |

The catalog validates itself at startup. Track configuration rejects unknown IDs
and contact-only ground assignments. The resolver validates every registered body
ID (finite, nonnegative safe integer, unique across ground and barriers), the
ground material, and a finite positive axis-aligned ground descriptor.

A consumer reads `resolveGroundedSurface(wheel.grounded, wheel.surfaceId)`.
For impact-only concrete, use its known definition's audio/FX profile rather than
pretending it has tyre grip. Grounded is still the physical ray result: an
unresolved contact retains suspension/rigid-body contact, while tyre forces have
no resolved grip capacity. Neither audio nor haptics should invent an asphalt
fallback.

## World registration and classification

The production seam is:

```ts
const bodies = installTrackColliders(physics, track.config, track.barrierBoxes);
const resolveSurface = track.createSurfaceResolver(bodies);
// Boot passes resolveSurface to Vehicle; consumers read its telemetry.
```

The render-free factory is exported from `src/world/trackSurfaces.ts`:

```ts
createTrackSurfaceResolver({
  bodies: { ground: groundBodyId, barriers: barrierBodyIds },
  groundSurfaceId: SURFACE_IDS.asphalt,
  ground: createGroundDescriptor(config),
  kerbFootprint,
});
```

`createGroundDescriptor(config)`, exported by `src/world/trackPhysics.ts`, is
pure. Collider installation and classifier validation share it, including the
polygon-corner extent formula. Deliberately flat test fixtures supply their own
actual box descriptor and an empty barrier list, not a copied ring formula.

The factory snapshots registrations and ground bounds. It ignores raw
`hit.surfaceId` entirely: registered barriers resolve to concrete even if that
raw field says asphalt or contains an invalid number. Unknown bodies resolve to
null. Only the registered ground body's upward top face can receive a kerb
overlay; wall, ground side and ground underside hits cannot become kerb by X/Z
projection. Do not reuse a registry with a different world or body generation.

The kerb predicate uses the same precomputed oriented boxes as the rendered
instances, including widths, clearances, clipped seam pieces and colour-independent
identity. Shared `isOnKerb` remains a visual-footprint utility; runtime feedback
consumes the canonical surface ID instead of calling it independently.

The track root and parent must remain at identity, as with the existing collider
contract. Recreate the world to change its geometry. Ground-hit bounds and top
plane allow 0.0001 m of float32 roundoff; kerb rectangle edges retain their existing
inclusive 1e-9 m tolerance. Nonfinite data, negative ray distance, non-unit normals
(outside 0.001 squared-length tolerance) and out-of-bounds ground hits return null
with `invalid-hit`. No exception/logging path executes per resolution.

## Null and diagnostic lifetime

`SurfaceResolver` is a function returning `SurfaceId | null`, with a preallocated
readonly-live `.diagnostics` record and an idempotent `.dispose()` method.

- `grounded=false, surfaceId=null`: airborne; no stale ray data is read.
- `grounded=true, surfaceId=null`: a physical ray contact whose material is
  unresolved. `lastStatus` distinguishes unknown body, invalid hit and disposed.
- `grounded=true, surfaceId=2`: known concrete contact, with no tyre definition.

**lastStatus describes the MOST RECENT synchronous resolution across ALL wheels.**
It is not the status of the wheel nearest it in a debugger or HUD, and it is not
history. Read it immediately after a call if that individual result needs a
reason; copy scalars when retaining a snapshot.

`unknownBodySeen` and `firstUnknownBodyId` latch only at the first unknown body;
later calls do not replace that evidence. `invalidHitSeen` is also sticky. There
is no per-step diagnostic allocation or logging. Vehicle telemetry exposes the
same live record; exported/debug snapshots copy its scalar values.

Each resolver starts with clean latches. Ordinary vehicle respawn or mass rebuild
keeps its world's evidence. `track.dispose()` immediately marks EVERY issued
record `disposed`, even if no later ray is cast. Queries on that resolver return
null without reading the ray, and retain disposed status. A world rebuild creates
a new track/resolver/Vehicle; old references remain disposed and never masquerade
as new-world telemetry.

## Impact lookup

Use `resolver.resolveContactSurface(bodyId)` for an actual rigid-body contact.
It reads the SAME validated registration map as wheel resolution; no fabricated
ray, raw engine surface ID, or second material registry is involved. It returns a
stable frozen `ContactSurfaceDefinition | null`. **Concrete is the only
contact-context material today.** The registered ground is a known ground
material, so it returns null with `not-contact`, not `unknown-body`.

`diagnostics.lastContactStatus` starts null and records only the most recent
impact lookup. `lastStatus` records only wheel resolution; neither call kind
overwrites the other's status. Both remain synchronous last-call facts, not
per-contact/per-wheel histories. Unknown and invalid inputs return null without
throwing. The unknown-body latch and invalid-input latch are shared world-level
facts across both contexts. Disposal immediately sets BOTH statuses to
`disposed`; retained contact lookup functions then return null.
