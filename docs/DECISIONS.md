# Decisions

## 2026-09-20 — WP0: minimal browser scaffold and reproducible tooling

- Use strict TypeScript, Vite, three.js WebGLRenderer, Vitest, and Playwright.
  Keep the design section 5.3 directories ready for each work package. The initial
  scene is intentionally empty. `window.__game.ready` means the first frame rendered;
  unfinished gameplay methods throw clearly until their work packages wire them.
- `GAME_NAME` lives only in `src/core/constants.ts`. Page title and accessible
  application name use that value.
- Read the public npm registry with `npm view <package> version engines --json`
  on 2026-09-20. Confirmed latest: Vite 8.3.0, TypeScript 7.0.2, three 0.186.0,
  Vitest 5.0.1, Playwright 1.63.0, ESLint 10.11.0, @eslint/js 10.0.1,
  typescript-eslint 8.70.0, Prettier 3.9.8, @types/three 0.186.0, and
  @types/node 26.6.2. Pin every direct dependency exactly and commit the lockfile.
- **Compatibility choice:** pin TypeScript 6.0.3, the newest supported 6.0 release:
  typescript-eslint 8.70.0 declares TypeScript `>=4.8.4 <6.1.0`.
  Do not force an unsupported TypeScript 7 install. Pin @types/node 22.20.4
  to match the Node 22 runtime; development uses Node 22.22.1.
- Expose `npm test`, `npm run build`, `npm run e2e`, `npm run lint`,
  and Prettier write/check commands. Devops owns all `.github/` files and CI.
  E2E launches its own Vite server on port 4173 and Chromium with software WebGL
  support for headless hosts. Install Chromium with `npx playwright install chromium`.
- `VITE_BASE_PATH` selects the public base path (default `/`);
  deployment can run `VITE_BASE_PATH=/slamdemonium/ npm run build`.
  This follows [Vite's base configuration](https://vite.dev/config/shared-options.html#base).
  The Playwright server follows the [webServer contract](https://playwright.dev/docs/test-webserver).
- No physics dependency is installed before WP1 verifies the actual Jolt flavor.
  No runtime dependencies beyond three.js are introduced here.

- Validation: the WebGL smoke test also checks resizing and browser errors/warnings.
  Chromium's software renderer emits a specific ReadPixels GPU-stall diagnostic
  during trace capture; only that driver diagnostic is excluded. Application
  warnings and all other diagnostics still fail the smoke test.
- WP0 production payload: about 524 kB JavaScript (131 kB gzip), before Jolt.
  Vite reports the standard 500 kB chunk advisory; rendering passes without
  suppressing this build advisory. Revisit chunk loading when adding the engine.
