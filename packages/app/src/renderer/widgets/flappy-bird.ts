import { CanvasWidget } from './types';

/** Geometry and motion are fractions of the box, so the game scales with the widget. */
const BIRD_X = 0.3;
const BIRD_R = 0.045;
const GRAVITY = 2.2;
const FLAP = 0.78;
const SCROLL = 0.42;
const PIPE_W = 0.12;
const PIPE_GAP = 0.3;
const PIPE_SPACING = 0.62;
const GROUND_Y = 0.9;
/** How long the crash is held before the next life starts. */
const DEAD_PAUSE = 1.1;
/** Lives in a run. Spend them all and the widget hands over to the next toy. */
const LIVES = 3;
/** How long the final score is held before handing over, so the run has an ending. */
const OVER_PAUSE = 1.6;

interface Pipe {
  x: number;
  /** Centre of the gap. */
  gapY: number;
  scored: boolean;
}

type Phase = 'ready' | 'playing' | 'dead' | 'over';

/**
 * Flappy Bird - one input, one button, no keyboard. The best possible fit for a window
 * that only ever receives mouse events.
 *
 * A run is three lives. A crash costs one and the next starts itself after a beat, so you
 * are never asked to press "retry" - being asked would make a desk toy into a task. When
 * the third is gone the run is over, the final score sits on screen for a moment, and the
 * widget hands over to the next toy rather than looping forever.
 *
 * Score carries across the three lives, which is what makes them lives rather than three
 * unrelated games.
 */
export class FlappyBird extends CanvasWidget {
  private phase: Phase = 'ready';
  private birdY = 0;
  private vy = 0;
  private pipes: Pipe[] = [];
  private score = 0;
  private best = 0;
  private lives = LIVES;
  private deadTimer = 0;
  private overTimer = 0;
  private bobT = 0;

  private px(fraction: number): number {
    return fraction * this.size;
  }

  private get groundY(): number {
    return this.px(GROUND_Y);
  }

  protected init(): void {
    this.best = 0;
    this.lives = LIVES;
    this.score = 0;
    this.overTimer = 0;
    this.toReady();
  }

  /** Start a life. Score and lives survive this; the board does not. */
  private toReady(): void {
    this.phase = 'ready';
    this.birdY = this.size * 0.45;
    this.vy = 0;
    this.pipes = [];
    this.deadTimer = 0;
    this.bobT = 0;
  }

  protected update(dt: number): void {
    if (this.phase === 'over') {
      // The bird keeps falling to the ground under the final score - a frozen frame reads
      // as a hang rather than an ending.
      this.settle(dt);
      this.overTimer += dt;
      if (this.overTimer >= OVER_PAUSE) this.finish();
      return;
    }

    if (this.phase === 'ready') {
      // Idle bob, so the bird is alive before the first click.
      this.bobT += dt;
      this.birdY = this.size * 0.45 + Math.sin(this.bobT * 3) * this.px(0.02);
      return;
    }

    if (this.phase === 'dead') {
      this.settle(dt);
      this.deadTimer += dt;
      if (this.deadTimer >= DEAD_PAUSE) this.toReady();
      return;
    }

    this.vy += this.px(GRAVITY) * dt;
    this.birdY += this.vy * dt;

    // Ceiling is a clamp, not a crash - dying to an invisible line reads as a bug.
    if (this.birdY < this.px(BIRD_R)) {
      this.birdY = this.px(BIRD_R);
      this.vy = 0;
    }

    this.movePipes(dt);

    if (this.birdY + this.px(BIRD_R) >= this.groundY || this.hitsPipe()) this.die();
  }

  private movePipes(dt: number): void {
    for (const p of this.pipes) p.x -= this.px(SCROLL) * dt;
    this.pipes = this.pipes.filter((p) => p.x + this.px(PIPE_W) > 0);

    const last = this.pipes[this.pipes.length - 1];
    if (!last || last.x < this.size - this.px(PIPE_SPACING)) {
      const margin = this.px(PIPE_GAP / 2 + 0.08);
      this.pipes.push({
        x: this.size,
        gapY: margin + Math.random() * (this.groundY - margin * 2),
        scored: false,
      });
    }

    const birdX = this.px(BIRD_X);
    for (const p of this.pipes) {
      if (!p.scored && p.x + this.px(PIPE_W) < birdX) {
        p.scored = true;
        this.score++;
        this.best = Math.max(this.best, this.score);
      }
    }
  }

  private hitsPipe(): boolean {
    const r = this.px(BIRD_R);
    const birdX = this.px(BIRD_X);
    const w = this.px(PIPE_W);
    const halfGap = this.px(PIPE_GAP) / 2;

    for (const p of this.pipes) {
      if (birdX + r < p.x || birdX - r > p.x + w) continue;
      if (this.birdY - r < p.gapY - halfGap) return true;
      if (this.birdY + r > p.gapY + halfGap) return true;
    }
    return false;
  }

