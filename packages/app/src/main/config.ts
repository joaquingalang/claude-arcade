import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ArcadeConfig {
  /** A widget id to pin, or 'random' to alternate toys and games - see WidgetRotation. */
  widget: string;
  showDelayMs: number;
  /**
   * How long each toy stays up before the next one takes over. 0 disables cycling.
   *
   * Only applies to the fidget toys. The games run to their own end - see isSelfPaced().
   */
  cycleMs: number;
  /**
   * Let Snake take the arrow keys, system wide, while it is on screen.
   *
   * The one setting that trades away the app's "your keystrokes always reach the
   * terminal" guarantee, which is why it is a setting at all.
   */
  snakeKeyboard: boolean;
  soundEnabled: boolean;
  position: { x: number; y: number } | null;
}

const DEFAULTS: ArcadeConfig = {
  widget: 'random',
  showDelayMs: 2500,
  cycleMs: 15_000,
  snakeKeyboard: true,
  soundEnabled: false,
  position: null,
};

/**
 * Plain JSON, not SQLite.
 *
 * The vision doc calls for better-sqlite3, but Phase 1 stores four scalars. A native
 * module is worth adopting when there are statistics worth querying, not before.
 */
export class ConfigStore {
  private data: ArcadeConfig;
  /**
   * mtime of the file as we last read or wrote it, so an edit made behind our back can be
   * told apart from our own save.
   */
  private stamp = 0;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): ArcadeConfig {
    try {
      const text = fs.readFileSync(this.file, 'utf8');
      this.stamp = this.mtime();
      const parsed = JSON.parse(text) as Partial<ArcadeConfig>;
      return { ...DEFAULTS, ...parsed };
    } catch {
      this.stamp = 0;
      return { ...DEFAULTS };
    }
  }

  /**
   * The current settings, re-read first if the file has changed underneath us.
   *
   * The app is long-lived - it outlives the session that started it and every session
   * after that - so "loaded once at startup" would mean editing config.json does nothing
   * until the next reboot, and worse, the next position save would write the stale value
   * back over the edit. Callers are per-show and per-cycle, not per-frame, so a stat is
   * cheap at this rate.
   */
  get(): ArcadeConfig {
    const disk = this.mtime();
    if (disk !== 0 && disk !== this.stamp) this.data = this.load();
    return this.data;
  }

  update(patch: Partial<ArcadeConfig>): ArcadeConfig {
    // Through get(), so an outside edit is merged in rather than overwritten by whatever
    // was in memory when the app started.
    this.data = { ...this.get(), ...patch };
    this.save();
    return this.data;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, this.file);
      // Our own write must not read as somebody else's edit on the next get().
      this.stamp = this.mtime();
    } catch {
      // Losing a preference is not worth crashing a desk toy over.
    }
  }

  /** Last-modified time in ms, or 0 if the file is missing or unreadable. */
  private mtime(): number {
    try {
      return fs.statSync(this.file).mtimeMs;
    } catch {
      return 0;
    }
  }
}
