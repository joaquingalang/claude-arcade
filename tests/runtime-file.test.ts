import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  clearRuntimeFile,
  isPidAlive,
  readRuntimeFile,
  writeRuntimeFile,
} from '../packages/shared/src/runtime-file';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-test-'));
const file = path.join(tmpDir, 'runtime.json');

afterEach(() => {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
});

/** A pid that is essentially certain not to exist. */
const DEAD_PID = 0x7ffffffe;

describe('runtime file', () => {
  it('round-trips', () => {
    writeRuntimeFile({ app: 'claude-arcade', port: 45970, ownerPid: process.pid }, file);
    expect(readRuntimeFile(file)).toEqual({
      app: 'claude-arcade',
      port: 45970,
      ownerPid: process.pid,
    });
  });

  it('rejects a file whose owner process is gone', () => {
    writeRuntimeFile({ app: 'claude-arcade', port: 45970, ownerPid: DEAD_PID }, file);
    expect(readRuntimeFile(file)).toBeNull();
  });

  it('rejects a port outside the reserved range', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ app: 'claude-arcade', port: 23333, ownerPid: process.pid }),
    );
    expect(readRuntimeFile(file)).toBeNull();
  });

  it('rejects a file belonging to another app', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ app: 'clawd-on-desk', port: 45970, ownerPid: process.pid }),
    );
    expect(readRuntimeFile(file)).toBeNull();
  });

  it('rejects malformed json rather than throwing', () => {
    fs.writeFileSync(file, '{ not json');
    expect(readRuntimeFile(file)).toBeNull();
  });

  it('returns null when the file is absent', () => {
    expect(readRuntimeFile(path.join(tmpDir, 'nope.json'))).toBeNull();
  });

  it('leaves no temp files behind', () => {
    writeRuntimeFile({ app: 'claude-arcade', port: 45971, ownerPid: process.pid }, file);
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('owner-guarded delete', () => {
  it('deletes the file when we own it', () => {
    writeRuntimeFile({ app: 'claude-arcade', port: 45970, ownerPid: process.pid }, file);
    clearRuntimeFile(process.pid, file);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('does not delete a file owned by a different instance', () => {
    writeRuntimeFile({ app: 'claude-arcade', port: 45970, ownerPid: process.pid }, file);
    clearRuntimeFile(DEAD_PID, file);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('is a no-op when the file is already gone', () => {
    expect(() => clearRuntimeFile(process.pid, path.join(tmpDir, 'gone.json'))).not.toThrow();
  });
});

describe('isPidAlive', () => {
  it('recognises this process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('rejects a dead pid', () => {
    expect(isPidAlive(DEAD_PID)).toBe(false);
  });

  it('rejects nonsense pids', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(1.5)).toBe(false);
  });
});
