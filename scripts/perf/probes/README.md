# Physics ceiling probes (NS2)

Measurement only, never a gate. Each probe builds fresh Jolt worlds through
`createPhysicsWorld` (the game's own adapter), places pooled 15 kg 1 m boxes
(the breakable descriptor from `src/world/bodyPool.ts`) and times
`world.step(1/120)` alone. Results are written to `scratch/*.json`.

```
npx vitest run --config vitest.probes.config.ts            # all
PROBE_FILTER=island64 npx vitest run --config vitest.probes.config.ts island
```

Run them on an idle host, one at a time: they time wall-clock steps.

Two readings need the raw Jolt system (active-body count, solver settings),
which the adapter deliberately does not expose. For those, apply this local,
uncommitted line in `src/physics/joltWorld.ts` after `physics.SetPhysicsSettings(physicsSettings);`:

```ts
(globalThis as unknown as { __joltProbe?: unknown }).__joltProbe = { physics, J };
```

Without it the probes still run; active counts read as -1 and solver levers
are skipped. Findings: `docs/research/ns2-physics-ceiling.md`.
