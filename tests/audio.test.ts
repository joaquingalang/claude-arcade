import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Fake Web Audio, recording enough to assert on what would have been heard.
 *
 * `connect` returns its target so the real chaining call - source.connect(gain)
 * .connect(destination) - works against it unchanged.
 */
/** An AudioParam, recording the envelope written onto it. */
class FakeParam {
  value = 0;
  events: Array<{ kind: string; value: number; at: number }> = [];
  setValueAtTime(value: number, at: number): this {
    this.value = value;
    this.events.push({ kind: 'set', value, at });
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number): this {
    this.events.push({ kind: 'exp', value, at });
    return this;
  }
  linearRampToValueAtTime(value: number, at: number): this {
    this.events.push({ kind: 'lin', value, at });
    return this;
  }
}

class FakeSource {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  /** Pretend the sample ran out, which is what frees the voice slot. */
  end(): void {
    this.onended?.();
  }
}

class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  end(): void {
    this.onended?.();
  }
}

class FakeFilter {
  type = '';
  frequency = new FakeParam();
  Q = new FakeParam();
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {}
}

class FakeGain {
  gain = new FakeParam();
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {}
}

class FakeAudioContext {
  static built = 0;
  /** The most recent one, so a test can reach a context nothing exposes directly. */
  static last: FakeAudioContext | null = null;
  state: 'running' | 'suspended' = 'running';
  destination = {};
  currentTime = 0;
  sampleRate = 48000;
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  filters: FakeFilter[] = [];
  buffersMade = 0;
  resumes = 0;
  suspends = 0;

  constructor() {
    FakeAudioContext.built++;
    FakeAudioContext.last = this;
  }

  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }

  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }

  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }

  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }

  createBuffer(_channels: number, frames: number): unknown {
    this.buffersMade++;
    return { getChannelData: () => new Float32Array(frames) };
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
    // Byte length doubles as the sample's identity, so tests can tell them apart.
    return Promise.resolve({ id: bytes.byteLength });
  }

  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

interface Env {
  /** Which sample files exist. Anything else 404s. */
  present?: string[];
  /** Drop Web Audio entirely, as in a browser too old to have it. */
  noWebAudio?: boolean;
  /** Expose `window.arcade`, as the packaged app does and the dev harness does not. */
  bridge?: boolean;
}

/** The requested sample names, in order, however they were asked for. */
let requested: string[] = [];
/** Names that went over the IPC bridge rather than through fetch. */
let viaBridge: string[] = [];

/**
 * A fresh copy of the module under a stubbed browser.
 *
 * Re-imported per test on purpose: `enabled` and the bank are module state, and a test
 * that turned sound on must not leak into the next one.
 */
async function loadAudio(env: Env = {}) {
  const present = env.present ?? ['pop-1.mp3', 'pop-2.mp3', 'pop-3.mp3', 'pop-4.mp3'];
  requested = [];
  viaBridge = [];
  FakeAudioContext.built = 0;
  FakeAudioContext.last = null;

  const win: Record<string, unknown> = env.noWebAudio ? {} : { AudioContext: FakeAudioContext };
  if (env.bridge) {
    win.arcade = {
      readSample: (name: string) => {
        requested.push(name);
        viaBridge.push(name);
        const index = present.indexOf(name);
        // A Uint8Array over a larger buffer, which is what an IPC transfer looks like:
        // if the module forwards the view's buffer whole, the decode gets the wrong bytes.
        if (index === -1) return Promise.resolve(null);
        const backing = new Uint8Array(64);
        return Promise.resolve(backing.subarray(0, index + 1));
      },
    };
  }
  vi.resetModules();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { baseURI: 'file:///app/dist/renderer/index.html' });
  vi.stubGlobal('fetch', (url: string) => {
    const file = url.split('/').pop() ?? '';
    requested.push(file);
    const index = present.indexOf(file);
    if (index === -1) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({
      ok: true,
      // Distinct length per file, which decodeAudioData turns into a distinct buffer id.
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(index + 1)),
    });
  });

  return import('../packages/app/src/renderer/audio');
}

