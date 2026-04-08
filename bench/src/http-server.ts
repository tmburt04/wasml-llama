import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.gguf', 'application/octet-stream'],
  ['.map', 'application/json; charset=utf-8'],
]);

export interface StaticServerHandle {
  origin: string;
  close(): Promise<void>;
}

export async function startStaticServer(port: number): Promise<StaticServerHandle> {
  const root = resolve(process.cwd());
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      const requestPath = url.pathname === '/' ? '/bench/browser/index.html' : decodeURIComponent(url.pathname);
      const filePath = resolve(root, `.${requestPath}`);
      const body = await readFile(filePath);
      response.statusCode = 200;
      response.setHeader('Content-Type', CONTENT_TYPES.get(extname(filePath)) ?? 'application/octet-stream');
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      response.end(body);
    } catch (error) {
      response.statusCode = 404;
      response.end(error instanceof Error ? error.message : 'not found');
    }
  });
  await new Promise<void>((resolveReady) => {
    server.listen(port, '127.0.0.1', () => resolveReady());
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    },
  };
}
