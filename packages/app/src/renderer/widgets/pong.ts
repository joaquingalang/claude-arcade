import { CanvasWidget } from './types';

/**
 * Every dimension is a fraction of the canvas box, so the court scales with the widget
 * instead of being pinned to 280px.
 */
const INSET = 0.05;
const PADDLE_W = 0.2;
const PADDLE_H = 0.026;
const PADDLE_GAP = 0.055;
const BALL_R = 0.022;

/** Speeds are "fractions of the box per second" for the same reason. */
const BASE_SPEED = 0.62;
/** Added to the ball's speed on every paddle hit, so a rally can't stall at walking pace. */
const SPEED_STEP = 0.08;
/**
 * Added to the *serve* speed per point already played.
 *
 * Without it every point restarts at `BASE_SPEED` and the match is a set of identical
 * slow rallies - the escalation inside a rally is thrown away the moment it scores. This
 * carries it across, so a match visibly winds up towards its ending instead of running
 * to five at the same pace throughout.
 */
const SERVE_RAMP = 0.07;
const MAX_SPEED = 1.35;
const AI_SPEED = 0.6;

/** Widest deflection off a paddle edge, in radians from vertical. */
const MAX_BOUNCE = 1.0;
const WIN_SCORE = 5;
const SERVE_DELAY = 0.5;
const TRAIL = 7;
/** How long the result is held before handing over, so the match has an ending. */
const OVER_PAUSE = 1.8;

/**
 * Pong, played with the mouse.
 *
 * The paddle tracks the pointer directly rather than needing a drag, which is the only
 * scheme that works for a window that never takes keyboard focus. Until the pointer
 * first moves over the canvas the player paddle plays itself, so the toy is already
 * mid-rally when it fades in - a still frame would read as a screenshot.
 *
 * A match runs to five and then stops. It is not interrupted by the cycle clock, because
 * being pulled off court at 4-3 is worse than never having played: the whole point of
 * keeping score is finding out who wins.
 */
export class Pong extends CanvasWidget {
  private ballX = 0;
  private ballY = 0;
  private ballVX = 0;
  private ballVY = 0;
  private speed = 0;
  private playerX = 0;
  private aiX = 0;
  /** Where the AI aims within its own paddle - the reason it is beatable. */
  private aiBias = 0;
  private pointerX: number | null = null;
  private serveTimer = 0;
  private playerScore = 0;
  private aiScore = 0;
  private trail: Array<{ x: number; y: number }> = [];
  /** Counts down once the match is decided; at zero the widget hands over. */
  private overTimer = 0;
  private winner: 'player' | 'ai' | null = null;

  private px(fraction: number): number {
    return fraction * this.size;
  }

  private get courtLeft(): number {
    return this.px(INSET);
  }

  private get courtRight(): number {
    return this.size - this.px(INSET);
  }

  private get playerY(): number {
    return this.size - this.px(INSET + PADDLE_GAP + PADDLE_H);
  }

  private get aiY(): number {
    return this.px(INSET + PADDLE_GAP);
  }

  protected init(): void {
    this.playerX = this.size / 2;
    this.aiX = this.size / 2;
    this.playerScore = 0;
    this.aiScore = 0;
    this.pointerX = null;
    this.winner = null;
    this.overTimer = 0;
    this.serve(Math.random() < 0.5 ? 1 : -1);
    // No serve pause on the very first ball: the toy should appear already in play.
    this.serveTimer = 0;
  }

  /** `direction` is the sign of vy: +1 sends the ball down at the player. */
  private serve(direction: number): void {
    this.ballX = this.size / 2;
    this.ballY = this.size / 2;
    // Scores are already updated by the time a serve is set up, so they double as the
    // count of points played and there is no separate counter to keep in step.
    const played = this.playerScore + this.aiScore;
    this.speed = Math.min(this.px(MAX_SPEED), this.px(BASE_SPEED + SERVE_RAMP * played));
    const angle = (Math.random() - 0.5) * 0.8;
    this.ballVX = Math.sin(angle) * this.speed;
    this.ballVY = Math.cos(angle) * this.speed * direction;
    this.serveTimer = SERVE_DELAY;
    this.aiBias = (Math.random() - 0.5) * this.px(PADDLE_W) * 0.7;
    this.trail = [];
  }

