# Slamdemonium Racing

A fast, loud, crash-happy arcade racer that runs in a browser tab. Built by a small team of AI agents directed by a human CTO.

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

The full brief is in [docs/vertical-slice-design.md](docs/vertical-slice-design.md). Work is tracked in [BACKLOG.md](BACKLOG.md). When you are tuning and something feels wrong, start with [docs/TUNING_PLAYBOOK.md](docs/TUNING_PLAYBOOK.md).

## Run it

> **TODO (techwriter):** exact commands land here once the WP0 scaffold merges. Expected shape below; treat it as a preview until this note is gone.

The stack is Vite, TypeScript (strict), three.js and Jolt Physics compiled to WebAssembly. Nothing needs a server beyond a static file host.

```sh
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run e2e        # end-to-end tests (Playwright, headless Chromium)
npm run build      # production build to dist/
```

Open the URL Vite prints, press **W** and go. Press **O** for the options panel.

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

## Team

| Role | Agent | Working copy |
|------|-------|--------------|
| CTO/CPO | Hunter | sets goals and direction |
| PM | Claude | `slamdemonium/` (canonical, owns `main`) |
| Developer 1 | Codex | `slamdemonium-for-developer-1/` |
| Developer 2 | Codex | `slamdemonium-for-developer-2/` |
| Designer | Codex | `slamdemonium-for-designer/` |
| Technical writer | Claude | `slamdemonium-for-techwriter/` |
| Research / SME | Codex | `slamdemonium-for-research/` |
| DevOps | Codex | `slamdemonium-for-devops/` |

Developers own core systems (physics, vehicle model, tuning, UI). The designer owns graphics and visual direction. Research owns theme, vibe and subject-matter notes. The technical writer owns this README and `docs/`. DevOps owns `.github/`, CI and the GitHub Pages deploy.

## Workflow

- `main` belongs to the PM. Nobody commits to it directly.
- Before starting any task: `git pull --rebase origin main`.
- Work on a branch named `<role>/<short-topic>` (for example `dev1/wp1-physics-loop` or `docs/readme`). Commit small and often.
- Push the branch and open a pull request with `gh pr create`. The PM reviews and merges.
- After a merge the PM tells everyone to pull again.
- The backlog lives in [BACKLOG.md](BACKLOG.md). Only the PM edits it.
- Questions for the CTO go in [QUESTIONS.md](QUESTIONS.md) via the PM.
- Design decisions and spike results are logged in `docs/DECISIONS.md` (owned by developer 1).

## Repository map

| Path | What it is |
|---|---|
| `docs/vertical-slice-design.md` | The design brief for the feel lab. Read this first. |
| `docs/TUNING_PLAYBOOK.md` | Symptom to slider: what to turn when the car feels wrong. |
| `docs/DECISIONS.md` | Running log of technical decisions. |
| `docs/research/` | Research notes (physics engine integration, drift assists, speed and vibe references). |
| `docs/design/` | Visual direction and mockups. |
| `docs/screenshots/` | Screenshots used in the docs. |
| `BACKLOG.md` | Work packages and who owns them. |
| `QUESTIONS.md` | Open questions for the CTO and their answers. |
