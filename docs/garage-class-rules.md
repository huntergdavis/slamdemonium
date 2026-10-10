# Garage class rules (A2, version 1)

Measurements are from the real-Jolt flat-road and wall/recovery guards at 120 Hz. The wall case starts each car at 16 m/s lateral speed against a static box; `onContact` identifies the hit, and post-hit lateral speed is read from the body. The Jolt binding does not expose solver impulse, so these measurements do not claim a measured impact impulse.

| Class   | Mass (kg) | Body W×H×L (m) | 0–30 m/s (s) | Turn radius at 14 / 28 m/s (m) | Normal / boosted ceiling (m/s) | Roof righting (s) |
| ------- | --------: | -------------: | -----------: | -----------------------------: | -----------------------------: | ----------------: |
| Compact |      1050 | 1.95×1.16×4.05 |         2.09 |                   5.93 / 16.01 |                        50 / 68 |              1.91 |
| Muscle  |      1650 | 2.35×1.25×5.40 |         2.31 |                  10.88 / 18.60 |                        54 / 74 |              1.90 |
| Coupe   |      1200 | 2.12×1.14×4.65 |         2.27 |                   6.06 / 16.90 |                        58 / 78 |              1.97 |
| Sports  |      1300 | 2.16×1.20×4.80 |         2.41 |                   7.40 / 17.00 |                        60 / 85 |              1.87 |
| Super   |      1400 | 2.25×1.10×4.95 |         2.30 |                   7.88 / 18.44 |                        65 / 87 |              1.98 |

The five cars share the Kenney Car Kit 3.1 sedan GLB: 2,088 triangles, six mesh primitives including four wheels, one 512² palette, and one active engine worklet voice. Class-specific upper-shell warps and far-cabin shapes create distinct silhouettes without another draw call or model asset. The real-Jolt wall guard recorded 2–222 chassis contacts depending on class and the post-hit lateral velocity reached −2.2 to −3.1 m/s; all cars stayed outside the wall and righted from a flat roof rest within 2 seconds. The Sports 85 m/s boost ceiling is retained from the existing approved car tune; Super reaches 87 m/s.
