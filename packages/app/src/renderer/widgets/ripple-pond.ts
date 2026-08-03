import { CanvasWidget } from './types';

/** Oldest ripples are dropped past this. A crowded pond is noise, not water. */
const MAX_RIPPLES = 22;
const RIPPLE_LIFE = 2.8;
/** Rings behind the leading one. Three is what makes a drop read as a wave train. */
const RINGS = 3;

const AMBIENT_MIN = 0.55;
const AMBIENT_MAX = 1.7;
/** How far the pointer must travel before a drag lays down another ripple. */
const TRAIL_SPACING = 0.14;

interface Ripple {
  x: number;
  y: number;
  /** 0 -> 1 over the ripple's life. */
  t: number;
  /** Scales both the radius it reaches and how hard it hits. */
  strength: number;
}

/**
 * A pond, seen from above.
 *
 * Rings expand and fade, and that is the whole model - no wave equation, no grid. At this
 * size an interference solver would buy nothing you could see and cost a full-canvas pass
 * every frame.
 *
 * The basin is circular and the scene is masked to it, so ripples reaching the edge are
 * cut off by the rim rather than sailing out across the desktop. Drops fall on their own
 * whether or not anyone is here, which is what keeps it moving; clicking adds a heavier
 * one, and dragging draws a line of them across the surface.
 */
export class RipplePond extends CanvasWidget {
  private ripples: Ripple[] = [];
  private ambientTimer = 0;
  private dragging = false;
  private lastDrop: { x: number; y: number } | null = null;
  private cx = 0;
  private cy = 0;
  private basinR = 0;

  protected init(): void {
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.basinR = this.size * 0.42;
    this.ripples = [];
    this.dragging = false;
    this.lastDrop = null;
    this.armAmbient();

    // Open mid-scene. A pond that starts flat and stays flat for its first second reads
    // as a picture of a pond.
    for (const t of [0.62, 0.34, 0.08]) {
      const r = this.ambientDrop();
      r.t = t;
    }
  }

  private armAmbient(): void {
    this.ambientTimer = AMBIENT_MIN + Math.random() * (AMBIENT_MAX - AMBIENT_MIN);
  }

  /** A drop somewhere on the surface, weighted to land evenly across the disc. */
  private ambientDrop(): Ripple {
    const a = Math.random() * Math.PI * 2;
    // sqrt, not a bare random: without it drops cluster in the middle, because a uniform
    // radius packs the same number of drops into ever smaller rings.
    const d = Math.sqrt(Math.random()) * this.basinR * 0.82;
    return this.drop(this.cx + Math.cos(a) * d, this.cy + Math.sin(a) * d, 0.4 + Math.random() * 0.3);
  }

  private drop(x: number, y: number, strength: number): Ripple {
    const r: Ripple = { x, y, t: 0, strength };
    this.ripples.push(r);
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
    return r;
  }

  protected update(dt: number): void {
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientDrop();
      this.armAmbient();
    }

    for (const r of this.ripples) r.t += dt / RIPPLE_LIFE;
    // Filtering in place rather than rebuilding: this runs every frame for the life of
    // the widget.
    let kept = 0;
    for (const r of this.ripples) {
      if (r.t < 1) this.ripples[kept++] = r;
    }
    this.ripples.length = kept;
  }

  protected draw(): void {
    this.drawWater();
    for (const r of this.ripples) this.drawRipple(r);
    this.maskToBasin();
    this.drawRim();
  }

  private drawWater(): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.cx,
      this.cy - this.basinR * 0.2,
      this.basinR * 0.1,
      this.cx,
      this.cy,
      this.basinR,
    );
    g.addColorStop(0, 'rgba(30,64,110,0.62)');
    g.addColorStop(1, 'rgba(8,20,45,0.78)');

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.basinR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  private drawRipple(r: Ripple): void {
    const ctx = this.ctx;
    const reach = this.basinR * (0.55 + r.strength * 0.75);
    // Decelerating: a ring races away from the impact and slows as it spreads, which is
    // what separates water from a radar sweep.
    const lead = reach * (1 - (1 - r.t) * (1 - r.t));
    const fade = (1 - r.t) * (1 - r.t);
    const gap = this.basinR * 0.075;

    for (let i = 0; i < RINGS; i++) {
      const radius = lead - i * gap;
      if (radius <= 0) continue;
      const alpha = fade * r.strength * (i === 0 ? 0.85 : 0.4 / i);
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${i === 0 ? '236,248,255' : '186,220,255'},${alpha})`;
      ctx.lineWidth = Math.max(0.6, (this.basinR * 0.02 * fade) / (i + 1));
      ctx.stroke();
    }

    // The splash itself, for the first moment only.
    if (r.t > 0.16) return;
    const k = 1 - r.t / 0.16;
    ctx.beginPath();
    ctx.arc(r.x, r.y, this.basinR * 0.03 * k * r.strength * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.7 * k})`;
    ctx.fill();
  }

  /**
   * Cut everything back to the basin.
   *
   * Rings are circles centred on wherever the drop landed, so any drop off-centre throws
   * an arc past the edge of the water. `destination-in` against a soft-edged disc is one
   * pass and gives the rim a feathered edge for free - a hard clip on a transparent
   * window would leave a visible stair-stepped line.
   */
  private maskToBasin(): void {
    const ctx = this.ctx;
    const mask = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.basinR);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(0.94, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.basinR, 0, Math.PI * 2);
    ctx.fillStyle = mask;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Drawn after the mask, so the rim is a rim and not something to be cut away. */
  private drawRim(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.basinR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148,180,220,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.basinR * 0.97, Math.PI * 1.1, Math.PI * 1.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = this.basinR * 0.035;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private inBasin(x: number, y: number): boolean {
    const dx = x - this.cx;
    const dy = y - this.cy;
    return dx * dx + dy * dy <= this.basinR * this.basinR;
  }

  override onPointerDown(x: number, y: number): void {
    this.dragging = true;
    if (!this.inBasin(x, y)) return;
    this.drop(x, y, 1);
    this.lastDrop = { x, y };
  }

  /** A drag draws a line of drops, spaced by distance so speed sets how dense it is. */
  override onPointerMove(x: number, y: number): void {
    if (!this.dragging || !this.inBasin(x, y)) return;
    if (this.lastDrop) {
      const dx = x - this.lastDrop.x;
      const dy = y - this.lastDrop.y;
      const spacing = this.basinR * TRAIL_SPACING;
      if (dx * dx + dy * dy < spacing * spacing) return;
    }
    this.drop(x, y, 0.65);
    this.lastDrop = { x, y };
  }

  override onPointerUp(): void {
    this.dragging = false;
    this.lastDrop = null;
  }
}
