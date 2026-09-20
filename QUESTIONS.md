# Questions for the CTO/CPO

Agents append questions here on their branch or tell the PM directly. The PM federates them to the CTO and records answers.

| # | From | Question | Answer |
|---|------|----------|--------|
| 1 | designer | Design 8.5: should Tab swap A/B while focus is inside the Options panel? | PM decision 2026-09-20: Tab swaps A/B when the game has focus, navigates controls inside the panel; panel gets explicit A/B buttons. Recorded in D1 doc. |
| 2 | research (R2) | Design 6.8 C: at full counter-steer the published law targets 3 deg, not 0, so a drift cannot be cleanly exited; and the soft limiter can stay active when yawAssist=0, violating acceptance criterion "all assists can be set to zero". | PM decision 2026-09-20: approved research's replacement (latched drift side, captured neutral angle, true zero-angle exit with hysteresis, bounded PD, limiter gated by yawAssist). Design 6.8 C explicitly permits replacing the structure while keeping parameter names yawAssist and maxDriftAngle. WP5c implements docs/research/drift-assist.md. FYI to CTO. |
| 3 | research (R3) | Design 10.1 FOV formula leaves `(speed/topSpeed)^1.5` unclamped, and boost raises speed above `topSpeed` by design, so the term exceeds 1. At defaults boosted FOV reaches 110.29 deg vertical; at legal slider extremes the raw formula yields 560 deg, which is not a valid perspective camera. | PM decision 2026-09-20: WP6 MUST bound the delivered FOV. Clamp the final value to a finite range strictly inside 0-180 deg, with 115 deg vertical as the initial ceiling to playtest, and expose delivered FOV plus whether the cap is active in debug telemetry so tuning stays honest. Slider ranges and defaults in 7.2 are unchanged. FYI to CTO. |
