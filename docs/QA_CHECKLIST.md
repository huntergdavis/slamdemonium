# Manual QA checklist

For a human, on real hardware. Automated tests cover the numbers; this list covers what only a person can judge. It expands section 13.5 of the [design doc](vertical-slice-design.md) and the human-judged items from its section 3 acceptance list.

Run the whole list at least once each in **Chrome**, **Safari** and **Firefox** on an **M-series MacBook Air**, at a 1080p-equivalent window. All three browsers are required: design section 3 says the build must load and reach a drivable state in each of them. Use a **gamepad** for the drift items; repeat them on keyboard afterwards.

> **Status:** the game is drivable. The live site has the real ring, the designed car with working wheels, the chase camera, skid marks and speed cues, so items 1 to 5, 10 and 11 can be run today. The Options panel, HUD, telemetry recording and the T and P keys are built but not yet mounted in the live game (WP14 is wiring them); every item that needs them is marked **pending WP14** and is not a failure until that merges. Steps are written against the design; where the shipped game differs, fix this page.

## Before you start

1. Open the game fresh. Press **O**, choose the **Default** preset, click **Reset everything**, close the panel. *(Pending WP14: until the panel is mounted, a fresh page load is at defaults.)*
2. Press **H** until the full HUD is showing. *(Pending WP14.)*
3. Note the browser, browser version, display refresh rate and window size at the top of your report.
4. Press **F9** to start a telemetry recording. Leave it running for the whole session; press **F9** again at the end to download the CSV. *(Pending WP14.)*

Terms used below (slide angle, grip usage, G-G diagram) are in the [Glossary](GLOSSARY.md).

## Checklist

Tick each item Pass, Fail or Pending. A Fail needs a report (see the end of this page).

### 1. Free driving, 60 seconds

**Steps.** Drive the ring both directions, cut across the infield, do a few tight low-speed turns and a couple of full-throttle straights. Do not use the handbrake or boost yet.

**Pass.** The car responds the instant you press a key or move the stick. It goes where you point it at low speed. On the ring it settles into a steady arc with the stick held. Speed climbs briskly from rest and the world visibly streams past at top speed. No stutter, no hitching, no visible snapping between physics and picture.

**Fail.** Any of: a visible delay between input and motion, the car creeping when stopped, a wobble that builds on its own on a straight, jitter in the car or camera, a frame rate that visibly drops, anything on screen turning into NaN or a blank.

### 2. Drifting on the ring, 60 seconds

**Steps.** At roughly 35 to 45 m/s on the ring, steer in hard while on the throttle. Then try a short handbrake tap mid-corner and release. Hold each slide as long as you can. Do it both directions.

**Pass.** The slide angle gauge swings out and stays out while you hold. The drift meter fills. Skid marks appear behind the rear wheels. The car keeps following the ring while sideways; you can adjust the line with the stick. Recovering the car (counter-steer fully or lift) straightens it without a snap the other way.

**Fail.** The car either grips so hard it will not slide, or spins the moment it does. The rear steps out and immediately snaps back straight. The slide flip-flops from side to side around straight. The car keeps sliding after you have fully counter-steered and lifted.

### 3. Drift holdable for 5 seconds at Default, both entry methods

Acceptance item from design section 3. Preset must be **Default**, normal time scale, boost off.

**Steps.** Count out loud or watch the scrolling slide angle graph.

- (a) **Throttle and steering entry.** No handbrake. On the ring at 35 to 45 m/s, steer in hard on full throttle until the tail comes round, then hold.
- (b) **Handbrake entry.** Same speed, brief handbrake tap while turning, release, then hold on the throttle.

Repeat each left and right.

**Pass.** In each case, five continuous seconds of intentional sliding with the slide angle above the drift marker on the gauge, during which you can still steer the line, followed by a deliberate recovery. Counts as one pass only if at least one attempt in each direction succeeds for both entries.

**Fail.** You cannot get sideways at all by method (a). The angle collapses before five seconds without you asking. The slide turns into a spin. A wall scrape, an endless spin or the car orbiting on its own does not count as a pass.

### 4. Hard braking from top speed

**Steps.** On a long straight on the ring (or across the infield) reach top speed, read it off the HUD, then brake fully in a straight line with the stick centered.

**Pass.** The car slows hard and straight. The nose dips a little. It comes to a clean stop without weaving. Per-wheel grip bars go high but the car stays pointed forward. With Default settings, from about 60 m/s the stop takes roughly 2.5 to 3 seconds and around 75 to 90 m.

**Fail.** The car swaps ends or pulls sideways under braking. It takes visibly longer than 4 seconds or never fully stops. It rocks back and forth after stopping. Stopping distance far off the sanity figure (under 60 m or over 100 m) with Default settings.

