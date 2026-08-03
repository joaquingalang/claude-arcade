import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';

import {
  APP_ID,
  LOOPBACK,
  readRuntimeFile,
  type PingResponse,
  type RuntimeFile,
} from '@claude-arcade/shared';

const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Confirm the process on this port is actually us.
 *
 * The runtime file says "port 45970"; that alone doesn't prove Claude Arcade is what
 * answers there. If some other process grabbed the port after we crashed, posting hook
 * payloads at it would leak session metadata to a stranger.
 */
export async function pingApp(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: LOOPBACK, port, path: '/ping', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve((JSON.parse(body) as PingResponse).app === APP_ID);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export interface AppStatus {
  widgetVisible: boolean;
  widgetId: string;
  sessions: Array<{ sessionId: string; state: string; cwd?: string }>;
}

/** Snapshot of what the app currently thinks is happening. Null if unreachable. */
export async function fetchStatus(port: number, timeoutMs = 1500): Promise<AppStatus | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: LOOPBACK, port, path: '/status', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as AppStatus);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Locate the Electron binary and the app package, dev-layout first. */
export function resolveAppLaunch(): { command: string; args: string[] } | null {
  if (process.env.ARCADE_APP_PATH && fs.existsSync(process.env.ARCADE_APP_PATH)) {
    return { command: process.env.ARCADE_APP_PATH, args: [] };
  }

  // dist/index.js -> packages/cli -> packages -> repo root
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const appDir = path.join(repoRoot, 'packages', 'app');
  if (!fs.existsSync(path.join(appDir, 'package.json'))) return null;

  let electronBin: string;
  try {
    // The electron package exports the path to its binary as its main export.
    electronBin = require(require.resolve('electron', { paths: [appDir, repoRoot] })) as string;
  } catch {
    return null;
  }
  if (typeof electronBin !== 'string' || !fs.existsSync(electronBin)) return null;

  return { command: electronBin, args: [appDir] };
}

/**
 * Return a live app's runtime info, starting the app if needed.
 *
 * Returns null on any failure. The caller must treat that as "run Claude unwrapped" -
 * Claude Arcade is a toy and must never be the reason someone can't run Claude.
 */
export async function ensureApp(): Promise<RuntimeFile | null> {
  const existing = readRuntimeFile();
  if (existing && (await pingApp(existing.port))) return existing;

  const launch = resolveAppLaunch();
  if (!launch) return null;

  // Detached + ignored stdio + unref: the app outlives this CLI process and never
  // writes into the user's terminal.
  const child = spawn(launch.command, launch.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {
    /* handled by the poll timing out */
  });
  child.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const rt = readRuntimeFile();
    if (rt && (await pingApp(rt.port))) return rt;
  }
  return null;
}
