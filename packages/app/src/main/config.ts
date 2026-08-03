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

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): ArcadeConfig {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ArcadeConfig>;
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  get(): ArcadeConfig {
    return this.data;
  }

  update(patch: Partial<ArcadeConfig>): ArcadeConfig {
    this.data = { ...this.data, ...patch };
    this.save();
    return this.data;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {
      // Losing a preference is not worth crashing a desk toy over.
    }
  }
}
