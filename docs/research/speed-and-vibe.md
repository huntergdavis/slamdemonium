# R3: make the pavement fast and the car readable

**Make 60 m/s exciting with the speedometer hidden.** Start with road flow and a
camera that exposes acceleration and slip. Add restrained shake; consider audio
afterward. The fantasy is a stunt driver placing a heavy, eager machine at its
limit, catching the slide, and wanting another attempt after a scrape.

This supports [design §1 and §10](../vertical-slice-design.md) and preserves the
[designer's daylight lab direction](../design/visual-direction.md): orange box,
bright nose, dark pavement, repeated white/cyan posts, quiet instruments. These
are research recommendations, not new slice scope or changed defaults. Sources
checked 2026-09-20; no hands-on playtest is claimed.

## Spend the visual budget in this order

| Priority                                      | Why it helps                                                                                                                                                            | Recommendation for this slice                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Nearby road flow**                       | Texture and objects moving through the image provide motion information; the amount and visible region of optical flow affect perceived speed. [Perception study][flow] | Deliver grain, dashed paint, curbs and posts before judging acceleration. Preserve mipmaps and anisotropy: shimmering pavement looks unstable. Keep near-road contrast through fog and dynamic resolution. |
| **2. Car against its path**                   | The player must distinguish nose direction from travel direction to judge a catch. This is a design inference from our drift task.                                      | Keep `camVelocityBlend=0.5` initially, the nose chevron, visible wheel steering and persistent skid marks. Following heading too rigidly can hide the slide; excessive lag can obscure turn-in.            |
| **3. Speed and boost framing**                | A changing camera projection is an acceleration cue, but projected FOV and the viewer's physical visual field are different things.                                     | Retain the speed curve and boost envelope; A/B `fovSpeedGain` separately from `camDistance`. Do not keep widening FOV to compensate for an empty scene.                                                    |
| **4. Small, purposeful motion**               | Our inference: a little suspension response suggests mass; constant large movement competes with steering information.                                                  | Use time-based, band-limited shake scaled by `camShake`, distinct from suspension bob and corner roll. Zero removes shake. Keep the horizon and road ahead readable at full speed.                         |
| **5. Reactive sound, if stretch time exists** | Engine load can be communicated immediately, independently of road speed. Turn 10 describes throttle-dependent intake/exhaust character. [Audio team AMA][audio]        | Give throttle an audible response, speed a road/wind layer, and sliding a tire layer. Preserve headroom for a boost onset and future impacts. Loudness alone is not acceleration.                          |

Criterion's [Vehicle Feel Masterclass listing][criterion] explicitly treats camera
motion and handling assists as part of vehicle feel, alongside physics. That is
the useful production lesson here. The linked perception study used controlled
visual stimuli, not our browser racer; it supports testing flow/FOV, not declaring
one universal best FOV or a guaranteed percentage increase in perceived speed.

## Camera finding: the existing FOV curve needs a final bound

Three.js `PerspectiveCamera.fov` is **vertical degrees**. At a 16:9 aspect ratio,
with zoom 1, the current design formula produces these calculated values:

| State                       | Vertical FOV | Horizontal FOV |
| --------------------------- | -----------: | -------------: |
| Rest                        |       70.00° |        102.45° |
| 60 m/s, no boost            |       85.00° |        116.91° |
| 60 m/s, full boost envelope |      100.00° |        129.47° |
| 85 m/s, full boost envelope |      110.29° |        137.22° |

Calculation: `hFov = 2 * atan(tan(vFov/2) * aspect)`.
[Three.js camera documentation][camera]

Default boost already creates a large expansion. At permitted extremes
(`fovBase=110`, both gains 50, `topSpeed=20`, boosted speed 80 m/s), the raw formula
produces **560°**, outside a valid perspective-camera range. **Recommendation to
the PM/WP6:** bound the final delivered FOV, with **115° vertical as an initial
perceptual ceiling to test**; at minimum enforce a finite result strictly between
0° and 180°. Expose the delivered FOV/cap in debug telemetry so tuning is honest.
The 115° ceiling is a proposal, not a change to the approved defaults in this PR.

Follow the interpolated chassis as specified. Use frame-rate-independent camera
response and the existing roughly 0.2 s boost envelope rather than a one-frame
FOV jump. Tune `camFollowTime` for visible acceleration without making every
steering correction look delayed. Compare at 60 and 144 Hz. Retain usable speed
cues with `camShake`, `camRollGain` and FOV gains set to zero.

## The circle already contains a speed rhythm

At the 130 m centre line, the 9 m dash/gap cycle passes **6.67 times/s at 60 m/s**
and **9.44 times/s at 85 m/s**. The two post rows are at different radii: their
actual passing cadence is `speed / 130 * rowRadius / 12`, not simply `speed / 12`.
With D1's 108 m and 151 m rows, the calculated rates are approximately
**4.15/5.81 posts/s at 60 m/s**, and **5.88/8.23 at 85 m/s**. These regular cues
give a plain disc scale without scenery, traffic or extra collision bodies.

Keep the near markers crisp and let light fog simplify distant clutter. Do not
hide the nearby road under a dark vignette or smoke. Optional speed lines belong
at the edges, after the world itself reads as moving. A lower/closer camera is an
A/B experiment within existing sliders, not a substitute for road markings.

## Audio and impacts should tell the player what happened

For the optional WebAudio pass, a speed-linked engine tone is an adequate start;
add throttle-dependent brightness/level so lifting is audible while the car still
moves quickly. Let tire slip/grip usage drive squeal, and keep persistent road/wind
noise below it. A boost attack should settle into a sustainable tone. This is a
proposed minimal translation of the audio reference, not a claim to reproduce
Forza's recording or synthesis system. Music is unnecessary for the lab.

For future crash FX, pair a short impact attack with one directional camera kick
and a brief decay; wall scraping should read as a sustained scrape, not a new
explosion each frame. Give control and the view of the next safe direction back
quickly. Collision severity must reflect the adapter's evidence: Jolt currently
cannot provide a solved pair impulse; any velocity-delta severity is explicitly
an estimate. [R1b limitations](jolt-integration.md#r1b-solved-contact-impulse-is-not-exposed-by-jolt-110)

## Tone references: what lands, and what we borrow

The source column describes published game features. The borrowing decisions are
our recommendations for Slamdemonium.

| Reference                         | Source-backed identity                                                                                                                            | Borrowing decision                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Burnout Paradise**              | Dangerous driving earns boost; Road Rage rewards takedowns; Showtime lets the wreck keep moving and earning score. [EA manual][burnout]           | Main emotional reference: commitment, close calls, metal chaos, then another attempt. Later crash control should preserve player agency.               |
| **Wreckfest**                     | Battered cars, demolition, and armor whose added weight changes handling. [Official site][wreckfest]                                              | Weight and collision consequences should be visible. Our box can communicate mass through suspension and contact before any deformation system exists. |
| **Split/Second**                  | A staged TV spectacle with timed destruction that changes the track. [Publisher description][splitsecond]                                         | Clear anticipation followed by a decisive payoff. Destructible tracks remain future inspiration, outside this circle slice.                            |
| **Distance**                      | Refract combines perilous speed with jumping, flipping and flying through hazards. [Developer press kit][distance]                                | A machine that stays expressive under extreme motion. Borrow recovery agency later while retaining this slice's readable daylight environment.         |
| **Absolute Drift / art of rally** | Deliberate drift practice and rally techniques, presented with restrained visual styles. [Developer tutorial][absolute] · [Developer site][rally] | Legible motion and a satisfying catch are already an aesthetic. Protect the nose, tires, contact shadows and skid marks from decorative clutter.       |

Use concise, physical feedback: boost charging, tires losing grip, brakes biting,
metal scraping. Future crash celebrations should feel exuberant and immediately
recoverable. For this milestone, the successful spectacle is a clean five-second
slide followed by a save, performed by a box.

## A ten-minute A/B pass

1. Hide the speedometer and compare the same recorded drive with normal road cues
   versus temporarily hidden posts/paint. Keep physics, resolution and camera fixed.
2. Restore cues; compare FOV gain 0 versus Default, then camera distance alone.
   Ask both which feels faster and which makes the next steering action clearer.
3. Compare shake 0 versus Default through acceleration, drift and wall contact.
   Reject settings that make heading or the road edge harder to track.
4. If audio exists, compare muted/unmuted at equal physics settings. Check that
   lift, slide and boost are distinguishable without looking at the instruments.
5. Repeat the winning visual setup at 60/144 Hz and reduced render scale. Save
   settings and a short clip; route proposed default changes through the PM.

Evidence: FOV and cadence values calculated from the brief/D1 geometry; primary
sources linked above; experiential recommendations still need this A/B pass.
Recall via `deja "speed camera"` found PM/techwriter briefings; the reused local
direction is credited to the linked D1 document, not an independent earlier study.

[flow]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6831620/
[criterion]: https://gdcvault.com/play/1025295/Vehicle-Feel-Masterclass-Balancing-Arcade
[camera]: https://threejs.org/docs/pages/PerspectiveCamera.html
[audio]: https://forza.net/news/in-the-garage-audio-discord-ama
[burnout]: https://eaassets-a.akamaihd.net/eahelp/manuals/bpr-pc-en.pdf
[wreckfest]: https://wreckfest.thqnordic.com/US/ps4
[splitsecond]: https://store.steampowered.com/app/297860/SplitSecond/
[distance]: https://refractstudios.com/press/distance/index.html
[absolute]: https://blog.playstation.com/2016/08/04/absolute-drift-zen-edition-launches-august-16-on-ps4/
[rally]: https://www.artofrally.com/