/** The live context the bank built, or null if it never built one. */
function contextOf(bank: unknown): FakeAudioContext | null {
  return (bank as { ctx: FakeAudioContext | null }).ctx;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sound gating', () => {
  it('is off until switched on, and touches nothing while off', async () => {
    const { pops, isSoundEnabled } = await loadAudio();
    expect(isSoundEnabled()).toBe(false);

    pops.play();

    // The point of the default: no fetch, and no AudioContext to hold the device open.
    expect(requested).toEqual([]);
    expect(FakeAudioContext.built).toBe(0);
  });

  it('loads the samples as soon as it is switched on', async () => {
    const { pops, setSoundEnabled, isSoundEnabled, POP_FILES } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();

    expect(isSoundEnabled()).toBe(true);
    expect(requested).toEqual(POP_FILES);
  });

  it('goes quiet again when switched off', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();
    setSoundEnabled(false);

    pops.play();
    expect(contextOf(pops)?.sources).toEqual([]);
  });

  it('reads through the bridge when there is one, since file:// cannot be fetched', async () => {
    const { pops, setSoundEnabled, POP_FILES } = await loadAudio({ bridge: true });
    vi.stubGlobal('fetch', () => {
      throw new Error('fetch must not be used when the bridge is available');
    });
    setSoundEnabled(true);
    await pops.prime();

    expect(viaBridge).toEqual(POP_FILES);
    pops.play();
    expect(contextOf(pops)!.sources).toHaveLength(1);
  });

  it('skips samples the bridge reports as missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pops, setSoundEnabled } = await loadAudio({ bridge: true, present: [] });
    setSoundEnabled(true);
    await pops.prime();

    expect(() => pops.play()).not.toThrow();
    expect(contextOf(pops)!.sources).toEqual([]);
    warn.mockRestore();
  });

  it('falls back to fetch in the dev harness, where there is no bridge', async () => {
    const urls: string[] = [];
    const { pops, setSoundEnabled } = await loadAudio();
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url);
      return Promise.resolve({ ok: false, status: 404 });
    });
    setSoundEnabled(true);
    await pops.prime();

    expect(urls[0]).toBe('file:///app/dist/renderer/sounds/pop-1.mp3');
  });
});

describe('playback', () => {
  it('plays a sample on demand', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();

    pops.play();

    const ctx = contextOf(pops)!;
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.started).toBe(true);
    expect(ctx.sources[0]!.buffer).not.toBeNull();
  });

  it('varies pitch and level, so a fast drag is not one sample on a loop', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();

    const ctx = contextOf(pops)!;
    for (let i = 0; i < 5; i++) {
      pops.play();
      ctx.sources[i]!.end();
    }

    const rates = ctx.sources.map((s) => s.playbackRate.value);
    const gains = ctx.gains.map((g) => g.gain.value);
    expect(new Set(rates).size).toBeGreaterThan(1);
    expect(new Set(gains).size).toBeGreaterThan(1);
    // Bounded either side of normal: a pop an octave down is a different sound effect.
    for (const rate of rates) expect(rate).toBeGreaterThan(0.8);
    for (const rate of rates) expect(rate).toBeLessThan(1.2);
    // Never full scale - this plays over whatever the user is actually doing.
    for (const gain of gains) expect(gain).toBeLessThan(0.6);
    for (const gain of gains) expect(gain).toBeGreaterThan(0);
  });

  it('never plays the same sample twice in a row', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();

    const ctx = contextOf(pops)!;
    const heard: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      pops.play();
      const source = ctx.sources[ctx.sources.length - 1]!;
      heard.push((source.buffer as { id: number }).id);
      source.end();
    }

    for (let i = 1; i < heard.length; i++) expect(heard[i]).not.toBe(heard[i - 1]);
    // All four still get used - "no repeats" must not collapse into a fixed A B A B.
    expect(new Set(heard).size).toBe(4);
  });

  it('caps concurrent voices, then frees them as samples finish', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();

    const ctx = contextOf(pops)!;
    // Nothing ends, so every one of these is still sounding.
    for (let i = 0; i < 50; i++) pops.play();
    const capped = ctx.sources.length;
    expect(capped).toBeLessThanOrEqual(6);

    for (const source of [...ctx.sources]) source.end();
    pops.play();
    expect(ctx.sources.length).toBe(capped + 1);
  });

  it('wakes a suspended context, since a pop always follows a pointer press', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();

    const ctx = contextOf(pops)!;
    pops.suspend();
    expect(ctx.state).toBe('suspended');

    pops.play();
    expect(ctx.resumes).toBe(1);
    expect(ctx.sources).toHaveLength(1);
  });

  it('keeps the context across a suspend, rather than decoding everything again', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();
    const before = requested.length;

    pops.suspend();
    pops.play();

    expect(FakeAudioContext.built).toBe(1);
    expect(requested.length).toBe(before);
  });
});

