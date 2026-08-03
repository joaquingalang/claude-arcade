import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readSample } from '../packages/app/src/main/samples';

let root = '';
let sounds = '';

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-samples-'));
  sounds = path.join(root, 'sounds');
  fs.mkdirSync(path.join(sounds, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(sounds, 'pop-1.mp3'), Buffer.from([1, 2, 3, 4]));
  fs.writeFileSync(path.join(sounds, 'README.md'), 'not audio');
  // The thing a traversal would be reaching for: a file next to the sounds directory.
  fs.writeFileSync(path.join(root, 'secret.mp3'), Buffer.from([9, 9, 9]));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readSample', () => {
  it('reads an installed sample', async () => {
    const bytes = await readSample(sounds, 'pop-1.mp3');
    expect(bytes).not.toBeNull();
    expect([...bytes!]).toEqual([1, 2, 3, 4]);
  });

  it('returns null for a sample that is not installed', async () => {
    // The normal state of a fresh checkout, and not an error.
    await expect(readSample(sounds, 'pop-9.mp3')).resolves.toBeNull();
  });

  it('returns null for a directory that does not exist', async () => {
    await expect(readSample(path.join(root, 'nope'), 'pop-1.mp3')).resolves.toBeNull();
  });

  it('refuses anything that is not a bare audio filename', async () => {
    const rejected = [
      '../secret.mp3',
      '..\\secret.mp3',
      'nested/../../secret.mp3',
      'sounds/pop-1.mp3',
      'nested\\pop-1.mp3',
      'C:\\Windows\\System32\\config\\SAM',
      '/etc/passwd',
      '',
      '.',
      '..',
      'pop-1.mp3\u0000.txt',
      'README.md',
      'nested',
    ];
    for (const name of rejected) {
      await expect(readSample(sounds, name), name).resolves.toBeNull();
    }
  });

  it('refuses a non-string name, which is all the renderer can be trusted to send', async () => {
    await expect(readSample(sounds, undefined as unknown as string)).resolves.toBeNull();
    await expect(readSample(sounds, 42 as unknown as string)).resolves.toBeNull();
  });
});
