# Sound effects (F1)

Boot calls `mountAudioDirector({host,tuning,readTelemetry,readPaused,resolveGroundedSurface})` after ControllerSupport. Pass the existing live vehicle telemetry and F0's shared grounded-surface function. Boot remains the only simulation loop, pause aggregator and contact subscriber. Audio never changes forces, input or simulation timing.

Call `afterStep(dtSeconds)` after Vehicle.postStep; call `update(nowMs)` once after simulation and pause commands per RAF. The existing visibility handler also updates after applying its pause request, because hidden documents may receive no further RAF. Use the performance/RAF millisecond clock. Reset on ordinary/script respawn and dispose before controller/UI dependencies.

The existing contact callback calls `onImpact(otherBodyId,profile,impulse,normalWorld,massKg)`. Get profile from `surfaceResolver.resolveContactSurface(otherBodyId)?.audioProfile ?? null`. The normal points out of the other surface into our car. Borrowed normal and pre-step velocity scalars are consumed synchronously; no borrowed object is retained. With Jolt's nullable impulse, severity is estimated approach speed against a static obstacle, **not a measured solved impulse**. There is a 120 ms per-body cooldown and a bounded 32-event queue.

## Timing, surfaces and voices

Physics callbacks only aggregate existing telemetry into fixed arrays/scalars. They do not call Howler, create audio nodes, promises, timers or event objects. Browser audio work and transient scheduling happen after simulation in update. Loading is asynchronous and never delays physics boot.

Six continuous voices (idle/load engine, three tyre profiles, boost sustain) reserve six of a hard sixteen-voice total. Impacts and boost attacks share ten explicit slots. Excess transients are dropped and counted. Howler's pool size is an inactive-object recycling setting, not the voice limit.

The engine note is synthetic speed/throttle pitch; the vehicle has no gearbox or measured RPM. Grounded contact speed, lateral slip, load, locked wheels and bounded wheelspin feedback drive the tyre layers, with 40 ms attack / 180 ms release. A handbrake button alone cannot produce airborne screech. Wheel material is canonical `wheel.surfaceId`, never raw `wheel.hit.surfaceId` or an X/Z geometry guess. Unresolved/contact-only wheel surfaces stay silent, never default to asphalt. Existing sample families use distinct runtime pitch profiles; they are a first sound pass, not physically measured material recordings.

Pause schedules a 30 ms native audio-clock fade. Queued impacts and boost attacks are discarded, including events while locked, muted or at zero volume. Resume restores continuous layers without stale attacks. Slow motion smoothly adjusts pitch in real time toward sqrt(timeScale), clamped to 0.5..sqrt(2). No simulation rate is altered by audio.

## Player controls and browser activation

`sfxVolume` belongs to Audio tuning: 0..1, step .05, default .7, not Quick Tune. Zero silences SFX. It follows presets, A/B slots, share links and full replay tuning headers.

Master mute is a separate persisted AudioDirector room preference. M outside text entry, hold LB plus fresh RB (also in menus), and the labelled pause-menu entry toggle it. Muting never loses the tuned volume, changes the car's tuning fingerprint or makes a shared preset/replay silence somebody else's speakers. B remains Back.

Web Audio needs a genuine browser activation. A gamepad poll or synthetic button click is not one. While locked, the driving overlay visibly says **Enable sound — Click or press a key**; a real click/key/touch requests resume, and browser rejection keeps the hint honest. The compact held-LB layout shares only the redundant legend header; it does not resize or move the HUD. Unsupported/failed audio leaves the game usable.

## Assets and verification

Player-accessible Controls → Sound credits includes Tom Haigh and qubodup, source and CC BY 3.0 links, precise tyre edits, Kenney/domasx2 credits and complete Howler MIT/Kenney notice links. Credits were implemented before downloading audio.

`assets/audio/manifest.json` records the exact original download URLs, UTC fetch times, source/archive-member SHA-256 hashes, licences, conversion details and shipped output hashes. Clips are mono 48 kHz Ogg Vorbis quality 3, without trimming or normalization. The 3-second credited tyre loop is preserved in full. `generate-boost.py` records the fixed-seed original boost recipe; generate WAV intermediates in a temporary copy, then apply the manifest's conversion settings. Do not silently replace source files or licence records.

Unit tests cover no output API calls from simulation, real slip/load/surface gating, queue/cooldown limits, sixteen simultaneous voices, native-fade scheduling, fast pause/resume, muted/locked event discard, slow-motion smoothing and persistence failure. Built-browser tests tap real Web Audio output with a test-only analyser: no output stub supplies their silence/audibility verdict. Existing input and paused-replay physics regressions remain in place. Physical speakers/headphones and actual controller feel still require listening/playtesting; passing a decoder/analyser test is not an acoustic quality claim.