### 5. Wall hit at boost speed, must not tunnel

**Steps.** Charge the drift meter with a few slides, then boost along the ring and steer straight at the outer barrier. Hit it as fast as you can, at least once near head-on and once at a shallow angle. Repeat three times.

**Pass.** Every time, the car stops at or bounces off the wall and stays inside the disc. At a shallow angle it scrapes along without stopping dead. The camera takes a kick and recovers. If the car ends up flipped, it rights itself or **R** respawns it.

**Fail.** The car passes through the barrier, even once, or ends up embedded in it. The car launches into the air or spins far faster than looks possible. The picture freezes or jumps. Anything that makes you press **R** to escape counts as a fail unless the car was genuinely stuck on its roof.

### 6. Switching presets while driving

Pending WP14 (Options page not yet mounted).

**Steps.** On the ring at speed, press **O**, switch Default to Grip, drive a corner, switch to Drifty, drive a corner, switch to Raw, drive a corner, switch back to Default. Keep driving throughout.

**Pass.** Each switch changes the car's behavior within a frame and without stopping, moving or resetting it. The HUD shows the active preset. The car does not jump, teleport or twitch when the mass-related values change.

**Fail.** A pause, freeze, teleport or speed change on switching. The car explodes, flips or spins without input. The preset name on the HUD does not match the dropdown. Any slider not moving to the preset's value.

### 7. Drivable with every assist at zero

Acceptance item from design section 3.

Do this straight after item 6, while the Options page is still open. *(Pending WP14 for the panel; until then the Raw preset cannot be selected in the live game.)*

**Steps.** Pick the **Raw** preset and confirm `countersteerAssist` and `yawAssist` both read 0; Raw also zeroes `absStrength`. "Every assist" means the tunable handling assists: counter-steer, yaw assist and the drift limiter that scales with yaw assist. Air damping and anti-flip are internal safety constants and stay on; they act only in the air or past 35 degrees of roll, so they never touch flat-pavement driving. Drive the ring for 60 seconds and try a drift.

**Pass.** The car drives. It can be twitchy and it is fine if you spin, but it responds to input, it can be caught with effort, and nothing invisible helps you. Once past the maximum drift angle there is no push back; you are on your own. If you do roll it, the car righting itself is expected and not a fail. No flicker, no NaN, no reset.

**Fail.** The car becomes uncontrollable in a way that has nothing to do with skill: an oscillation that grows on its own, a spin that never slows, a jump to NaN or a respawn you did not ask for. Or the opposite: you can feel a helper still straightening the car, which means an assist is not truly off.

### 8. Presets distinguishable blind within 30 seconds

Acceptance item from design section 3. Needs a second person. Pending WP14 (needs the Options page).

**Steps.** The helper opens the Options page, picks Grip, Drifty or Raw at random, and hides the panel and the HUD's preset name (press **H** to minimal). You drive for up to 30 seconds and say which one it is. Do it six times in random order, mixing in repeats.

**Pass.** You name the preset correctly at least five times out of six, each within 30 seconds of driving.

**Fail.** Two or more wrong guesses, or regularly needing longer than 30 seconds. Note which pair you confuse; that is the tuning finding.

### 9. Opening and closing the panel while driving

Pending WP14 (Options page not yet mounted).

**Steps.** At speed, press **O** to open, drag a Quick Tune slider with the mouse, click a numeric box and type a value, press **O** to close, keep driving. Repeat with the gear button instead of the key. Try pressing arrow keys while a slider is focused and after clicking off it.

**Pass.** The game keeps running behind the panel. Driving keys keep working right after you drag a slider. Arrow keys inside a numeric box edit the number, not the car. Closing the panel returns full control immediately. "Pause while open" freezes the car when ticked, and it resumes cleanly when unticked or closed.

**Fail.** The car stops or hitches when the panel opens. Arrow keys steer the car while you are typing in a box, or stop steering the car after you clicked a slider. **Tab** moves browser focus somewhere odd instead of swapping A/B (game focused) or moving between controls (panel focused). Any slider value that does not stick.

### 10. Tab away and back

**Steps.** At speed on the ring, switch to another browser tab for 10 seconds, then come back. Then repeat by switching to a different application. Then repeat with the panel open.

**Pass.** The game pauses while hidden and resumes exactly where it was, with the car at the same speed and place. No catch-up storm: the car does not teleport or run several seconds of physics in a burst. HUD graphs show a gap or a flat line, not a spike.

**Fail.** The car has moved a long way or crashed while you were gone. A stutter or a burst of motion on return. Input stuck on or off after returning (a key you were holding still held, or ignored). Frame rate lower than before.

