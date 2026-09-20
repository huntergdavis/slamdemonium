import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkReachability,
  formatReachability,
} from '../scripts/check-reachability';

const roots: string[] = [];
function fixture(
  files: Record<string, string>,
  exceptions: unknown = [],
): string {
  const root = mkdtempSync(join(tmpdir(), 'slamdemonium-reachability-'));
  roots.push(root);
  const write = (file: string, value: string): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), value);
  };
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
        verbatimModuleSyntax: true,
        paths: { '@/*': ['./src/*'] },
      },
      include: ['src'],
    }),
  );
  write('scripts/reachability-allowlist.json', JSON.stringify(exceptions));
  write('src/main.ts', '');
  for (const [file, value] of Object.entries(files)) write(file, value);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('production import reachability', () => {
  it('walks static imports, barrels, aliases, outside-src bridges and cycles without executing code', () => {
    const root = fixture({
      'src/main.ts':
        "import './startup'; import { feature } from '@/barrel'; import '../assets/bridge'; throw new Error('must not execute');",
      'src/startup.ts': "import './main';",
      'src/barrel.ts':
        "export * from './feature.js'; export * as ns from './folder';",
      'src/feature.ts': 'export const feature = 1;',
      'src/folder/index.ts': 'export const other = 2;',
      'assets/bridge.ts': "import '../src/bridged';",
      'src/bridged.ts': 'export const bridged = 3;',
    });
    const result = checkReachability(root);
    expect(result.errors).toEqual([]);
    expect(result.unreachable).toEqual([]);
    expect(result.reachable).toHaveLength(6);
    expect(formatReachability(result)).toContain('PASS');
  });

  it('follows literal dynamic imports even when conditional, including template literals', () => {
    const root = fixture({
      'src/main.ts':
        "if (false) import('./physics/joltWorld'); void import(`./input/testFixture`);",
      'src/physics/joltWorld.ts': "export * from './adapterImplementation';",
      'src/physics/adapterImplementation.ts': 'export const create = 1;',
      'src/input/testFixture.ts': 'export const install = 1;',
    });
    const result = checkReachability(root);
    expect(result.errors).toEqual([]);
    expect(result.unreachable).toEqual([]);
  });

  it('does not treat type imports, type re-exports, import types, comments or strings as feature wiring', () => {
    const root = fixture({
      'src/main.ts': [
        "import type { Panel } from './options';",
        "import { type Hud } from './hud';",
        "export type { Recorder } from './recorder';",
        "export { type Storage } from './storage';",
        "type Script = typeof import('./script');",
        "// import './commentOnly';",
        'const example = "import(\'./stringOnly\')";',
      ].join('\n'),
      'src/options.ts': 'export class Panel {}',
      'src/hud.ts': 'export class Hud {}',
      'src/recorder.ts': 'export class Recorder {}',
      'src/storage.ts': 'export class Storage {}',
      'src/script.ts': 'export const start = 1;',
      'src/commentOnly.ts': 'export const unused = 1;',
      'src/stringOnly.ts': 'export const unused = 2;',
    });
    const result = checkReachability(root);
    expect(result.unreachable).toHaveLength(7);
    expect(result.reachable).toEqual(['src/main.ts']);
    const message = formatReachability(result);
    expect(message).toContain('ship in no bundle');
    expect(message).toContain('unreachable to a player');
    expect(message).toContain('src/options.ts');
  });

  it('keeps mixed type/value edges and explicit side-effect imports', () => {
    const root = fixture({
      'src/main.ts':
        "import {type Shape, start} from './mixed'; export {type Shape, start} from './exported'; import './sideEffect';",
      'src/mixed.ts': 'export interface Shape {} export const start = 1;',
      'src/exported.ts': 'export interface Shape {} export const start = 1;',
      'src/sideEffect.ts': 'console.log("initialized");',
    });
    expect(checkReachability(root).unreachable).toEqual([]);
  });

  it('ignores Vite non-code asset queries without treating raw TS text as runtime wiring', () => {
    const root = fixture({
      'src/main.ts':
        "import wasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url'; import './style.css?inline'; import source from './feature.ts?raw';",
      'src/feature.ts': 'export const start = 1;',
    });
    const result = checkReachability(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('./feature.ts?raw');
    expect(result.unreachable).toEqual(['src/feature.ts']);
  });

  it('fails closed with a source location for a computed dynamic import', () => {
    const root = fixture({
      'src/main.ts': "const target = './feature';\nimport(target);",
      'src/feature.ts': 'export const feature = 1;',
    });
    const result = checkReachability(root);
    expect(result.errors[0]).toContain('src/main.ts:2:1: nonliteral import()');
    expect(result.unreachable).toEqual(['src/feature.ts']);
  });

  it('rejects unresolved runtime imports and unsupported glob imports', () => {
    const root = fixture({
      'src/main.ts': "import './missing'; import.meta.glob('./features/*.ts');",
    });
    const result = checkReachability(root);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join('\n')).toContain('cannot resolve runtime import');
    expect(result.errors.join('\n')).toContain(
      'import.meta.glob is unsupported',
    );
  });
});

describe('reviewable exact-path allowlist', () => {
  it('permits a reasoned type contract without allowing its entire dependency subtree', () => {
    const root = fixture(
      {
        'src/main.ts': "import type { State } from './state';",
        'src/state.ts': "import './unwired'; export interface State {}",
        'src/unwired.ts': 'export const feature = 1;',
      },
      [
        {
          path: 'src/state.ts',
          reason:
            'A deliberately nonproduction test fixture for this guard test.',
        },
      ],
    );
    const result = checkReachability(root);
    expect(result.allowed).toEqual(['src/state.ts']);
    expect(result.unreachable).toEqual(['src/unwired.ts']);
  });

  it.each([
    { path: 'src/contract.ts', reason: '' },
    { path: 'src/contract.ts', reason: '   ' },
    { path: 'src/contract.ts', reason: 'first line\nsecond line' },
    { path: 'src/contract.ts' },
    { path: 'src/*.ts', reason: 'Wildcard would hide future features.' },
    {
      path: 'src/missing.ts',
      reason: 'Stale paths cannot suppress future findings.',
    },
    {
      path: '../src/contract.ts',
      reason: 'Only canonical root-relative paths are accepted.',
    },
  ])('rejects malformed or overbroad exception %j', (entry) => {
    const root = fixture(
      { 'src/contract.ts': 'export interface Contract {}' },
      [entry],
    );
    const result = checkReachability(root);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.unreachable).toEqual(['src/contract.ts']);
    expect(formatReachability(result)).toContain('FAIL');
  });

  it('rejects duplicate and stale reachable exceptions', () => {
    const entry = {
      path: 'src/feature.ts',
      reason: 'This exception must be removed when wiring lands.',
    };
    const root = fixture(
      {
        'src/main.ts': "import './feature';",
        'src/feature.ts': 'export const start = 1;',
      },
      [entry, entry],
    );
    const result = checkReachability(root);
    expect(result.errors.join('\n')).toContain('duplicate entry');
    expect(result.errors.join('\n')).toContain(
      'stale exception is now reachable',
    );
  });
});
