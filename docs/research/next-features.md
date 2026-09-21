# R7: make the next slice a game worth repeating

**Do sound first. Add a short crash challenge and a time-trial/retry loop before
expanding the world. Maps plus an editor are the biggest architectural risk.**
Radio and one imported car are contained additions; a general track authoring
system crosses almost every existing boundary.

Snapshot: 2026-09-20, [main `334aa7b`][baseline]. Recommendations, not approved
scope. Costs below are planning budgets and arithmetic, **not measured frame-time
promises**. Asset licences were checked; sound quality was not auditioned.

## 1. Sound: make the tyres explain the car

Use [Howler.js][howler] (MIT; retain its notice), with Web Audio for short SFX.
Crossfade idle/load engine loops; derive synthetic RPM from speed and throttle
because our drivetrain has no gearbox/RPM model. Vehicle size selects an audio
profile; scaling pitch by size alone will not sound like different engines.
Drive screech from grounded-wheel slip, load and speed, with smooth attack/release;
the [wheel telemetry][telemetry] already exposes the necessary signals. Handbrake
alone must not trigger screech in the air. Give boost an attack and sustained layer.

Start assets with [domasx2's CC0 engine loops][engine], [Tom Haigh's tyre loop,
edited by qubodup][tyre] ([CC BY 3.0][cc-by]: credit title/authors, link source/licence,
identify edits),
and [Kenney Impact Sounds][impacts] (CC0). The engine files differ **only in pitch**:
use them to prove the system, then audition a coherent recorded RPM/load bank for
the final engine voice. These downloads do not establish realistic sound quality.

**First change:** an `AudioDirector` consumes telemetry and bounded impact events
after simulation; it owns voices, gesture unlock, volumes and pause/slow-motion
policy. Keep audio out of `Vehicle.preStep`. Our [contact adapter][adapter] returns
nullable impulse: future breakable/multi-car impact severity must be explicitly
estimated until solved impulses exist, with per-pair cooldowns for scraping.

**Cost:** start with a 16-voice cap and no per-step node creation. Mixing cost grows
with active voices/effects. Thirty seconds total of mono 48 kHz decoded float PCM
is **5.49 MiB**, before overhead; compressed download size is not resident size.
[AudioBuffer format][pcm]

## 2. Radio: stream one local file at a time

Reuse Howler with `html5: true`, metadata-only preload and explicit MP3 format for
extensionless blob URLs. Keep one active track; release its object URL after
unloading. A [directory file input][folder] plus a multiple-file fallback is the
portable starting point; [showDirectoryPicker][directory-picker] still has limited
browser availability. Folder access is user initiated, with no upload. Expect
reselection after reload; saved filenames are not durable file permissions.

**First change:** a separate playlist/source controller feeding the audio service,
with independent music volume and mute. Local files first; a later station source
must handle streaming permissions and playback errors. Start playback from a user
gesture. Define whether music continues while gameplay is paused.

**Cost/licence:** native decoding of one stream should be modest CPU work, but
browser buffering needs measurement. Fully decoding a three-minute stereo 48 kHz
track would consume **65.9 MiB**; avoid decoding the playlist. MIT covers the player,
not bundled music or station rights. Player-selected local music ships no soundtrack.

## 3. Cars: choose one coherent kit and normalize it once

Use [Kenney Car Kit][cars]: CC0, multiple car/truck/van styles, glTF supplied.
Start with one generic car; expand colours before vehicle classes. Load through
Three's [GLTFLoader][gltf], convert paint to [MeshToonMaterial][toon] with a small
gradient palette, and preserve readable wheels/nose/brake lights. Three is MIT;
retain its notice. This provides actual 3D cars, not licensed manufacturer branding.

**First change:** a versioned `VehicleDefinition` shared by physics and visuals:
dimensions, collider, wheel mounts, material slots and audio profile. Today
[physics geometry][geometry] and [visual dimensions][visual] are separately fixed.
Normalize metres, +Y up and -Z forward at import; validate separate wheel pivots.
Route asynchronously loaded assets through [material preparation][prepare], which
[boot currently runs once][boot], preserving the WP13 allocation fix.

**Cost:** proposed first-car budget: 15k triangles, ten main-pass draw calls, shared
geometry/materials, no outline post-process. CPU work is loading/normalization and
draw submission; a visual replacement adds no physics bodies. Shadows add passes.
One uncompressed 1024² RGBA8 texture with full mipmaps is **5.33 MiB per map**; prefer
a palette over large textures.

## 4. Maps/editor: data and lifecycle first

Use Three's MIT [SVGLoader][svg] to import **one closed centreline**, with explicit
metres-per-unit, road width, start and direction. Build a flat circuit first.
A drawing does not specify elevation, banking or which crossing is a bridge;
raster sketches need tracing. For known layouts, [OpenStreetMap data][osm] is a
usable source with attribution and ODbL database obligations; a tracing of someone
else's diagram is not automatically cleared content.

