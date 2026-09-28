# NS2: what the active-physics ceiling actually is, and what each way past it costs

**The bill is per awake body, about 17 µs each separated and 30 to 40 µs each in contact, at 120 Hz on this build. Asleep bodies and static bodies are free at any count we can afford in memory. The 128 promotion cap exists because the streamer wakes every body it promotes; promote them asleep and the cap stops being the limit. What survives a pileup is the awake count, and a pileup of 128 costs 7 ms p99 for a few seconds whatever we do upstream.**

Measured 2026-09-25 on the real Jolt WASM build through the game's own physics adapter, in Node (same WASM, different JIT host than the browser: ratios are trustworthy, absolutes are within roughly a third of the Chromium perf gate, which measured 1.70 ms p99 for 128 separated awake bodies where this rig measures 2.42 ms average over the first half second). Probes and how to run them: `scripts/perf/probes/README.md`. Raw results: `docs/research/ns2-ceiling-data/*.json`. The tables below quote the first sweep; the stored files are a second sweep of the same probes, and the two agree within about 25% case by case (for example 128 separated awake: 2.42 against 2.07 ms average; the 128 heap under the car: 7.2 against 6.3 ms p99). That spread is the run-to-run noise of wall-clock timing on this host, and no conclusion here rests on a difference smaller than it. These are measurements and options, not a decision; the CTO chooses.

## 1. What is expensive

| Situation (pooled 15 kg 1 m boxes, flat ground, no car)       | Step cost            | Per awake body   |
| ------------------------------------------------------------- | -------------------- | ---------------- |
| 64 separated, awake (first 0.5 s after activation)            | 1.40 ms avg          | 22 µs            |
| 128 separated, awake                                          | 2.42 ms avg          | 19 µs            |
| 256 separated, awake                                          | 4.19 ms avg          | 16 µs            |
| 1024 separated, awake                                         | 17.2 ms avg          | 17 µs            |
| 2048 separated, awake                                         | 40.3 ms avg          | 20 µs            |
| the same, once asleep (0.5 s later), any count to 7000        | 0.005 to 0.012 ms    | 0                |
| 7000 static, resident                                         | 0.005 ms             | 0                |
| 64 touching (4×4×4 stack), kept awake by a nudge every 0.25 s | 3.13 ms avg, 4.9 p99 | 49 µs            |
| 128 as 8 islands of 16, churned                               | 3.5 ms avg, 7.1 p99  | 27 µs            |
| 128 as 4 islands of 32, churned                               | 5.2 ms avg, 8.5 p99  | 40 µs            |
| 256 as 8 islands of 32, churned                               | 9.2 ms avg, 15.8 p99 | 36 µs            |
| pileup, 64 dropped into a 4 m column, settling (first 2 s)    | 1.9 ms avg, 3.4 p99  | 30 µs            |
| pileup, 128, settling                                         | 4.2 ms avg, 7.4 p99  | 33 µs            |
| pileup, 256, settling                                         | 8.7 ms avg, 16.8 p99 | 34 µs            |
| pileup, 128, 4 to 6 s after the drop                          | 1.1 ms avg, 2.9 p99  | (87 still awake) |

So: **the count of awake bodies is the cost**, contact roughly doubles the per-body price, and island size beyond that hardly matters (8 islands of 16 and 4 of 32 cost within 50% of each other; one heap of 128 costs the same per body as 8 islands of 16). The earlier phase-two probe's 16.8 ms at 64 touching bodies did not reproduce with this geometry (a 4×4×4 stack, or a 64-box heap, costs 3 to 5 ms here); the 256-body heap does reach 16.8 ms. Treat "touching" as a 2× multiplier on awake bodies, not a 10× cliff.

**Where the time goes.** Solver iterations are a minor lever: dropping the global solver from 10 velocity / 2 position iterations to 2 / 1 changed the churned 64-island from 2.9 to 2.2 ms average and the settling 128-pile from 3.6 to 2.6 (20 to 30%), and 6/1 and 4/1 sat in between. Manifold reduction on or off changed nothing measurable. The remaining 70 to 80% is per-body work that every awake body pays whether or not it touches anything: integration, broadphase update and pair finding, narrowphase for the pairs it has. That is why separated awake bodies are not cheap either.

