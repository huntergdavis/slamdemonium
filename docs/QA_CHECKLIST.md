# Manual QA checklist

For a human, on real hardware. Automated tests cover the numbers; this list covers what only a person can judge. It expands section 13.5 of the [design doc](vertical-slice-design.md) and the human-judged items from its section 3 acceptance list.

Run the whole list at least once in **Chrome** and once in **Safari** on an **M-series MacBook Air**, at a 1080p-equivalent window. Firefox is a bonus pass. Use a **gamepad** for the drift items; repeat them on keyboard afterwards.

> **Status:** the game is not yet drivable, so every item below is **pending** until the vehicle model (WP5) lands. Items that also need the HUD or Options page say so. Steps are written against the design; where the shipped game differs, fix this page.

## Before you start

1. Open the game fresh. Press **O**, choose the **Default** preset, click **Reset everything**, close the panel.
2. Press **H** until the full HUD is showing.
3. Note the browser, browser version, display refresh rate and window size at the top of your report.
4. Press **F9** to start a telemetry recording. Leave it running for the whole session; press **F9** again at the end to download the CSV.

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

Needs the Options page (WP7).

**Steps.** On the ring at speed, press **O**, switch Default to Grip, drive a corner, switch to Drifty, drive a corner, switch to Raw, drive a corner, switch back to Default. Keep driving throughout.

**Pass.** Each switch changes the car's behavior within a frame and without stopping, moving or resetting it. The HUD shows the active preset. The car does not jump, teleport or twitch when the mass-related values change.

**Fail.** A pause, freeze, teleport or speed change on switching. The car explodes, flips or spins without input. The preset name on the HUD does not match the dropdown. Any slider not moving to the preset's value.

### 7. Presets distinguishable blind within 30 seconds

Acceptance item from design section 3. Needs a second person.

**Steps.** The helper opens the Options page, picks Grip, Drifty or Raw at random, and hides the panel and the HUD's preset name (press **H** to minimal). You drive for up to 30 seconds and say which one it is. Do it six times in random order, mixing in repeats.

**Pass.** You name the preset correctly at least five times out of six, each within 30 seconds of driving.

**Fail.** Two or more wrong guesses, or regularly needing longer than 30 seconds. Note which pair you confuse; that is the tuning finding.

### 8. Drivable with every assist at zero

Acceptance item from design section 3.

**Steps.** Pick the **Raw** preset. Then also set `countersteerAssist`, `yawAssist` and `absStrength` to 0 by hand if they are not already, and check nothing in the Steering group is left above zero. Drive the ring for 60 seconds and try a drift.

**Pass.** The car drives. It can be twitchy and it is fine if you spin, but it responds to input, it can be caught with effort, and nothing invisible helps you. Once past the maximum drift angle there is no push back; you are on your own. No flicker, no NaN, no reset.

**Fail.** The car becomes uncontrollable in a way that has nothing to do with skill: an oscillation that grows on its own, a spin that never slows, a jump to NaN or a respawn you did not ask for. Or the opposite: you can feel a helper still straightening the car, which means an assist is not truly off.

### 9. Opening and closing the panel while driving

Needs the Options page (WP7).

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

Design target: sustained 60 FPS on the reference laptop. The performance harness measures it; you confirm it looks right.

**Steps.** Watch the FPS and physics-ms figures in the HUD text block during items 1, 2 and 5.

**Pass.** FPS stays at the display rate with no visible drops during drifts, skid marks or wall hits. Physics time per step stays well under a millisecond.

**Fail.** Visible frame drops in any of those moments, or physics time creeping upward over the session.

## Reporting a failure

A failure report is only useful if someone else can reproduce it. Before you write anything else, collect these:

1. **Telemetry CSV.** Press **F9** to stop the recording started at the beginning of the session; the CSV downloads. If the failure was mid-session, note the approximate time into the session so the reader can find it. The CSV header also carries the parameter set that was live when recording started.
2. **Parameter export.** Open the Options page and click **Export**. The JSON holds every slider value plus the change log of everything you touched, with timestamps.
3. **Active preset and A/B slot.** Read both off the HUD text block and write them down. If you were in slot B, say so and export A as well.
4. **Environment.** Browser and version, display refresh rate, window size, gamepad or keyboard.
5. **What happened.** The checklist item number, what you did in the few seconds before, what you saw, and what you expected. A short screen recording beats a paragraph.

Attach the CSV and JSON to the report. If the failure needs a specific setup to reproduce, a **Share link** from the Options page is the quickest way to hand it over.

## Sign-off

Record the date, hardware, browser and version, and a Pass / Fail / Pending mark for each of the twelve items. The slice is not hardened until every item passes in both Chrome and Safari.
