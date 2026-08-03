import * as http from 'node:http';

import {
  APP_ID,
  LOOPBACK,
  portsInRange,
  type HookPayload,
  type PingResponse,
} from '@claude-arcade/shared';

const MAX_BODY_BYTES = 256 * 1024;

export interface ServerHandlers {
  onHook(payload: HookPayload, token?: string): void;
  onSessionRegistered(launcherPid: number, cwd: string, token: string): void;
  onSessionEnded(token: string): void;
  /** Snapshot for `arcade doctor` and for end-to-end tests. */
  status(): unknown;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Start the hook receiver on the first free port in our reserved range.
 *
 * Bound to loopback only - this is the actual trust boundary. Nothing here is
 * authenticated because nothing here is reachable off-machine.
 */
export async function startServer(handlers: ServerHandlers, version: string): Promise<RunningServer> {
  for (const port of portsInRange()) {
    const server = await tryListen(handlers, version, port);
    if (server) return server;
  }
  throw new Error(`no free port in the Claude Arcade range`);
}

function tryListen(
  handlers: ServerHandlers,
  version: string,
  port: number,
): Promise<RunningServer | null> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res, handlers, version, port).catch(() => {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      });
    });

    server.once('error', () => resolve(null));
    server.listen(port, LOOPBACK, () => {
      server.removeAllListeners('error');
      server.on('error', () => {
        /* keep the app alive on transient socket errors */
      });
      resolve({
        port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlers: ServerHandlers,
  version: string,
  port: number,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${LOOPBACK}:${port}`);

  if (req.method === 'GET' && url.pathname === '/ping') {
    const payload: PingResponse = { app: APP_ID, version, port };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(handlers.status()));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }

  // Respond BEFORE doing any work. An http hook sits in Claude's critical path; it must
  // never wait on window operations, however fast those are.
  const body = await readBody(req);
  res.writeHead(204).end();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;

  const token = url.searchParams.get('token') ?? undefined;

  switch (url.pathname) {
    case '/hook':
      handlers.onHook(parsed as HookPayload, token);
      break;
    case '/session-registered': {
      const b = parsed as { launcherPid?: number; cwd?: string; token?: string };
      if (typeof b.launcherPid === 'number' && typeof b.token === 'string') {
        handlers.onSessionRegistered(b.launcherPid, b.cwd ?? '', b.token);
      }
      break;
    }
    case '/session-ended': {
      const b = parsed as { token?: string };
      if (typeof b.token === 'string') handlers.onSessionEnded(b.token);
      break;
    }
    default:
      break;
  }
}
