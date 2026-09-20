import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export interface ReachabilityResult {
  modules: string[];
  reachable: string[];
  allowed: string[];
  unreachable: string[];
  errors: string[];
}
const ALLOWLIST = 'scripts/reachability-allowlist.json';
const codeFile = /\.(?:[cm]?[jt]sx?)$/;
const assetFile =
  /\.(?:css|json|md|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|wasm)$/;

function display(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

function sourceModules(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        'Source symlinks are not supported by the guard: ' + path,
      );
    if (entry.isDirectory()) paths.push(...sourceModules(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) paths.push(path);
  }
  return paths.sort();
}

function readAllowlist(
  root: string,
  modules: Set<string>,
  errors: string[],
): Set<string> {
  const allowed = new Set<string>();
  const entries: unknown = JSON.parse(
    readFileSync(resolve(root, ALLOWLIST), 'utf8'),
  );
  if (!Array.isArray(entries))
    throw new Error(
      ALLOWLIST + ' must contain an array of {path, reason} entries.',
    );
  for (const entry of entries as unknown[]) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('path' in entry) ||
      !('reason' in entry) ||
      Object.keys(entry).length !== 2
    ) {
      errors.push(ALLOWLIST + ': each entry requires exactly path and reason.');
      continue;
    }
    const { path, reason } = entry;
    if (typeof path !== 'string' || !modules.has(path)) {
      errors.push(
        ALLOWLIST +
          ': path must name one existing src/**/*.ts file exactly: ' +
          String(path),
      );
      continue;
    }
    if (typeof reason !== 'string' || !reason.trim() || /[\r\n]/.test(reason)) {
      errors.push(
        ALLOWLIST + ': ' + path + ' requires a nonempty one-line reason.',
      );
      continue;
    }
    if (allowed.has(path))
      errors.push(ALLOWLIST + ': duplicate entry for ' + path);
    allowed.add(path);
  }
  return allowed;
}

/** Import types, including all-type named bindings, do not establish feature wiring. */
function runtimeImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  return (
    !bindings ||
    ts.isNamespaceImport(bindings) ||
    bindings.elements.length === 0 ||
    bindings.elements.some((item) => !item.isTypeOnly)
  );
}

function runtimeExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  const clause = node.exportClause;
  return (
    !clause ||
    ts.isNamespaceExport(clause) ||
    clause.elements.length === 0 ||
    clause.elements.some((item) => !item.isTypeOnly)
  );
}

/** Static graph only: no application module is evaluated or imported by this check. */
export function checkReachability(projectRoot: string): ReachabilityResult {
  const root = resolve(projectRoot);
  const errors: string[] = [];
  const modules = sourceModules(resolve(root, 'src')).map((path) =>
    display(root, path),
  );
  const allowed = readAllowlist(root, new Set(modules), errors);
  const configPath = resolve(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
    );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length)
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        )
        .join('\n'),
    );
  const cache = ts.createModuleResolutionCache(
    root,
    (path) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()),
    parsed.options,
  );
  const visited = new Set<string>();
  const pending = [resolve(root, 'src/main.ts')];
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const location = (node: ts.Node): string => {
      const point = source.getLineAndCharacterOfPosition(node.getStart(source));
      return (
        display(root, file) +
        ':' +
        (point.line + 1) +
        ':' +
        (point.character + 1)
      );
    };
    const follow = (specifier: string, node: ts.Node): void => {
      // Vite asset queries do not turn the referenced WASM/CSS/image into TS code.
      const assetPath = specifier.split(/[?#]/, 1)[0]!;
      if (assetFile.test(assetPath) || specifier.startsWith('node:')) return;
      const result = ts.resolveModuleName(
        specifier,
        file,
        parsed.options,
        ts.sys,
        cache,
      ).resolvedModule;
      if (!result) {
        errors.push(
          location(node) +
            ': cannot resolve runtime import ' +
            JSON.stringify(specifier),
        );
        return;
      }
      if (result.isExternalLibraryImport) return;
      const target = resolve(result.resolvedFileName);
      if (codeFile.test(target) && !target.endsWith('.d.ts'))
        pending.push(target);
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        runtimeImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        follow(node.moduleSpecifier.text, node);
      else if (
        ts.isExportDeclaration(node) &&
        runtimeExport(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        follow(node.moduleSpecifier.text, node);
      else if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        const expression = node.moduleReference.expression;
        if (expression && ts.isStringLiteral(expression))
          follow(expression.text, node);
        else
          errors.push(
            location(node) +
              ': nonliteral import assignment cannot be proven reachable.',
          );
      } else if (ts.isCallExpression(node)) {
        const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const requireCall =
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require';
        if (dynamic || requireCall) {
          const argument = node.arguments[0];
          if (
            argument &&
            (ts.isStringLiteral(argument) ||
              ts.isNoSubstitutionTemplateLiteral(argument))
          )
            follow(argument.text, node);
          else
            errors.push(
              location(node) +
                ': nonliteral ' +
                (dynamic ? 'import()' : 'require()') +
                ' cannot be analyzed; use explicit literal imports.',
            );
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'glob' &&
          ts.isMetaProperty(node.expression.expression)
        )
          errors.push(
            location(node) +
              ': import.meta.glob is unsupported; use explicit literal imports or extend the guard.',
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const reachable = new Set([...visited].map((path) => display(root, path)));
  for (const path of allowed)
    if (reachable.has(path))
      errors.push(
        ALLOWLIST + ': stale exception is now reachable; remove ' + path,
      );
  return {
    modules,
    reachable: modules.filter((path) => reachable.has(path)),
    allowed: [...allowed].sort(),
    unreachable: modules.filter(
      (path) => !reachable.has(path) && !allowed.has(path),
    ),
    errors,
  };
}

export function formatReachability(result: ReachabilityResult): string {
  const ok = !result.errors.length && !result.unreachable.length;
  const lines = [
    (ok ? 'PASS' : 'FAIL') + ': src/main.ts runtime module reachability',
    result.reachable.length +
      '/' +
      result.modules.length +
      ' source modules reachable; ' +
      result.allowed.length +
      ' explicit exceptions.',
  ];
  if (result.unreachable.length) {
    lines.push(
      '',
      'These modules ship in no bundle reachable from src/main.ts.',
      'Their features are unreachable to a player through the game entry point:',
      ...result.unreachable.map((path) => '  - ' + path),
      '',
      'Wire the runtime feature into the entry graph; a type-only import does not count.',
      'Do not allowlist unwired runtime features. Intentionally nonproduction modules',
      'require an exact path and one-line reason in ' + ALLOWLIST + '.',
    );
  }
  if (result.errors.length)
    lines.push(
      '',
      'The graph cannot be accepted:',
      ...result.errors.map((error) => '  - ' + error),
    );
  return lines.join('\n');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const result = checkReachability(root);
    console.log(formatReachability(result));
    if (result.errors.length || result.unreachable.length) process.exitCode = 1;
  } catch (error) {
    console.error(
      'FAIL: reachability graph could not be checked: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  }
}
