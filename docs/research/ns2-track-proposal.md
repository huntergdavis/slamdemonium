# NS2, the 10 km track: a proposal in four answers

The CTO's requirement: a track "much, much longer... it should take a full 3 minutes to drive it at full speed". At cruise that is about 10 km. Nothing here is built into the game yet: the road generator and the circuit exist as data (`scripts/track/roadGenerator.ts`, `scripts/track/circuit.ts`, outside the runtime until he chooses: the reachability gate rightly refuses unwired features in src), the numbers below are measured on them, and the map is wired in only after he chooses. Written 2026-09-28; measurements 05:52 to 05:54 PDT.

## 1. The shape: a circuit, and the lap is the timed run

**Recommendation: a closed circuit whose lap is the NS3 timed run.** The start box is at station 0, three checkpoints at 2.5, 5 and 7.5 km, the goal 20 m short of the start line; "three minutes to drive it" is one lap. Enter puts him on the start line as it does today; a run ends where it began, so the car is always on the road and there is never a far end to be teleported home from; free driving keeps lapping. A point-to-point run of 10 km needs a second spawn, a return trip that is not a run, and a mini-map twice the size; nothing about his words asks for that.

The generator does both. A plan is straights and arcs; sampling it gives a centreline with a heading every 4 m; lanes, shoulder props, set pieces and gates are placed by station along it, so moving a set piece is one number, and a closure check tells an author when a lap does not return to its line (this one closes to a millimetre).

**The lap:** a rounded rectangle 3.6 km by 1.7 km with 300 m corners, plus a lane-change chicane pair on the first long straight: 10,104 m. At 60 m/s the straights are flat out; a 300 m corner at 60 m/s asks 1.2 g of the tyres, so the corners are where the lap is won or lost. If he would rather take every corner flat, the corner radius is one number (400 m makes them 0.9 g) and the lap grows to 10.6 km.

## 2. What is on it, and how dense

By station from the start line (the west side, heading north, the lap turns left):

| Station          | Set piece                                                                 | Why there                                                                 |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 0.3, 0.4, 0.5 km | three accelerator pads                                                    | the launch off the line                                                   |
| 0.7 to 1.9 km    | the chicane pair (two 30 degree lane changes, 200 m radius)               | the first thing that is not a straight, with prop clusters at both apexes |
| 2.0 km           | the giant ramp (40 m faces, 9 m lip, symmetric)                           | the jump, with 1 km of run-up, landing 400 m before corner one            |
| 4.05 km          | the forgiving 18 m loop with shoulders (the one he called great)          | on the first short side, 300 m after the corner, 470 m before the next    |
| 5.3, 5.4, 5.5 km | three pads                                                                | the launch onto the second long straight                                  |
| 6.6 km           | the aquifer, 60 m to the left of the second straight, axis along the road | a dip off the line and back; the entry lane is to author                  |
| 8.65 km          | the hard 14 m loop, sticky                                                | on the second short side; the control loop stays available                |
| 9.5 km           | a prop cluster                                                            | the last corner                                                           |
| 2.5, 5, 7.5 km   | checkpoints                                                               | a straight run across the infield does not count                          |

**Density: 1.5 props per metre of road along both shoulders, 11 to 24 m off the centreline, plus six twelve-prop clusters: 15,227 records.** That is the population the ceiling work paid for: the proving ground has 256. Corners and straights alike; the shoulders are never empty for more than a few metres, and the road itself is clear. A denser village (4 per metre) costs 0.23 ms at 60 m/s by the earlier measurement and is a slider on the generator if he wants one.

## 3. What it costs, measured

**Boot** (Node, `scripts/perf/probes/track.probe.ts`): generating the circuit 92 ms, building 15,227 records 44 ms, creating the 2,816 pooled bodies 280 ms, the streamer 20 ms: about 440 ms on top of today's boot, once. **Memory:** the pools take 1.2 MiB of the 128 MiB WASM heap; 20.8 MiB used after a full lap, unchanged from after boot (nothing is created mid-lap).

**The lap** (the car's body carried round the whole 10.1 km at 60 m/s, real pools, props, streamer and awake budget, 20,208 steps): physics plus streaming **0.62 ms average, 1.55 ms p99** per step; about 330 props resident and asleep around the car at any moment, one body awake (the car). Under the 2 ms gate with room. One 61 ms step in 20,208, at the start (the first promotion batch plus a garbage collection); the hosted perf gate will say whether it recurs.

**Render, what I can count:** the paved disc is one ring geometry; the road paint is 505 lane chunks giving 2,020 instances in one batch; 1,800 barrier boxes in one batch (static bodies, free); 15,227 far-field props in one instanced mesh; the shadow box is unchanged at 80 m. Draw calls do not scale with the track; instance counts do, and these are small.

**Render, what does not fit yet, and must change in the build: the far-field visual's per-frame scan.** It rescales impostors by distance and walks every record each frame: **3.7 ms average, 8 ms p99, per frame** over 15,227 records (`far-visual.probe.ts`), a quarter of a 60 Hz frame on the main thread, plus a full 975 KB instance-matrix upload whenever anything moved. The fix is mine and mechanical: walk only the streamer's cells within the far radius (about 160 cells of 825) and mark partial buffer ranges; expected well under 0.5 ms. It is the one item that turns from "measured fine" into "must be built" for this track, and it is in the build plan below.

**Not measured here:** frame time on his machine with a 2.15 km paved disc, its edge ring, and 15,000 distant instances in view. Nothing in the counts suggests trouble, and the far field is what the glow and impostor sliders already tune.

## 4. Does the proving ground survive

**Recommendation: yes, as the second map; the circuit is where the timed run lives.** He likes the proving ground, its two loops are the bench the loop rule was measured on, and the map switch already exists (`?map=`). The circuit becomes the default boot map only if he says so; otherwise he chooses it. What I would not do is fold the proving ground's targets into the circuit and delete it: the 400 m disc is a lab, the circuit is a lap, and they answer different questions.

## What building it means, if he chooses this

1. Wire the circuit as a third map: map-owned prop placements (today they are one constant), the mini-map at a 2.2 km range drawn as the route outline rather than landmarks, the spawn 40 m short of the start line.
2. The far-field visual's cell-bounded rescale and partial uploads (the must-fix above), measured before and after.
3. The aquifer's entry lane and the loops' exit lanes (a loop exits 27 m to one side; a painted return to the road).
4. The timed run's gates from the circuit (already generated); the goal 20 m short of the start.
5. The hosted perf gate on the circuit, and his drive.

His decisions: corner radius (300 m as proposed, or 400 m for flat-out corners); the default map; which set pieces are in the first cut (all of the above, or fewer).