### 11. Window resize

**Steps.** While driving, drag the window to a small size (about a quarter of the screen), then to full screen, then back. Try a very wide and a very tall shape. Also use browser zoom (Cmd plus and minus) once.

**Pass.** The picture fills the window at every size with no stretching or squashing; the car stays proportioned. The HUD reflows and stays readable. The Options panel stays usable at small heights (it scrolls). Frame rate recovers within a second of each change.

**Fail.** Black bars, a stretched image, HUD text overlapping or off screen, a panel that cannot be scrolled to its bottom, or a lasting frame rate drop after going full screen.

### 12. Frame rate and smoothness (spot check)

Design target: sustained 60 FPS on the reference laptop. The performance harness measures it; you confirm it looks right. Pending WP14 for the HUD figures; until then judge smoothness by eye.

**Steps.** Watch the FPS and physics-ms figures in the HUD text block during items 1, 2 and 5.

**Pass.** FPS stays at the display rate with no visible drops during drifts, skid marks or wall hits. Physics time per step stays well under a millisecond.

**Fail.** Visible frame drops in any of those moments, or physics time creeping upward over the session.

### 13. Options page mounts and applies live

Pending WP14.

**Steps.** At speed on the ring, press **O**. Drag `gripRear` from its default down to 0.8 while still driving. Drag it back. Then drag `accel0` up to 30 and floor the throttle from a standstill.

**Pass.** The panel opens on the first press with the game still running behind it. The rear starts sliding within a frame of the slider moving, no reload, no respawn. Dragging it back restores grip just as fast. The higher `accel0` is obviously quicker off the line. The "unsaved change" marker appears next to each slider you touched.

**Fail.** O does nothing. A slider moves but the car does not change until a reload or respawn. The car jumps, stops or teleports when a slider moves. A value snaps back on its own.

### 14. Values survive a reload, an export reimports, a share link applies

Pending WP14.

**Steps.**

1. Set three sliders to unusual values you will recognise (for example `gravity` 20, `topSpeed` 45, `fovBase` 90). Note them. Reload the page.
2. Click **Export**. Click **Reset everything**. Confirm the three sliders are back at defaults. Click **Import** and pick the file you just exported.
3. Click **Share link** and copy the URL. Open it in a fresh private window.

**Pass.** After the reload, the three values are exactly as you left them and the change log in the panel still lists your edits. After the import, the three values come back and the change log from the export is present. In the private window, the three values are applied on load with no clicks.

**Fail.** Any of the three values reverts after a reload. The exported file will not import, or imports with a different value. The share link opens at defaults, or shows an error, or has to be applied by hand.

### 15. HUD, recording and time keys

Pending WP14.

**Steps.** Press **H** three times while driving. Press **F9**, drive for ten seconds, press **F9** again. Press **T** at speed, then again. Press **P**, wait two seconds, press **P** again.

**Pass.** H cycles full, minimal, off, full, and the picture keeps running underneath. F9 shows a recording indicator on the first press and downloads a CSV on the second; the file opens and has one row per physics step with a parameter header. T drops the world to quarter speed with the physics still smooth and the T press again returns it to normal. P freezes the car where it is, and the second P resumes it from exactly that state with no jump.

**Fail.** Any key does nothing. The HUD hides but the game pauses. No file downloads, or the CSV is empty or has no header. Slow motion stutters, or changes the car's behaviour once back at normal speed. Pause loses input state or teleports the car on resume.

## Reporting a failure

A failure report is only useful if someone else can reproduce it. Before you write anything else, collect these:

1. **Telemetry CSV.** Press **F9** to stop the recording started at the beginning of the session; the CSV downloads. If the failure was mid-session, note the approximate time into the session so the reader can find it. The CSV header also carries the parameter set that was live when recording started.
2. **Parameter export.** Open the Options page and click **Export**. The JSON holds every slider value plus the change log of everything you touched, with timestamps.
3. **Active preset and A/B slot.** Read both off the HUD text block and write them down. If you were in slot B, say so and export A as well.
4. **Environment.** Browser and version, display refresh rate, window size, gamepad or keyboard.
5. **What happened.** The checklist item number, what you did in the few seconds before, what you saw, and what you expected. A short screen recording beats a paragraph.

Attach the CSV and JSON to the report. If the failure needs a specific setup to reproduce, a **Share link** from the Options page is the quickest way to hand it over.

## Sign-off

Record the date, hardware, browser and version, and a Pass / Fail / Pending mark for each of the fifteen items. The slice is not hardened until every item passes in Chrome, Safari and Firefox, with nothing left pending.