/**
 * The synthesised voices.
 *
 * These have no files to be missing, so the failure they have to survive is a context that
 * lacks a node type rather than a 404 - and, as with the samples, they are called from
 * inside a pointer handler and must never throw there.
 */
describe('thumb piano', () => {
  it('is silent while sound is off, and builds no context to be silent with', async () => {
    const { tines } = await loadAudio();
    tines.pluck(0);
    expect(FakeAudioContext.built).toBe(0);
  });

  it('sounds a tine as three decaying partials, not one bare sine', async () => {
    const { tines, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    tines.pluck(0);

    const ctx = FakeAudioContext.last!;
    expect(ctx.oscillators).toHaveLength(3);
    for (const osc of ctx.oscillators) expect(osc.started).toBe(true);
    // The octave above the fundamental is what makes it read as struck metal.
    const hz = ctx.oscillators.map((o) => o.frequency.value);
    expect(hz[1]).toBeCloseTo(hz[0]! * 2, 5);
    // Every partial fades rather than stopping dead.
    for (const gain of ctx.gains) {
      if (gain.gain.events.length === 0) continue;
      expect(gain.gain.events.some((e) => e.kind === 'exp')).toBe(true);
    }
  });

  it('plays the note it was asked for, and clamps one it cannot', async () => {
    const { tines, setSoundEnabled, TINE_HZ } = await loadAudio();
    setSoundEnabled(true);

    tines.pluck(2);
    const ctx = FakeAudioContext.last!;
    expect(ctx.oscillators[0]!.frequency.value).toBeCloseTo(TINE_HZ[2]!, 2);

    // Out of range must land on a real tine rather than NaN into the frequency.
    tines.pluck(99);
    tines.pluck(-4);
    for (const osc of ctx.oscillators) expect(Number.isFinite(osc.frequency.value)).toBe(true);
  });

  /** Pentatonic is what makes a random sweep consonant - no semitones, no tritone. */
  it('is tuned to a scale with no semitones in it', async () => {
    const { TINE_HZ } = await loadAudio();
    for (let i = 1; i < TINE_HZ.length; i++) {
      const semitones = 12 * Math.log2(TINE_HZ[i]! / TINE_HZ[i - 1]!);
      expect(semitones).toBeGreaterThan(1.5);
    }
  });

  it('caps how many tines can ring at once', async () => {
    const { tines, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    for (let i = 0; i < 40; i++) tines.pluck(i % 7);
    const ctx = FakeAudioContext.last!;
    // Three oscillators per voice, eight voices.
    expect(ctx.oscillators.length).toBeLessThanOrEqual(8 * 3);

    for (const osc of [...ctx.oscillators]) osc.end();
    const freed = ctx.oscillators.length;
    tines.pluck(0);
    expect(ctx.oscillators.length).toBeGreaterThan(freed);
  });

  it('stays silent rather than throwing where there are no oscillators', async () => {
    const { tines, setSoundEnabled } = await loadAudio();
    vi.stubGlobal('window', {
      AudioContext: class {
        state = 'running';
        destination = {};
        currentTime = 0;
        createGain() {
          return new FakeGain();
        }
        createOscillator(): never {
          throw new Error('no oscillators here');
        }
      },
    });

    setSoundEnabled(true);
    expect(() => tines.pluck(3)).not.toThrow();
  });
});

describe('simon pads', () => {
  it('is silent while sound is off, and builds no context to be silent with', async () => {
    const { buzzer } = await loadAudio();
    buzzer.play(0, 0.3);
    buzzer.fail();
    expect(FakeAudioContext.built).toBe(0);
  });

  it('sounds the pad it was asked for, rolled off rather than a bare square', async () => {
    const { buzzer, setSoundEnabled, PAD_HZ } = await loadAudio();
    setSoundEnabled(true);

    buzzer.play(2, 0.3);

    const ctx = FakeAudioContext.last!;
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0]!.type).toBe('square');
    expect(ctx.oscillators[0]!.frequency.events[0]!.value).toBeCloseTo(PAD_HZ[2]!, 2);
    // The lowpass is what separates a toy buzzer from a smoke alarm.
    expect(ctx.filters).toHaveLength(1);
    expect(ctx.filters[0]!.type).toBe('lowpass');
  });

  /** The tone is a copy of the light, so it has to last as long as the flash does. */
  it('holds a tone flat for the length it was given, then lets it down', async () => {
    const { buzzer, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    buzzer.play(0, 0.4);

    const events = FakeAudioContext.last!.gains[0]!.gain.events;
    // Up, held, down - and the last event is the release landing at the end of the flash.
    expect(events[0]!.kind).toBe('set');
    expect(events[1]!.kind).toBe('exp');
    expect(events[1]!.at).toBeLessThan(0.05);
    expect(events[events.length - 1]!.at).toBeCloseTo(0.4, 5);
    // Never full scale - Simon plays over whatever the user is actually doing.
    expect(events[1]!.value).toBeLessThan(0.4);
  });

  it('never lets a tone be shorter than a note', async () => {
    const { buzzer, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    buzzer.play(1, 0.01);
    const events = FakeAudioContext.last!.gains[0]!.gain.events;
    expect(events[events.length - 1]!.at).toBeGreaterThan(0.1);
  });

  it('clamps a pad it cannot play rather than sending NaN to the oscillator', async () => {
    const { buzzer, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    buzzer.play(99, 0.3);
    buzzer.play(-4, 0.3);
    for (const osc of FakeAudioContext.last!.oscillators) {
      expect(Number.isFinite(osc.frequency.events[0]!.value)).toBe(true);
    }
  });

  it('answers a wrong pad with a low blat that sags in pitch', async () => {
    const { buzzer, setSoundEnabled, PAD_HZ } = await loadAudio();
    setSoundEnabled(true);

    buzzer.fail();

    const osc = FakeAudioContext.last!.oscillators[0]!;
    const [start, end] = osc.frequency.events;
    // Below every pad, and falling: unmistakably not one of the four.
    expect(start!.value).toBeLessThan(Math.min(...PAD_HZ));
    expect(end!.kind).toBe('exp');
    expect(end!.value).toBeLessThan(start!.value);
  });

  /** Scheduled on the audio clock, not a rAF loop, so the notes land evenly. */
  it('plays the win as four rising notes, spaced ahead in time', async () => {
    const { buzzer, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    buzzer.win();

    const ctx = FakeAudioContext.last!;
    expect(ctx.oscillators).toHaveLength(4);
    const hz = ctx.oscillators.map((o) => o.frequency.events[0]!.value);
    for (let i = 1; i < hz.length; i++) expect(hz[i]).toBeGreaterThan(hz[i - 1]!);
    // Each one starts after the one before, and none of them at the moment of the press.
    const starts = ctx.gains.map((g) => g.gain.events[0]!.at);
    expect(starts[0]).toBeGreaterThan(0);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]!);
  });

  it('caps concurrent tones, then frees them as they finish', async () => {
    const { buzzer, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    for (let i = 0; i < 30; i++) buzzer.play(i % 4, 0.3);
    const ctx = FakeAudioContext.last!;
    const capped = ctx.oscillators.length;
    expect(capped).toBeLessThanOrEqual(6);

    for (const osc of [...ctx.oscillators]) osc.end();
    buzzer.play(0, 0.3);
    expect(ctx.oscillators.length).toBe(capped + 1);
  });

  it('stays silent rather than throwing where there are no oscillators', async () => {
    const { buzzer, setSoundEnabled } = await loadAudio();
    vi.stubGlobal('window', {
      AudioContext: class {
        state = 'running';
        destination = {};
        currentTime = 0;
        createGain() {
          return new FakeGain();
        }
        createOscillator(): never {
          throw new Error('no oscillators here');
        }
      },
    });

    setSoundEnabled(true);
    expect(() => buzzer.play(1, 0.3)).not.toThrow();
    expect(() => buzzer.fail()).not.toThrow();
    expect(() => buzzer.win()).not.toThrow();
  });

  /**
   * The tones are a duplicate of the colours, so the intervals between them are what stop
   * a random sequence sounding like a mistake. A major chord: no semitones, no tritone.
   */
  it('is tuned to a chord rather than four arbitrary pitches', async () => {
    const { PAD_HZ } = await loadAudio();
    const sorted = [...PAD_HZ].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const semitones = 12 * Math.log2(sorted[i]! / sorted[i - 1]!);
      expect(semitones).toBeGreaterThan(2.5);
    }
    // Spanning an octave exactly, which is what makes it a chord and not a scale fragment.
    expect(12 * Math.log2(sorted[sorted.length - 1]! / sorted[0]!)).toBeCloseTo(12, 1);
  });
});

describe('rain stick beads', () => {
  it('is silent while sound is off', async () => {
    const { beads } = await loadAudio();
    beads.tick();
    expect(FakeAudioContext.built).toBe(0);
  });

  it('band-passes a slice of noise, jittered so a cascade is not one click repeated', async () => {
    const { beads, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    const ctx = () => FakeAudioContext.last!;
    for (let i = 0; i < 6; i++) {
      beads.tick();
      const last = ctx().sources[ctx().sources.length - 1]!;
      last.end();
    }

    expect(ctx().filters).toHaveLength(6);
    for (const f of ctx().filters) expect(f.type).toBe('bandpass');
    // Every strike differs, or forty beads sound like one bead forty times.
    expect(new Set(ctx().filters.map((f) => f.frequency.value)).size).toBeGreaterThan(1);
    expect(new Set(ctx().sources.map((s) => s.playbackRate.value)).size).toBeGreaterThan(1);
  });

  it('generates the noise once and reuses it for every bead', async () => {
    const { beads, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    for (let i = 0; i < 5; i++) {
      beads.tick();
      const ctx = FakeAudioContext.last!;
      ctx.sources[ctx.sources.length - 1]!.end();
    }
    expect(FakeAudioContext.last!.buffersMade).toBe(1);
  });

  it('caps concurrent beads, then frees them as they decay', async () => {
    const { beads, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);

    for (let i = 0; i < 60; i++) beads.tick();
    const ctx = FakeAudioContext.last!;
    const capped = ctx.sources.length;
    expect(capped).toBeLessThanOrEqual(14);

    for (const s of [...ctx.sources]) s.end();
    beads.tick();
    expect(ctx.sources.length).toBe(capped + 1);
  });
});

describe('one context for everything', () => {
  it('shares a single context across samples and synthesis', async () => {
    const { pops, tines, beads, setSoundEnabled } = await loadAudio();
    setSoundEnabled(true);
    await pops.prime();

    pops.play();
    tines.pluck(1);
    beads.tick();

    // Three sources of noise, one device held open.
    expect(FakeAudioContext.built).toBe(1);
  });

  it('quiets synthesised voices on hide too, not just the samples', async () => {
    const { tines, setSoundEnabled, suspendSound } = await loadAudio();
    setSoundEnabled(true);
    tines.pluck(0);

    const ctx = FakeAudioContext.last!;
    expect(ctx.state).toBe('running');
    suspendSound();
    expect(ctx.state).toBe('suspended');
    expect(ctx.suspends).toBe(1);
  });

  it('wakes the context again on the next pluck', async () => {
    const { tines, setSoundEnabled, suspendSound } = await loadAudio();
    setSoundEnabled(true);
    tines.pluck(0);
    suspendSound();

    tines.pluck(1);
    expect(FakeAudioContext.last!.resumes).toBe(1);
  });
});

describe('missing or broken samples', () => {
  it('stays silent when no files are installed, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pops, setSoundEnabled } = await loadAudio({ present: [] });
    setSoundEnabled(true);
    await pops.prime();

    expect(() => pops.play()).not.toThrow();
    expect(contextOf(pops)?.sources).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('uses whatever subset is installed', async () => {
    const { pops, setSoundEnabled } = await loadAudio({ present: ['pop-2.mp3'] });
    setSoundEnabled(true);
    await pops.prime();

    pops.play();
    pops.play();
    // One sample means the no-repeat rule has to give way rather than deadlock.
    expect(contextOf(pops)!.sources).toHaveLength(2);
  });

  it('survives a sample that fetches but will not decode', async () => {
    const { pops, setSoundEnabled } = await loadAudio();
    const ctx = new FakeAudioContext();
    vi.spyOn(ctx, 'decodeAudioData').mockRejectedValue(new Error('not audio'));
    vi.stubGlobal('window', { AudioContext: () => ctx });

    setSoundEnabled(true);
    await expect(pops.prime()).resolves.toBeUndefined();
    expect(() => pops.play()).not.toThrow();
  });

  it('does nothing at all where there is no Web Audio', async () => {
    const { pops, setSoundEnabled } = await loadAudio({ noWebAudio: true });
    setSoundEnabled(true);
    await pops.prime();

    expect(() => pops.play()).not.toThrow();
    expect(() => pops.suspend()).not.toThrow();
    expect(requested).toEqual([]);
  });
});
