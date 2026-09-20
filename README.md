# Slamdemonium Racing
[![CI](https://github.com/huntergdavis/slamdemonium/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/huntergdavis/slamdemonium/actions/workflows/ci.yml)
[Play Slamdemonium Racing](https://hunterdavis.com/slamdemonium/)

A fast, loud, crash-happy arcade racer that runs in a browser tab.

## What this is right now

Slamdemonium Racing is not a game yet. The first milestone is a **driving-feel laboratory**:

> A plain box drives around a big paved circle in 3D. Every number that shapes how it accelerates, brakes, grips, slides and drifts is a slider on an options page that applies live. Overlays show what the physics is doing. A human can sit in it for an hour and find the fun.

Why start here? Browser racers usually fail on one thing: the driving does not feel right. Too floaty, too sim-heavy, or too sticky, and the speed never lands. If the box feels fast and fun on flat pavement, everything else (car models, crashes, traffic, opponents) is content on a foundation that works. If it does not, no content will save it.

The lab is built around six design pillars:

1. **Speed is felt, not read.** Punchy acceleration, a world that streams past, a camera and field of view that react to speed.
2. **Drifting is easy to start and rewarding to hold.** Grip hard, let go progressively, catch it, charge the boost meter.
3. **Braking is powerful and predictable.** Late braking is a tactic. Brake response is a real curve, not one number.
4. **Assists are dials, not walls.** Every arcade assist is a slider that goes to zero.
5. **Tunability beats correctness.** Any physical shortcut is fine if it feels better and has a slider.
6. **Latency is a feature.** Input-to-motion delay is measured and minimized.

When you are tuning and something feels wrong, start with [docs/TUNING_PLAYBOOK.md](docs/TUNING_PLAYBOOK.md). The full design brief is [docs/vertical-slice-design.md](docs/vertical-slice-design.md).

## Run it

You need [Node.js](https://nodejs.org) 22 or newer. Then, from the project folder:

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173/> in Chrome, Firefox or Safari, click the page, press **W** and go. Press **O** for the options panel. Changes to the code reload in place while the dev server runs.

To build a standalone copy for any static web host:

```sh
npm run build
```

The result lands in `dist/`. Nothing on the server side is required.

Screenshots will live in `docs/screenshots/` once there is something to look at.

## Controls

A gamepad is the reference experience because analog triggers matter for feel. Keyboard is the accessible fallback, with ramped steering and pedal filters so it still feels good.

### Keyboard

| Action | Keys |
|---|---|
| Throttle | W, Up |
| Brake / reverse | S, Down |
| Steer | A / D, Left / Right |
| Handbrake | Space |
| Boost | Left Shift |
| Respawn | R |
| Options panel | O |
| HUD mode (full / minimal / off) | H |
| Debug gizmos | G |
| Camera preset (chase / far / hood) | C |
| Slow motion toggle (0.25x) | T |
| Pause | P |
| Latency probe | L |
| A/B tuning swap | Tab |
| Telemetry recording (CSV) | F9 |

### Gamepad (standard mapping)

| Action | Control |
|---|---|
| Throttle | Right trigger (analog) |
| Brake / reverse | Left trigger (analog) |
| Steer | Left stick X |
| Handbrake | A |
| Boost | X |
| Respawn | Y |
| Options panel | Start |