**Activation itself has a cliff.** Adding N bodies awake in one step costs a spike proportional to N: 128 at once 8.5 ms, 512 36 ms, 1024 112 ms, 2048 212 ms, 7000 1.7 s (the broadphase rebuild). Today's streamer promotes up to 128 in one update at boot and on respawn; whatever route is chosen, promotions must be spread over steps.

**Streaming is not the ceiling.** The streamer's own update, the part that walks records, is cell-bounded: 0.03 to 0.05 ms average and under 0.35 ms p99 at 19,000 records and at 60,000 records on a 10 km strip with the car at 60 m/s (`stream-scan.probe.ts`). The 256-record "content ceiling" recorded on 2026-09-24 was the physics cost of the up-to-128 bodies the streamer wakes near the car, not the record walk.

## 2. Promotion churn: today's way against the sleeping way

The car drives a strip at 60 m/s; every promoted body is placed at rest on the ground, exactly as the streamer does today (added awake, sleeps 0.5 s later) or added and asleep within 0.05 s (what `EActivation_DontActivate` would give). Rolling window of 128 live bodies, nothing touching anything.

| Promotions per second (props per metre at 60 m/s) | Awake bodies, today | Cost today, avg / p99 | Awake, asleep route | Cost, asleep route |
| ------------------------------------------------- | ------------------- | --------------------- | ------------------- | ------------------ |
| 10 (0.17 /m)                                      | 5                   | 0.08 / 0.12 ms        | 1                   | 0.03 / 0.13 ms     |
| 30 (0.5 /m)                                       | 15                  | 0.18 / 0.27           | 1                   | 0.07 / 0.17        |
| 60 (1 /m)                                         | 30                  | 0.49 / 0.90           | 2                   | 0.12 / 0.23        |
| 120 (2 /m)                                        | 60                  | 1.00 / 1.64           | 5                   | 0.22 / 0.37        |
| 240 (4 /m)                                        | 120                 | 1.82 / 3.55           | 10                  | 0.23 / 0.47        |

Today, density alone eats the 2 ms gate at about 2 props per metre of route at 60 m/s, with nothing hit. Asleep, 4 props per metre costs a quarter of a millisecond and the awake set is whatever the car has actually disturbed. **Sleeping bodies do wake when hit:** a sleeping island of 64 hit by one box at 30 m/s went to 65 awake within a step, cost 2.8 ms average for the first second, and was fully asleep again 2.5 s later.

## 3. The real car through it (survives a pileup?)

Script vehicle harness, real `Vehicle`, flat plane, boxes placed at rest and asleep before the run. The car spawns 80 m short of the field and drives through under full throttle.

| Run                                                    | Peak awake | During the pass, avg / p95 / p99 (max) | 5 s after              |
| ------------------------------------------------------ | ---------- | -------------------------------------- | ---------------------- |
| car alone, 30 m/s                                      | 1          | 0.45 / 0.92 / 1.21 ms                  | 0.32 ms                |
| 256 sleeping boxes in a 40 m lane over 400 m, 30 m/s   | 28         | 0.69 / 1.29 / 1.68                     | 0.49                   |
| 1024 sleeping in the same lane (25 per 100 m²), 30 m/s | 94         | 1.63 / 3.59 / 5.10 (6.3)               | 0.79                   |
| 1024, 60 m/s                                           | 83         | 2.14 / 3.56 / 4.76 (8.4)               | 2.0 (72 still rolling) |
| heap of 64 dead ahead, 30 m/s                          | 65         | 1.17 / 2.45 / 2.93 (6.8)               | 1.56 (16 awake)        |
| heap of 128, 30 m/s                                    | 129        | 1.83 / 5.27 / 7.24 (9.0)               | 0.97 (7 awake)         |
| 1024 field plus a heap of 64, 40 m/s                   | 141        | 2.61 / 6.07 / 8.02 (15.6)              | 0.65                   |

The pileup is the payoff and it costs what it costs: ~30 µs per body the car has set moving, for as long as they move. A 128-body heap is 7 ms p99 at 120 Hz for two to three seconds, then it sleeps. Nothing upstream changes that number; only how many bodies are in the heap, how fast they sleep, and how much per-body work each one does.