  protected update(dt: number): void {
    if (this.winner) {
      // Paddles keep drifting under the result, so the court doesn't freeze solid.
      this.movePaddles(dt);
      this.overTimer += dt;
      if (this.overTimer >= OVER_PAUSE) this.finish();
      return;
    }

    this.movePaddles(dt);

    if (this.serveTimer > 0) {
      this.serveTimer -= dt;
      return;
    }

    this.ballX += this.ballVX * dt;
    this.ballY += this.ballVY * dt;

    this.trail.push({ x: this.ballX, y: this.ballY });
    if (this.trail.length > TRAIL) this.trail.shift();

    this.bounceOffWalls();
    this.bounceOffPaddles();
    this.checkPoint();
  }

  private movePaddles(dt: number): void {
    const half = this.px(PADDLE_W) / 2;
    const min = this.courtLeft + half;
    const max = this.courtRight - half;

    // Before the pointer has ever entered the canvas, the player side plays itself.
    const playerTarget = this.pointerX ?? this.ballX;
    if (this.pointerX === null) {
      this.playerX = this.approach(this.playerX, playerTarget, this.px(AI_SPEED) * dt);
    } else {
      // Proportional follow, not a hard snap: a jittery hand shouldn't jitter the paddle.
      this.playerX += (playerTarget - this.playerX) * Math.min(1, dt * 18);
    }
    this.playerX = Math.max(min, Math.min(max, this.playerX));

    // The AI only commits while the ball is coming at it, and drifts back to the middle
    // otherwise. Perfect tracking would make the rally immortal and the toy boring.
    const aiTarget = this.ballVY < 0 ? this.ballX + this.aiBias : this.size / 2;
    this.aiX = this.approach(this.aiX, aiTarget, this.px(AI_SPEED) * dt);
    this.aiX = Math.max(min, Math.min(max, this.aiX));
  }

  private approach(current: number, target: number, maxStep: number): number {
    const delta = target - current;
    if (Math.abs(delta) <= maxStep) return target;
    return current + Math.sign(delta) * maxStep;
  }

  private bounceOffWalls(): void {
    const r = this.px(BALL_R);
    if (this.ballX - r < this.courtLeft) {
      this.ballX = this.courtLeft + r;
      this.ballVX = Math.abs(this.ballVX);
    } else if (this.ballX + r > this.courtRight) {
      this.ballX = this.courtRight - r;
      this.ballVX = -Math.abs(this.ballVX);
    }
  }

  private bounceOffPaddles(): void {
    const r = this.px(BALL_R);
    const h = this.px(PADDLE_H);
    const half = this.px(PADDLE_W) / 2;

    if (
      this.ballVY > 0 &&
      this.ballY + r >= this.playerY &&
      this.ballY - r <= this.playerY + h &&
      Math.abs(this.ballX - this.playerX) <= half + r
    ) {
      this.ballY = this.playerY - r;
      this.deflect(this.ballX - this.playerX, half, -1);
    } else if (
      this.ballVY < 0 &&
      this.ballY - r <= this.aiY + h &&
      this.ballY + r >= this.aiY &&
      Math.abs(this.ballX - this.aiX) <= half + r
    ) {
      this.ballY = this.aiY + h + r;
      this.deflect(this.ballX - this.aiX, half, 1);
    }
  }

  /**
   * Angle out is set by where the ball struck the paddle, not by mirroring the angle in.
   * That is what makes Pong steerable rather than a coin flip.
   */
  private deflect(offset: number, half: number, direction: number): void {
    const ratio = Math.max(-1, Math.min(1, offset / half));
    const angle = ratio * MAX_BOUNCE;
    this.speed = Math.min(this.px(MAX_SPEED), this.speed + this.px(SPEED_STEP));
    this.ballVX = Math.sin(angle) * this.speed;
    this.ballVY = Math.cos(angle) * this.speed * direction;
    this.aiBias = (Math.random() - 0.5) * half * 1.4;
  }

