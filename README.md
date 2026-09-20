# Slamdemonium

A game build, orchestrated by a team of agents.

## Team

| Role | Agent | Working copy |
|------|-------|--------------|
| CTO/CPO | Hunter | sets goals and direction |
| PM | Claude (Slamdemonium Command) | `slamdemonium/` (canonical, owns `main`) |
| Developer | Codex | `slamdemonium-for-developer-codex-2/` |
| Developer | Codex | `slamdemonium-for-developer-codex/` |
| Designer | Codex | `slamdemonium-for-designer/` |
| Technical writer | Claude | `slamdemonium-for-techwriter/` |
| Research / SME | Codex | `slamdemonium-for-research/` |

## Workflow

- `main` is owned by the PM. Nobody commits directly to `main`.
- Each agent works on a branch named `<role>/<short-topic>`, pushes it, and opens a PR.
- The PM reviews, merges, and tells everyone to `git pull --rebase origin main`.
- Backlog lives in `BACKLOG.md`. Questions for the CTO go in `QUESTIONS.md` via the PM.

More soon once the game is described.
