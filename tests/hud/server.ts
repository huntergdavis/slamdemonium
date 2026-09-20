import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

/** Serve actual compiled JS/CSS; no Vite dev source transforms in these tests. */
export async function serveHudBuild(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const outDir = await mkdtemp(join(tmpdir(), 'slamdemonium-hud-'));
  try {
    await build({
      configFile: false,
      root: resolve('tests/hud'),
      logLevel: 'error',
      build: { outDir, emptyOutDir: true },
    });
    const files = new Map<string, Buffer>();
    async function collect(dir: string, prefix = ''): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory())
          await collect(join(dir, entry.name), prefix + '/' + entry.name);
        else
          files.set(
            prefix + '/' + entry.name,
            await readFile(join(dir, entry.name)),
          );
      }
    }
    await collect(outDir);
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const key = path === '/' ? '/index.html' : path;
      const contents = files.get(key);
      response.statusCode = contents ? 200 : 404;
      response.setHeader(
        'Content-Type',
        key.endsWith('.js')
          ? 'text/javascript'
          : key.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      );
      response.end(contents ?? 'Not found');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test server address');
    return {
      url: 'http://127.0.0.1:' + address.port,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        await rm(outDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true });
    throw error;
  }
}
