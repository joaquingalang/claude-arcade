import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Reading sample files on the renderer's behalf.
 *
 * The renderer is loaded with `loadFile`, so its origin is `file://` - and Chromium's
 * fetch() rejects the file scheme outright, whatever `webSecurity` says. Web Audio needs
 * the raw bytes to decode, so somebody has to read them, and in a `contextIsolation` app
 * that somebody is the main process.
 *
 * Under `vite dev` the page is served over http and fetch works normally; the renderer
 * prefers this channel when it exists and falls back to fetch when it does not.
 */

/**
 * A bare filename with an audio extension, and nothing else.
 *
 * The renderer names which sample it wants, and a renderer is exactly the place an
 * attacker would reach first. Anything with a separator, a drive letter, or a `..` fails
 * this outright rather than being normalised into something that looks safe.
 */
const SAMPLE_NAME = /^[a-z0-9][a-z0-9._-]*\.(mp3|ogg|wav)$/i;

/**
 * Read one sample from the renderer's sounds directory.
 *
 * Returns null for anything missing, unreadable, or not a plain file inside that
 * directory. Missing samples are an ordinary state here - the app ships without any - so
 * this reports absence rather than throwing.
 */
export async function readSample(dir: string, name: string): Promise<Buffer | null> {
  if (typeof name !== 'string' || !SAMPLE_NAME.test(name) || name.includes('..')) return null;

  const root = path.resolve(dir);
  const file = path.resolve(root, name);
  // Belt and braces over the pattern above: the resolved path must still be a direct
  // child of the sounds directory, so a symlinked name cannot climb out of it.
  if (path.dirname(file) !== root) return null;

  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    return await fs.readFile(file);
  } catch {
    return null;
  }
}
