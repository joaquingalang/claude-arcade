import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ConfigStore } from '../packages/app/src/main/config';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-config-'));
const file = path.join(tmpDir, 'config.json');

afterEach(() => {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
});

const write = (data: unknown) => fs.writeFileSync(file, JSON.stringify(data), 'utf8');
const read = () => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('ConfigStore', () => {
  it('falls back to the defaults when there is no file', () => {
    const config = new ConfigStore(file);
    expect(config.get().arrowKeys).toBe(true);
    expect(config.get().soundEnabled).toBe(false);
  });

  it('keeps the defaults for the settings a file leaves out', () => {
    write({ cycleMs: 9000 });
    const config = new ConfigStore(file);
    expect(config.get().cycleMs).toBe(9000);
    expect(config.get().arrowKeys).toBe(true);
  });
});

/**
 * `arrowKeys` was `snakeKeyboard` until a second widget wanted the arrows.
 *
 * This is the one setting where getting a rename wrong is actively hostile: it is off
 * only because somebody deliberately turned it off, and reverting that hands the arrow
 * keys back to the app on a desk that had said no.
 */
describe('the old snakeKeyboard setting', () => {
  it('still turns the arrow grab off', () => {
    write({ snakeKeyboard: false });
    expect(new ConfigStore(file).get().arrowKeys).toBe(false);
  });

  it('gives way to the current name when a file carries both', () => {
    write({ snakeKeyboard: false, arrowKeys: true });
    expect(new ConfigStore(file).get().arrowKeys).toBe(true);
  });

  it('is dropped on the next save rather than written back for ever', () => {
    write({ snakeKeyboard: false });
    const config = new ConfigStore(file);
    config.update({ position: { x: 10, y: 20 } });

    const saved = read();
    expect(saved.arrowKeys).toBe(false);
    expect(saved.snakeKeyboard).toBeUndefined();
  });

  it('leaves the default alone when the file never mentioned it', () => {
    write({ soundEnabled: true });
    expect(new ConfigStore(file).get().arrowKeys).toBe(true);
  });
});
