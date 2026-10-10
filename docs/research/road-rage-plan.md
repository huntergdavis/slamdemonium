# Road Rage on the takedown road — build plan

**Player outcome.** Choose **Road Rage** on the existing takedown road, see **3, 2, 1, GO**, and hunt rival takedowns for three minutes. The driving HUD shows time left, count/next target and wrecks left. Time-out or the third player wreck opens a medal/result screen; **Enter** retries from a clean start in ≤2 seconds. A personal best survives reload. This adapts the event/result essentials of [roadmap E1/E2](https://github.com/huntergdavis/slamdemonium/pull/179) to today's takedown map; the planned city route can come later.

## Rules and scope

- Launch from the map picker at the current spawn with a visible start line. Hold player input during the three-second countdown; begin rival aggression grace and scoring at GO. The **180 simulated-second** clock stops on pause and at results. A medal target does not finish the run early. Keep a direct free-drive URL for existing tests; no event hub.
- Count only the player's newly credited [`Takedowns`](../../src/core/takedowns.ts), never an AI-versus-AI `RIVAL DOWN` or another hit on the same wreck. Start with roadmap medals **3/6/9** (bronze/silver/gold), subject to CTO tuning. Four rivals already re-enter off-camera with new encounter IDs; prove at least three reachable rivals through the full run.
- Count each transition into [`PlayerDamage.wrecked`](../../src/core/playerDamage.ts) once. After wrecks one and two, use the existing nearest-road respawn; after two show **CRITICAL · 1 WRECK LEFT**. The third wreck ends the event before another respawn. Time-out earns the highest reached medal; wreck-out shows **FAILED / no medal** and its count. This proposed failure rule is for CTO approval.
- Results show reason, count, medal, best and **Enter to retry**. Best is the highest count on a completed timed run; fewer wrecks breaks a tie. Key local storage by event/rules version, map, car and gameplay-tuning fingerprint; blocked/corrupt storage falls back to a session best. Retry resets clock, count, boost, damage, rivals and wreck bodies without reloading or carrying stale contact credit.

**In:** countdown, persistent timer/target HUD even with optional HUD off, time-out/wreck-out, medal/result, versioned local best, one-key retry and safe rival re-entry. **Out:** city work, other E1 routes, GP/Eliminator, revenge meters, online boards, traffic checking, new cars and crash-audio changes.

## Two playable PRs

1. **Clock and score loop.** The CTO can select Road Rage, complete 180 seconds, see a 3/6/9 medal result and immediately retry. Add `src/core/roadRage.ts` for pure event state; wire `src/main.ts` to fixed steps and the existing Enter action; label/paint the entry in `src/world/takedownCourse.ts`; add an event reset to the existing pool in `src/world/traffic.ts`; extend `src/ui/hud.ts` and `src/ui/ui.css` for the persistent card/result. Add focused state and real-Jolt integration tests. **Gate:** two consecutive runs start with intact reachable rivals and zero count; countdown/finished contacts never score; AI wrecks never score; time-out freezes once; retry is throttle-ready in ≤2 s.
2. **Wreck budget and personal best.** The CTO can survive two wrecks, see the critical warning, fail on the third, then complete another run and reload its best. Extend `roadRage.ts`, `main.ts`, HUD/CSS and tests; add a small `src/core/roadRageBest.ts` storage adapter. Read `playerDamage.ts` without retuning it. **Gate:** repeat callbacks count one wreck, third wreck prevents auto-respawn, failure saves no best, blocked storage leaves the run playable, and ≥3 rivals remain reachable over 180 s.

One integrator owns `main.ts`, the event HUD and traffic reset across both PRs. Start after the crash-audio branch clears any shared `main.ts` work.

## CTO drive approval and risks

Drive from the map picker through the countdown. Make a **wall** and a **traffic** takedown; see only credited rivals advance the target, then keep driving after bronze. Take two wrecks and read the warning, take a third and see a frozen failed result; press Enter and find a clean four-rival pack. In a separate run, reach time-out, read the medal/best, reload and confirm that best only for the same event identity. Try the mapped controller retry too.

The long-run risks are exhausted or visibly teleporting rivals, stale wreck colliders/credits on retry, and player hits during countdown. Capture moving re-entry, first pileup and retry, with rival/awake-body counts. Compare interleaved **vsync-off 720p** drives against same-day `main` on the UHD 620 at matched rival counts: median fps ≥0.95× main, full-step p99 ≤1.10× main and roadmap floor ≥20 fps. Test pause/slow-motion timing; the CTO's own drive decides whether the chase, warnings and result read clearly.
