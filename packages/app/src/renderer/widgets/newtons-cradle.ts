import { CanvasWidget } from './types';

const COUNT = 5;
/**
 * Squared natural frequency of each pendulum, in rad^2/s^2.
 *
 * NOT g/L: the arm length is in pixels, and feeding a pixel length into a metres-based
 * gravity gives a ~24 second period - a cradle in extreme slow motion. Setting the
 * frequency directly decouples the physics from the widget's pixel size, so the swing
 * looks the same at any canvas dimension. 16 gives a period of ~1.6s, which reads like
 * a real desk cradle.
 */
const ANGULAR_FREQ_SQ = 16;
/** Just under 1 so the cradle eventually settles instead of swinging forever. */
const DAMPING = 0.9995;
const CONTACT_EPSILON = 0.012;
/**
 * Widest swing the cradle is ever allowed to reach, in radians (~46 degrees).
 *
 * The whole layout is sized so a ball at this angle still clears the canvas edge, so it
 * caps the drag AND sets how far the arm can be from vertical - raise it and the balls
 * swing back out of the frame. `init()` derives the arm length from it rather than the
 * other way round, so the containment holds at any box size.
 */
const MAX_ANGLE = 0.8;
/** Breathing room between a fully swung ball and the canvas edge, in pixels. */
const EDGE_PADDING = 4;

interface Ball {
  angle: number;
  omega: number;
}

/**
 * Newton's cradle.
 *
 * Deliberately not a general physics solver: the balls are independent pendulums and
 * collisions are resolved as instantaneous momentum swaps between neighbours. At this
 * size that reads exactly like the real object, and it can't explode the way a naive
 * spring solver does.
 */
export class NewtonsCradle extends CanvasWidget {
  private balls: Ball[] = [];
  private ballRadius = 0;
  private length = 0;
  private pivotY = 0;
  private spacing = 0;
  private originX = 0;
  private dragIndex: number | null = null;

  protected init(): void {
    // Ball size and the row of pivots come off the height, so the cradle keeps its
    // proportions; only the swing needs the extra width.
    this.ballRadius = this.height * 0.075;
    this.spacing = this.ballRadius * 2;
    this.pivotY = this.height * 0.16;
    const halfSpan = ((COUNT - 1) * this.spacing) / 2;
    this.originX = this.width / 2 - halfSpan;

    // Longest arm that keeps a fully swung outer ball inside the box, on both axes. The
    // horizontal term is the binding one - the cradle is much wider in motion than at
    // rest, which is why its window is wider than the other toys'.
    const clearance = this.ballRadius + EDGE_PADDING;
    const maxByWidth = (this.width / 2 - halfSpan - clearance) / Math.sin(MAX_ANGLE);
    const maxByHeight = this.height - this.pivotY - clearance;
    this.length = Math.max(0, Math.min(this.height * 0.5, maxByWidth, maxByHeight));

    this.balls = Array.from({ length: COUNT }, () => ({ angle: 0, omega: 0 }));
    // Start with the classic one-ball lift so it's immediately recognisable.
    this.balls[0]!.angle = -MAX_ANGLE * 0.85;
  }

  private pivotX(i: number): number {
    return this.originX + i * this.spacing;
  }

  private ballPos(i: number): { x: number; y: number } {
    const b = this.balls[i]!;
    return {
      x: this.pivotX(i) + Math.sin(b.angle) * this.length,
      y: this.pivotY + Math.cos(b.angle) * this.length,
    };
  }

  protected update(dt: number): void {
    // Substep: a single 16ms step is too coarse for clean contact resolution.
    const steps = 4;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this.step(h);
  }

  private step(h: number): void {
    for (let i = 0; i < COUNT; i++) {
      if (i === this.dragIndex) continue;
      const b = this.balls[i]!;
      b.omega += -ANGULAR_FREQ_SQ * Math.sin(b.angle) * h;
      b.omega *= DAMPING;
      b.angle += b.omega * h;
    }

    // Neighbours touch when their angular gap closes. Swap velocities on contact -
    // equal masses in an elastic collision exchange them exactly.
    for (let i = 0; i < COUNT - 1; i++) {
      const a = this.balls[i]!;
      const b = this.balls[i + 1]!;
      const gap = b.angle - a.angle;
      if (gap < CONTACT_EPSILON && a.omega > b.omega) {
        const tmp = a.omega;
        a.omega = b.omega;
        b.omega = tmp;
        // Separate them so they don't re-collide on the next substep.
        const overlap = (CONTACT_EPSILON - gap) / 2;
        if (i !== this.dragIndex) a.angle -= overlap;
        if (i + 1 !== this.dragIndex) b.angle += overlap;
      }
    }
  }

  protected draw(): void {
    const ctx = this.ctx;

    // Frame.
    ctx.beginPath();
    ctx.moveTo(this.originX - this.spacing * 0.6, this.pivotY);
    ctx.lineTo(this.pivotX(COUNT - 1) + this.spacing * 0.6, this.pivotY);
    ctx.strokeStyle = 'rgba(210,220,240,0.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    for (let i = 0; i < COUNT; i++) {
      const p = this.ballPos(i);

      ctx.beginPath();
      ctx.moveTo(this.pivotX(i), this.pivotY);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = 'rgba(200,212,235,0.5)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const g = ctx.createRadialGradient(
        p.x - this.ballRadius * 0.35,
        p.y - this.ballRadius * 0.35,
        this.ballRadius * 0.15,
        p.x,
        p.y,
        this.ballRadius,
      );
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#cbd5e1');
      g.addColorStop(1, '#64748b');

      ctx.beginPath();
      ctx.arc(p.x, p.y, this.ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  override onPointerDown(x: number, y: number): void {
    for (let i = 0; i < COUNT; i++) {
      const p = this.ballPos(i);
      const dx = x - p.x;
      const dy = y - p.y;
      const grab = this.ballRadius * 1.6;
      if (dx * dx + dy * dy <= grab * grab) {
        this.dragIndex = i;
        this.balls[i]!.omega = 0;
        return;
      }
    }
  }

  override onPointerMove(x: number, y: number): void {
    if (this.dragIndex === null) return;
    const b = this.balls[this.dragIndex]!;
    const raw = Math.atan2(x - this.pivotX(this.dragIndex), y - this.pivotY);
    // Clamp to the same angle the layout was sized for, so a drag can't pull a ball out
    // through the side of the window.
    b.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, raw));
    b.omega = 0;
  }

  override onPointerUp(): void {
    this.dragIndex = null;
  }
}
