import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { APP_ID, type RuntimeFile } from './protocol';
import { isPortInRange } from './ports';

export function arcadeHome(): string {
  return path.join(os.homedir(), '.claude-arcade');
}

export function runtimeFilePath(): string {
  return path.join(arcadeHome(), 'runtime.json');
}

/** True if a process with this pid exists. Signal 0 checks liveness without signalling. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user - still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Read the runtime file, fail-closed.
 *
 * Returns null unless the file parses, claims to be ours, names a port in our reserved
 * range, and its owner process is still alive. A stale file left by a crashed app must
 * never send the CLI to a dead port.
 */
export function readRuntimeFile(file = runtimeFilePath()): RuntimeFile | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<RuntimeFile>;

  if (candidate.app !== APP_ID) return null;
  if (typeof candidate.port !== 'number' || !isPortInRange(candidate.port)) return null;
  if (typeof candidate.ownerPid !== 'number' || !isPidAlive(candidate.ownerPid)) return null;

  return { app: APP_ID, port: candidate.port, ownerPid: candidate.ownerPid };
}

/**
 * Write atomically: a sibling temp file plus rename, so a reader never observes a
 * partially written file. The temp file must share a directory with the target for
 * rename to be atomic.
 */
export function writeRuntimeFile(data: RuntimeFile, file = runtimeFilePath()): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.runtime.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Delete the runtime file only if we still own it.
 *
 * Without the ownership guard, a slow-shutting-down instance would unlink the file a
 * newly started instance had just written, leaving the CLI unable to find anything.
 */
export function clearRuntimeFile(ownerPid: number, file = runtimeFilePath()): void {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RuntimeFile>;
    if (parsed.ownerPid !== ownerPid) return;
    fs.unlinkSync(file);
  } catch {
    // Already gone, unreadable, or malformed - nothing to clean up.
  }
}