**First change:** versioned `TrackDefinition` data containing centreline, widths,
spawn, ordered checkpoints and prop placements; one compiler produces rendering,
collision and lap geometry. The [current lap timer][lap] assumes a circular track.
The [physics adapter][adapter] creates only boxes, its static-box factory accepts
yaw only, and it has no individual body removal. Add quaternion shape descriptors
and scoped body disposal for jumps, props and edit/play rebuilds; introduce mesh
colliders when road geometry requires them.

Then add elevation and placed assets; build the editor as a mode using the same
compiler, save format and undoable commands. **Do not fork a second world builder.**

**Cost:** scales with sampled geometry, visible props/shadows and active physics
bodies. A 5 km centreline sampled every 2 m is 2,500 segments before joins/barriers.
Chunk meshes, instance repeated props, bound collision detail and build/cook at
load time or in a worker. Avoid one draw call/body per sample. Peak rebuild memory
must include both the old and replacement worlds.

## What the list misses

- **A reason to crash and immediately try again.** [Walls already collide][walls];
  the missing part is rewarding interaction. [Design §1][vision] promises a
  crash-happy racer. Test one short smash route with light breakables, bounded
  debris, convincing impacts, scoring and instant retry before building traffic
  or deformation. A pure fastest-lap objective rewards avoiding collisions; it
  cannot alone establish the Slamdemonium identity. This is a design judgement to
  playtest, not a claim that destruction automatically makes driving fun.
- **A complete run loop; ghosts are cheap, not free.** Add start/countdown,
  checkpoint validity, finish, local personal best and retry. The current
  [ScriptController][scripts] resets and owns the player's input; loading a replay
  does not create a second driver. Start with a non-colliding **pose ghost**,
  interpolated from physics-step-indexed samples, rather than simulating another
  Jolt car. At 30 Hz, seven float32 pose components cost about **49.2 KiB/minute**,
  excluding wheels/headers. It still costs another rendered car. [Replay v1][format]
  includes tuning/spawn but no track or vehicle identity: version track, car,
  tuning and physics/rules fingerprints before accepting saved bests. Existing
  deterministic replay remains the regression tool; it is not a portability
  guarantee across future content or engine revisions.
- **Surface definitions shared by grip, sound and FX.** Ray hits already carry
  `surfaceId`, but [tyre friction uses global `surfaceGrip`][tires]. Resolve that ID
  through one surface definition, preserving the global tuning multiplier, before
  adding grass/gravel roads. Otherwise each feature can tell a different story
  about what the tyres are touching. This belongs in the content data, not three
  separate material-name lookups.

## Keep the code clean by making ownership explicit

Extract a disposable `GameSession` from [boot][boot] as modes arrive. Share typed
definitions, asset ownership/cache and track compilation across Lab, Play and
Editor; keep dynamics independent of presentation. Store source/licence/version
with each asset. Test enter/exit/reload and production mounting, not just modules.
Prefer these concrete seams over a general framework rewrite.

My order: audio plus a small crash/retry experiment; time trials/pose ghosts; radio
and one cel-shaded car; then the flat SVG track pipeline. **F4 taken first risks
duplicating track logic, invalidating replays and leaking bodies/assets.** Keep the
[pending human feel and target-device checks][review] in the release plan; new
content cannot answer those questions.

[baseline]: https://github.com/huntergdavis/slamdemonium/tree/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b
[howler]: https://github.com/goldfire/howler.js#documentation
[engine]: https://opengameart.org/content/racing-car-engine-sound-loops
[tyre]: https://opengameart.org/content/car-tire-squeal-skid-loop
[cc-by]: https://creativecommons.org/licenses/by/3.0/
[impacts]: https://kenney.nl/assets/impact-sounds
[pcm]: https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer
[folder]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory
[directory-picker]: https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
[cars]: https://kenney-assets.itch.io/car-kit
[gltf]: https://threejs.org/docs/pages/GLTFLoader.html
[toon]: https://threejs.org/docs/pages/MeshToonMaterial.html
[svg]: https://threejs.org/docs/pages/SVGLoader.html
[osm]: https://www.openstreetmap.org/copyright
[telemetry]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/vehicle/telemetry.ts
[tires]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/vehicle/vehicle.ts#L348-L355
[adapter]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/physics/adapter.ts
[geometry]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/vehicle/constants.ts
[visual]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/render/carVisual.ts
[prepare]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/render/prepareScene.ts
[boot]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/main.ts
[lap]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/input/lapTimer.ts
[walls]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/world/trackPhysics.ts
[vision]: ../vertical-slice-design.md#1-vision-and-the-goal-of-this-slice
[scripts]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/input/script.ts
[format]: https://github.com/huntergdavis/slamdemonium/blob/334aa7bfd8d63e4363219e13ae623da3d2d3ae9b/src/input/scriptFormat.ts
[review]: slice-review.md
