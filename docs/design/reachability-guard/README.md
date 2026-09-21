# WP15 production-entry reachability guard

Run **npm run check:reachable** from the project. It exits 0 only when every .ts file under src/ is reachable through runtime imports from src/main.ts or has a reviewed exact-path exception. Every authored .ogg/.txt asset under src/ or assets/ must also have a runtime import. Missing/unprovable edges, unreachable assets and invalid exceptions exit 1. The script resolves the repository from its own location; the shell working directory cannot accidentally change the entry point.

This guards against the incident where Options, HUD, persistence and scripted input passed isolated tests but never reached the player entry. The failure names each file and explicitly says it ships in no bundle reachable from main and its feature is unreachable to a player. The correct fix for a gameplay module is runtime wiring, not importing its type or suppressing the diagnostic.

## Graph rules

- The installed TypeScript parser reads static imports and re-exports, including barrels, namespace exports, side-effect imports and cycles. The resolver uses the actual tsconfig (including paths and module resolution), extensionless imports, index modules and JS-specifier-to-TS resolution. Local code outside src/, such as assets/procedural/asphalt.ts, is traversed too, while the inventory remains every .ts under src/. No application code executes during the check.
- Literal dynamic imports are followed, including template literals without substitutions and conditional calls. This covers physics/joltWorld and input/testFixture. Literal CommonJS import assignments/require calls are also followed. Computed imports/require calls and import.meta.glob fail closed with the importer line/column; extend the analyzer rather than hiding their modules.
- Type-only imports/re-exports and import-type expressions do not establish runtime wiring. Mixed type/value clauses count. Clauses containing only inline type specifiers also do not count: with verbatimModuleSyntax TypeScript may retain an empty side-effect clause, but depending on that as feature wiring is not accepted. Write an explicit side-effect import when runtime initialization is intended.
- Resolved external packages, Node builtins and non-code assets are not traversed, including Vite WASM ?url and Markdown ?raw imports. Unresolved runtime code imports fail; a query on a code module cannot disguise it as a non-code asset. This is a conservative source graph: conditional imports count even if a particular build flag erases that branch. It does not prove that an imported factory was mounted, that a control works, or that every reachable export survives tree shaking. Browser integration tests remain necessary.

## Audio and licence assets

Literal relative or project-root-relative imports of .ogg and .txt files are
validated as asset leaves, including ?url&no-inline and ?raw queries. The checker
requires the file to exist and inventories these two extensions under src/ and
assets/. A file imported only by an unreachable module, a type-only import,
comment, or string remains unreachable. Unreferenced sounds and notices fail
with their paths and the player-facing consequence. These assets cannot enter
the module allowlist.

This is a narrow F1 content inventory, not an inventory of every image, provenance
file, documentation tree or installed dependency. Asset aliases/package paths
for these extensions fail closed until deliberately supported. Other existing
non-code asset handling and all runtime-module rules remain unchanged.

## Exceptions

scripts/reachability-allowlist.json is an array of objects containing exactly path and reason. Paths must match one existing src .ts file exactly; reasons must be nonempty single-line strings. Globs, directories, missing files, malformed entries, duplicates and exceptions that have become reachable fail the check. Exceptions neither seed the graph nor allow an entire dependency subtree.

The initial two exceptions are pure type contracts: physics/adapter.ts and render/carVisualState.ts. **Unwired runtime features must not be allowlisted to make a merge green.** PM explicitly owns any request to change that policy. New type contracts still need a deliberate, documented entry; nothing is automatically exempted because it has no runtime exports.

## Rollout and tests

WP15 ships strict from the start. Its PR stays draft until developer 1's WP14 wiring lands, then rebases and must pass on the real graph before readiness. There is no temporary reporting-only switch. Devops owns CI wiring and the PM owns sequencing; this PR changes no workflow files.

The command requires the already-declared tsx dev dependency; use npm ci after pulling if the checkout predates it. No new dependencies are introduced.

Run npx vitest run tests/reachability.test.ts for isolated fixtures covering transitive/cyclic graphs, outside-src bridges, aliases, barrels, literal dynamic imports, erased-type loopholes, computed import diagnostics, exact-path exceptions and stale/overbroad allowlist failures. These fixtures intentionally model unreachable features without requiring the current integration state to be broken.
