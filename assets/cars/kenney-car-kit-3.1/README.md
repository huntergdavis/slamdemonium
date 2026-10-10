# Hero sedan source

- Source: [Kenney Car Kit 3.1](https://kenney.nl/assets/car-kit), archive downloaded from Kenney on 2026-10-09.
- Archive SHA-256: `fac7dacac5c7874348cf19729af3ef205f3d366493edaf0a827d93f4fdf3d0c4`.
- Selected files: `Models/GLB format/sedan-sports.glb` and its shared `Textures/colormap.png`.
- Licence: CC0; the original `License.txt` is retained as `LICENSE.txt`.
- The original GLB and PNG are retained unchanged. `sedan-sports-embedded.glb` is a derived copy with the same PNG embedded as a glTF buffer view, so Vite serves the model and palette through one hashed URL. No mesh or material data changed.
- Runtime placement, scale, colour choice and damage deformation are game code.
- The five garage silhouettes reuse this one licensed GLB and palette. Runtime upper-shell vertex warps and the existing class-scale transform give Compact, Muscle, Coupe, Sports and Super distinct profiles; wheel meshes and lower sill remain tied to their class-specific Jolt geometry. No extra model download or texture is introduced.

The GLB has six mesh primitives, including four named wheels, 2,088 triangles in total, and one 512×512 palette texture. Its authored front points toward local +Z; the game car drives toward local -Z, so the renderer rotates the imported visual without changing vehicle physics.
