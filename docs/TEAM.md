# Team and workflow

Internal notes for the people and agents building Slamdemonium Racing. Players never need this page.

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

Developers own core systems (physics, vehicle model, tuning, UI). The designer owns graphics and visual direction. Research owns theme, vibe and subject-matter notes. The technical writer owns README.md and `docs/`. DevOps owns `.github/`, CI and the GitHub Pages deploy.

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