  private checkPoint(): void {
    const r = this.px(BALL_R);
    if (this.ballY - r > this.size) {
      this.aiScore++;
      this.afterPoint(-1);
    } else if (this.ballY + r < 0) {
      this.playerScore++;
      this.afterPoint(1);
    }
  }

  /** The conceding side serves, as in the real game - unless that was match point. */
  private afterPoint(direction: number): void {
    if (this.playerScore >= WIN_SCORE || this.aiScore >= WIN_SCORE) {
      this.winner = this.playerScore >= WIN_SCORE ? 'player' : 'ai';
      this.overTimer = 0;
      // Park the ball off court: the result is the only thing worth looking at now.
      this.trail = [];
      this.ballY = -this.px(BALL_R) * 4;
      return;
    }
    this.serve(direction);
  }

  protected draw(): void {
    this.drawCentreLine();
    this.drawScore();
    if (!this.winner) {
      this.drawTrail();
      this.drawBall();
    }
    this.drawPaddle(this.aiX, this.aiY, 'rgba(248,113,113,0.9)');
    this.drawPaddle(this.playerX, this.playerY, 'rgba(125,211,252,0.95)');
    if (this.winner) this.drawResult();
  }

  private drawResult(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.85)';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle =
      this.winner === 'player' ? 'rgba(125,211,252,0.95)' : 'rgba(248,113,113,0.95)';
    ctx.font = `600 ${Math.round(this.px(0.09))}px system-ui, sans-serif`;
    ctx.fillText(this.winner === 'player' ? 'you win' : 'you lose', this.size / 2, this.size / 2);
    ctx.restore();
  }

  private drawCentreLine(): void {
    const ctx = this.ctx;
    // Dashes drawn by hand rather than setLineDash, so the gap scales with the box.
    const y = this.size / 2;
    const dash = this.px(0.035);
    ctx.strokeStyle = 'rgba(226,232,240,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = this.courtLeft; x < this.courtRight; x += dash * 2) {
      ctx.moveTo(x, y);
      ctx.lineTo(Math.min(x + dash, this.courtRight), y);
    }
    ctx.stroke();
  }

  private drawScore(): void {
    const r = this.px(0.014);
    const x = this.courtRight - r * 2;
    const step = r * 3;

    for (let i = 0; i < WIN_SCORE; i++) {
      // AI pips climb away from the centre line, player pips descend from it.
      this.drawPip(x, this.size / 2 - step * (i + 1.2), r, i < this.aiScore, '248,113,113');
      this.drawPip(x, this.size / 2 + step * (i + 1.2), r, i < this.playerScore, '125,211,252');
    }
  }

  private drawPip(x: number, y: number, r: number, filled: boolean, rgb: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = filled ? `rgba(${rgb},0.9)` : `rgba(${rgb},0.18)`;
    ctx.fill();
  }

  private drawTrail(): void {
    const ctx = this.ctx;
    const r = this.px(BALL_R);
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i]!;
      const t = (i + 1) / this.trail.length;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * t * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.16 * t})`;
      ctx.fill();
    }
  }

  private drawBall(): void {
    const ctx = this.ctx;
    const r = this.px(BALL_R);
    const g = ctx.createRadialGradient(
      this.ballX - r * 0.3,
      this.ballY - r * 0.3,
      r * 0.15,
      this.ballX,
      this.ballY,
      r,
    );
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, 'rgba(203,213,225,0.9)');

    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  private drawPaddle(cx: number, y: number, color: string): void {
    const ctx = this.ctx;
    const w = this.px(PADDLE_W);
    const h = this.px(PADDLE_H);
    const x = cx - w / 2;

    ctx.fillStyle = color;
    // Rounded ends: a rect between two half-circles, so no roundRect dependency.
    ctx.beginPath();
    ctx.arc(x + h / 2, y + h / 2, h / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w - h / 2, y + h / 2, h / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + h / 2, y, w - h, h);
  }

  override onPointerDown(x: number): void {
    this.pointerX = x;
  }

  /** Hover steers - requiring a held button would make a 280px paddle a chore. */
  override onPointerMove(x: number): void {
    this.pointerX = x;
  }
}
