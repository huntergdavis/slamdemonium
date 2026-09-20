# Contributor guide

How the Slamdemonium Racing team works. This page is for the people and agents building the game. Players never need it; the public face of the project is [README.md](../README.md), and it stays about the game only.

## Roles and ownership

| Role | Agent | Owns | Working copy |
|------|-------|------|--------------|
| CTO/CPO | Hunter | Goals, direction, final say on design defaults and scope | |
| PM | Claude | `BACKLOG.md`, `QUESTIONS.md`, the `main` branch, every merge | `slamdemonium/` (canonical) |
| Developer 1 | Codex | Scaffold, physics adapter and main loop, vehicle model, rendering, `docs/DECISIONS.md` | `slamdemonium-for-developer-1/` |
| Developer 2 | Codex | Tuning schema and store, input, world, Options UI, HUD and telemetry | `slamdemonium-for-developer-2/` |
| Designer | Codex | Visual direction, procedural materials, HUD and panel mockups, `docs/design/` | `slamdemonium-for-designer/` |
| Research / SME | Codex | Theme, vibe, subject-matter notes, `docs/research/` | `slamdemonium-for-research/` |
| DevOps | Codex | `.github/`, CI, GitHub Pages deploy, branch protection | `slamdemonium-for-devops/` |
| Technical writer | Claude | `README.md`, everything else in `docs/`, screenshots | `slamdemonium-for-techwriter/` |

Ownership means you are the one who edits that thing. If you need a change in something you do not own, ask the owner (see "Talking to each other" below). The one exception: the PM may make small fixes directly on `main`.

Work packages and their current owners are in [BACKLOG.md](../BACKLOG.md). The design brief that every work package points back to is [docs/vertical-slice-design.md](vertical-slice-design.md); section 14 lists the packages and gates.

## Branches and pull requests

1. Before starting any task: `git pull --rebase origin main`.
2. Create a branch named `<role>/<short-topic>`. Examples: `dev1/wp1-physics-loop`, `dev2/wp2-tuning`, `research/jolt`, `design/direction`, `devops/ci`, `docs/glossary`.
3. Commit small and often. Write the commit subject as what the change does.
4. Push and open a PR with `gh pr create`. Put a short summary and a test plan in the body.
5. Ping the PM with the PR link (see below). The PM reviews and merges. Nobody else merges, and nobody commits to `main` directly.
6. After a merge, the PM tells everyone to pull. Do it before your next task, even if you think nothing changed.

Keep PRs to one topic. A one-line fix gets its own branch and PR rather than riding along in something unrelated.

## Talking to each other

Everyone reports to the PM. Ping the PM whenever you finish a task, open a PR, get blocked, or have a question, without waiting to be asked:

```
herdr pane run wH:p1 "[from <role>] <DONE|PR|BLOCKED|QUESTION> <one line, plus PR link if any>"
```

You may message a peer directly for a **narrow technical clarification**: an exact export name, a file path, an interface shape. Copy the PM on every peer message. Anything that touches scope, ownership, design defaults or deadlines goes through the PM only.

| Who | Pane |
|-----|------|
| PM | `wH:p1` |
| Developer 1 | `wH:p7` |
| Developer 2 | `wH:pA` |
| Designer | `wH:p8` |
| Research | `wH:p9` |
| DevOps | `wH:pC` |

Questions for the CTO go through the PM. The PM records them and the answers in [QUESTIONS.md](../QUESTIONS.md). If an open question in design section 16 blocks you, take the option marked "default", note it in `docs/DECISIONS.md`, and keep going.

## Where things live

| Path | What it is | Owner |
|---|---|---|
| `README.md` | Public face: what the game is, how to run it, how to play, screenshots. Nothing about the team or process. | Technical writer |
| `docs/vertical-slice-design.md` | The design brief. Read it once top to bottom, then use it as a reference. | CTO |
| `docs/DECISIONS.md` | Running log of technical decisions: spike results, engine go/no-go, dependency additions, any changed default and why. Append, do not rewrite history. | Developer 1 |
| `docs/research/` | Research notes: Jolt integration, drift assist control laws, speed and vibe references. | Research |
| `docs/design/` | Visual direction, palette, mockups. | Designer |
| `docs/TUNING_PLAYBOOK.md` | Symptom to slider. Mirrors design 7.4 and the in-game help panel; change both together. | Technical writer |
| `docs/GLOSSARY.md` | Plain-language terms for tuners. | Technical writer |
| `docs/QA_CHECKLIST.md` | Manual QA on real hardware: steps, pass and fail for each item. | Technical writer |
| `docs/screenshots/` | Images used by the docs. Naming rules inside. | Technical writer |
| `docs/TEAM.md` | This page. | Technical writer |
| `BACKLOG.md` | Work packages, owners, status. Agents do not edit it; ping the PM. | PM |
| `QUESTIONS.md` | Questions for the CTO and their answers. | PM |
| `.github/` | CI and deploy workflows. | DevOps |

## Working agreements from the design doc

These come from design section 14 and apply to all code:

- TypeScript `strict`, no `any` in `vehicle/` or `physics/`.
- No new runtime dependencies beyond three.js and `jolt-physics` without a note in `docs/DECISIONS.md`.
- Hot-path functions (step, tires, suspension, camera update) allocate nothing. A test or lint rule watches heap growth.
- Every default in design 7.2 is a starting guess. Do not change one without recording why in `docs/DECISIONS.md`. Do make it easy to change.
- No product name in code identifiers. Use the single `GAME_NAME` constant. In prose, write Slamdemonium Racing.
- No `Jolt.*` type outside `src/physics/joltWorld.ts`.

## Checklist: fill in the README "Run it" section after WP0 merges

Owner: technical writer. Do this the day the scaffold lands.

1. `git pull --rebase origin main`, then open `package.json` and read the `scripts` block.
2. Run each script once locally and confirm it works: install, dev, test, e2e, build. Note the dev server URL Vite prints.
3. On a `docs/run-it` branch, replace the placeholder note and command block in README.md with the real commands and the real URL. Keep it player-facing: what to type, what to open, what key to press first. No mention of work packages, agents or CI.
4. If the Pages deploy (O2) is live, add the public URL as the first line of "Run it" so a player can skip the install.
5. Delete the "still landing" note. Check that every command in the block is copy-pasteable.
6. Take the first screenshot once the scene renders, store it under `docs/screenshots/` following the naming rules there, and reference it from README.md.
7. Open the PR and ping the PM.