## 4. The honest reachable numbers

- **Resident in the simulation:** thousands, free. 7000 dynamic bodies asleep cost 0.007 ms per step; the limits are `mMaxBodies` (8192 today; 19,000 bodies measured at 41 MB of the 128 MiB heap on 2026-09-23) and boot time to create them. A 10 km track at 1 to 2 props per metre is 10,000 to 20,000 records; with streaming cells only the ones within the exit radius need to be resident, so a pool of about 2048 covers 4 props per metre at a 130 m exit radius without touching `mMaxBodies`.
- **Awake, under the 2 ms p99 step gate with the car's own 0.5 to 1.2 ms:** about 40 to 50 bodies in contact, or about 80 separated and rolling. That is the shape of any budget that holds the gate.
- **Awake, if a transient over the gate is acceptable:** a 128-body pileup is 7 ms p99 per physics step; at 120 Hz that is two steps per 60 Hz frame, so 14 ms of physics inside a 16.7 ms frame for two to three seconds, then back under 1 ms. A hitch, not a collapse, and independent of render scale. This is a judgement about what the gate means, not a build.

## 5. The routes, costed

**A. Promote asleep, budget the awake set (my layer, no physics change).** The streamer adds pooled bodies with `EActivation_DontActivate`; the promotion cap is replaced by a pool size (say 2048) and the streamer spreads promotions over steps. Density stops costing anything until the car disturbs it: at 4 props per metre and 60 m/s, 0.23 ms average against 1.82 today. The 8192 body ceiling and the 128 MiB heap are untouched. Cost: a few hundred lines in `propStreaming.ts`, `bodyPool.ts` and one adapter flag on `activateBody`; the far visual and cells already scale (60,000 records measured). Risk: none found; sleeping bodies wake on contact (measured). This does not make pileups cheaper; it makes everything that is not a pileup free.

**B. An awake budget instead of a body cap (with A).** Jolt reports the active-body count each step. Over a budget (for example 64, chosen against the table in §3), the streamer puts the awake bodies farthest from the car, or slowest, back to sleep in place. This is the only route that bounds the pileup: 128 in a heap would cost what 64 cost (2.9 ms p99 measured for a 64 heap) with the far half frozen mid-tumble. Visible cost: a box that stops rolling early, 30 m behind the car. The CTO should see it before it is chosen.

**C. Cheaper awake bodies (physics settings, Codex's file).** Per-body solver override for props only (`mNumVelocityStepsOverride` 2 or 4, position 1; the car keeps 10/2): 20 to 30% off island and pileup cost, measured globally here. Sleep sooner: `mTimeBeforeSleep` 0.5 to 0.2 s shortens every awake episode; not separately measured but the awake-time arithmetic is direct. Shapes: untested; per-body overhead dominates, so a sphere would shave the contact part only. Together, perhaps 30 to 40% off a pileup, never a change of order.

**D. Bigger world (`mMaxBodies`, pool at boot).** Only needed if content wants everything resident rather than streamed. 19,000 bodies fit the heap (41 MB measured earlier); creating them at boot is the cost to measure, plus the streamer stays for the visual side anyway. Not needed for a 10 km track at the densities above with route A.

**What is not a route.** Fewer physics steps per second: the fixed 120 Hz step is a design MUST and everything tuned rests on it. Smaller cells or a tighter promotion radius: the walk is already cheap, and the radius is about giving the far visual and the body time to be there before the car is.

## 6. Caveats

- Node, not Chromium: same WASM, so the ratios hold; the perf gate's own Chromium numbers run about a third lower than this rig for the one case both measured.
- No debris in these runs. Breaking a prop spawns fragments from the 768 pool, each an awake body at the same price; a chain that breaks 20 props is 160 more awake bodies for a second or two. That is the same currency and the same budget.
- Render scale: none of these numbers depends on it. Codex's mesh consolidation (#151) changes the frame time the CTO has left for physics, not the physics cost; if his render scale lifts off 0.60, a pileup hitch becomes less visible, not cheaper.
- Two readings (active-body count, solver levers) needed a one-line local hook on the Jolt world that is not committed; the probe README carries it.