  /** Fall to the ground and stay put. Shared by the end of a life and the end of a run. */
  private settle(dt: number): void {
    this.vy += this.px(GRAVITY) * dt;
    this.birdY += this.vy * dt;
    const rest = this.groundY - this.px(BIRD_R);
    if (this.birdY >= rest) {
      this.birdY = rest;
      this.vy = 0;
    }
  }

  private die(): void {
    this.lives--;
    // The upward kick off a crash is the same either way; only what follows differs.
    this.vy = Math.min(this.vy, 0);
    if (this.lives <= 0) {
      this.phase = 'over';
      this.overTimer = 0;
      return;
    }
    this.phase = 'dead';
    this.deadTimer = 0;
  }

  protected draw(): void {
    this.drawPipes();
    this.drawGround();
    this.drawBird();
    this.drawScore();
    this.drawLives();
    if (this.phase === 'over') this.drawGameOver();
  }

  /** One pip per life left, top-left, out of the way of the score. */
  private drawLives(): void {
    const ctx = this.ctx;
    const r = this.px(0.018);
    const gap = r * 3;
    const x0 = this.px(0.06);
    const y = this.px(0.08);

    for (let i = 0; i < LIVES; i++) {
      ctx.beginPath();
      ctx.arc(x0 + i * gap, y, r, 0, Math.PI * 2);
      ctx.fillStyle = i < this.lives ? 'rgba(253,224,71,0.95)' : 'rgba(148,163,184,0.3)';
      ctx.fill();
    }
  }

  private drawGameOver(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 ${Math.round(this.px(0.075))}px system-ui, sans-serif`;
    ctx.fillText('game over', this.size / 2, this.size * 0.62);
    ctx.restore();
  }

  private drawPipes(): void {
    const ctx = this.ctx;
    const w = this.px(PIPE_W);
    const halfGap = this.px(PIPE_GAP) / 2;
    const lip = this.px(0.022);

    for (const p of this.pipes) {
      const g = ctx.createLinearGradient(p.x, 0, p.x + w, 0);
      g.addColorStop(0, 'rgba(74,164,94,0.92)');
      g.addColorStop(0.45, 'rgba(122,209,138,0.92)');
      g.addColorStop(1, 'rgba(56,132,78,0.92)');
      ctx.fillStyle = g;

      const topH = p.gapY - halfGap;
      ctx.fillRect(p.x, 0, w, topH);
      ctx.fillRect(p.x - lip / 2, topH - lip, w + lip, lip);

      const bottomY = p.gapY + halfGap;
      ctx.fillRect(p.x, bottomY, w, this.groundY - bottomY);
      ctx.fillRect(p.x - lip / 2, bottomY, w + lip, lip);
    }
  }

  private drawGround(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(120,96,64,0.85)';
    ctx.fillRect(0, this.groundY, this.size, this.size - this.groundY);
    ctx.fillStyle = 'rgba(150,196,110,0.9)';
    ctx.fillRect(0, this.groundY, this.size, this.px(0.018));
  }

  private drawBird(): void {
    const ctx = this.ctx;
    const r = this.px(BIRD_R);
    const x = this.px(BIRD_X);

    // Nose follows velocity: climbing tilts up, falling tilts down.
    const tilt = Math.max(-0.5, Math.min(1.1, this.vy / this.px(1.6)));

    ctx.save();
    ctx.translate(x, this.birdY);
    ctx.rotate(tilt);

    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
    g.addColorStop(0, '#fde68a');
    g.addColorStop(1, '#f59e0b');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Wing: flapped up right after an input, level otherwise.
    const wing = this.vy < 0 ? -r * 0.55 : r * 0.2;
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, wing * 0.5, r * 0.5, r * 0.3, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(r * 0.75, -r * 0.1);
    ctx.lineTo(r * 1.35, r * 0.1);
    ctx.lineTo(r * 0.7, r * 0.32);
    ctx.closePath();
    ctx.fillStyle = '#f97316';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.32, r * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    ctx.restore();
  }

  private drawScore(): void {
    const ctx = this.ctx;
    // The canvas is transparent over an unknown desktop, so the score carries its own
    // shadow rather than trusting the backdrop for contrast.
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `600 ${Math.round(this.px(0.13))}px system-ui, sans-serif`;
    ctx.fillText(String(this.score), this.size / 2, this.px(0.06));

    if (this.best > 0) {
      ctx.font = `500 ${Math.round(this.px(0.05))}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`best ${this.best}`, this.size / 2, this.px(0.2));
    }
    ctx.restore();
  }

  override onPointerDown(): void {
    // Clicking through the crash or the final score would flap the next life before it is
    // on screen, which reads as the input being eaten.
    if (this.phase === 'dead' || this.phase === 'over') return;
    if (this.phase === 'ready') this.phase = 'playing';
    this.vy = -this.px(FLAP);
  }
}
