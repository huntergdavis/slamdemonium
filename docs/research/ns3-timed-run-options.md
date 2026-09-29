# NS3, the timed run: three questions for the CTO, with a recommendation

**The CTO's shape:** the first game type is a timed run, "as we don't have many of the elements needed for racing in particular yet": no opponents, no grid, no laps. A countdown, a clock that runs, an end, and an instant retry. Nothing else unless he asks. Instant retry is built (Enter: again from the start, score cleared, same step as the press; see DECISIONS 2026-09-27). The rest waits on these three answers. Written 2026-09-27.

## 1. What ends the run

| Option                            | What it is                                                                | What it needs                                                                                                          | What it feels like                                                                         |
| --------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A. A fixed clock** (say 60 s)   | Do the most before the clock runs out                                     | Nothing we do not have: the crash score, a clock, the proving ground                                                   | Every run comparable; a sprint; the world he has today is enough                           |
| **B. Reaching somewhere**         | The clock runs from the start line to a finish line; the run is the route | A finish trigger (the proving ground's target line exists; the 10 km track has a natural end) and a route worth timing | A time trial; the clock is the score; needs a track that is a route, which NS2 is building |
| **C. He ends it** (press the key) | Free driving with a stopwatch                                             | Nothing                                                                                                                | Not a game verb; nothing pushes back                                                       |

**Recommendation: A now, B when the 10 km track exists, one shell for both.** The end condition is the only thing that differs (a clock reaching zero, or a line crossed); the countdown, the running clock, the end and retry are the same. On the proving ground there is no route, so a fixed clock is the honest run today; on the long track the finish line is the obvious end and the clock becomes the number. Not C.

## 2. What the run is for

| Option              | The number at the end                | Note                                                                                                                     |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **A. Destruction**  | The crash score total when it ends   | Already accumulates and is already on screen when it happens (the chain readout); a fixed clock makes it a score to beat |
| **B. A route time** | The clock at the finish              | The time-trial reading; needs option 1B                                                                                  |
| **C. Both**         | Time and score, or a combined number | A combined number nobody can read; two numbers is a results screen, which he has not asked for                           |

**Recommendation: one number per run, never combined.** Destruction with a fixed clock (1A + 2A) today; the route time with a finish line (1B + 2B) on the long track. If he wants both later, they are two run types, not one run with two numbers.

## 3. How he starts one

| Option                           | How                                                      | Note                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. A key**                     | Press Enter: 3, 2, 1, go                                 | The same key as retry, so start and again are one verb; no menu, no screen                                                                         |
| **B. A menu item**               | Pause menu, "Timed run"                                  | An extra screen and a mode switch he did not ask for                                                                                               |
| **C. Driving through something** | A start gate on the runway; crossing it starts the clock | Natural for a route (the finish is a gate anyway); on the proving ground it means an arch on the spawn runway and a countdown that is the approach |

**Recommendation: A, with C as the start of the route run later.** Enter arms the countdown from wherever he is stopped (retry already puts him on the start line), 3-2-1 on the persistent seam, then the clock. Not B. For the long track, the start line is a gate and the countdown is driving up to it.

## What goes on screen, whichever he picks

The countdown and the clock ride the persistent seam like the map, the drive card and the chain readout: shown during a run, gone after, never a fourth permanent element, HUD-off at boot unchanged. The final number stays up for a few seconds, then fades, the way the chain readout does; no results screen.
