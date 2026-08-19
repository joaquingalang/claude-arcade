/**
 * Sound for the widgets - recorded samples and synthesised voices, over one context.
 *
 * Silent unless `soundEnabled` is set in config.json, and silent anyway if the sample
 * files are not present - a desk toy that throws because an mp3 is missing is worse than
 * one that quietly does not click.
 *
 * Web Audio rather than `new Audio()`. An HTMLAudioElement plays one sound at a time and
 * restarting it mid-play cuts the previous one off, which is exactly wrong here: sweeping
 * the pointer across the sheet pops several bubbles in a few frames and they have to
 * overlap. Web Audio also gives per-voice `playbackRate`, which is what keeps a fast drag
 * from sounding like one sample on a loop.
 *
 * Everything but the bubble wrap synthesises rather than samples, which is a deliberate
 * split rather than an inconsistency. Bubble wrap samples because a real pop is full of
 * detail no oscillator will reproduce, and because a missing file there costs polish and
 * nothing else. The thumb piano is the opposite case: its pitches *are* the toy, so a
 * missing sample set would not make it duller, it would make it pointless - and nine
 * tuned files is a lot to ask before anything can be heard. Synthesis makes it correct by
 * construction and audible the moment sound is switched on. Simon follows for the same
 * reason, four tuned files instead of nine. The Tower of Hanoi follows because a disc
 * settling onto wood is a filtered noise transient, which is nearly all a synthesiser has
 * to say. The buzz wire follows because its contact is two detuned oscillators beating
 * against each other, which is a thing synthesis does exactly and a recording only
 * approximates.
 */

/** Copied verbatim out of `renderer/public/` at build time, so this path is stable. */
const SOUND_DIR = 'sounds';

/** The bubble wrap samples. Any that are missing are skipped; all four missing is silence. */
export const POP_FILES = ['pop-1.mp3', 'pop-2.mp3', 'pop-3.mp3', 'pop-4.mp3'];

/** Loudest a single voice gets. Well under 1: this thing plays over other people's work. */
const BASE_GAIN = 0.35;
/**
 * Pitch spread, as a playback rate multiplier.
 *
 * Four samples alone are not enough - pop the sheet in a hurry and the ear picks the
 * repeat out immediately. A few percent of pitch either way is what makes each one read
 * as a separate bubble rather than a replay.
 */
const PITCH_SPREAD = 0.12;
/**
 * Ceiling on voices sounding at once.
 *
 * A drag can cross several bubbles in a frame, and an unbounded stack of samples is both
 * loud and mushy. Past this the extra pops are dropped rather than queued - a late pop is
 * worse than no pop, because it has come unstuck from the bubble that caused it.
 */
const MAX_VOICES = 6;

/** Off by default, matching `DEFAULTS.soundEnabled` in main/config.ts. */
let enabled = false;

/**
 * The one AudioContext everything here shares.
 *
 * Built on first use and never rebuilt. One per voice source would be three devices held
 * open for a widget that only ever shows one toy at a time, and `suspendSound` would have
 * to know about each of them - a list that would silently fall behind the next toy that
 * makes a noise. One context means hiding the window quiets everything by construction.
 */
let shared: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (shared) return shared;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  try {
    shared = new window.AudioContext();
  } catch {
    return null;
  }
  return shared;
}

/**
 * Turn sample playback on or off, and prime the buffers when turning it on.
 *
 * Priming matters: decoding takes a moment, and the first pop is the one most likely to
 * be the only pop. Waiting for it would mean the sheet is silent exactly once, which
 * reads as a bug rather than a setting.
 */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (on) void pops.prime();
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/**
 * The bytes of one sample, or null if it is not installed.
 *
 * Two routes, because the renderer runs on two different origins. The packaged app is
 * loaded with `loadFile`, and Chromium's fetch() rejects the `file:` scheme outright -
 * not a CORS failure that could be waved through, a flat refusal - so the main process
 * reads the file and hands the bytes over IPC. The dev harness is served over http by
 * Vite, has no preload and so no bridge, and fetches normally.
 */
async function readBytes(file: string): Promise<ArrayBuffer | null> {
  const bridge = typeof window !== 'undefined' ? window.arcade : undefined;
  if (bridge?.readSample) {
    const bytes = await bridge.readSample(file);
    if (!bytes) return null;
    // Copied out of the transferred view: decodeAudioData detaches the buffer it is
    // given, and the view may sit in a larger pooled one.
    return bytes.slice().buffer as ArrayBuffer;
  }

  if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
  const url = new URL(`${SOUND_DIR}/${file}`, document.baseURI).href;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

type BankState = 'idle' | 'loading' | 'ready' | 'unavailable';

export class SoundBank {
  private ctx: AudioContext | null = null;
  private buffers: AudioBuffer[] = [];
  private state: BankState = 'idle';
  private voices = 0;
  /** Index of the last sample played, so the same one is not picked twice in a row. */
  private last = -1;
  /** The in-flight load, so a second caller waits on it instead of starting another. */
  private loading: Promise<void> | null = null;

  constructor(private readonly files: string[]) {}

  /**
   * Load and decode the samples.
   *
   * Safe to call repeatedly, and awaiting it always means "the samples are ready or they
   * never will be" - a second caller joins the first load rather than returning early
   * while it is still running.
   */
  prime(): Promise<void> {
    if (this.state === 'ready' || this.state === 'unavailable') return Promise.resolve();
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const ctx = this.context();
    if (!ctx) {
      this.state = 'unavailable';
      return;
    }

    this.state = 'loading';
    const decoded = await Promise.all(this.files.map((file) => this.decode(ctx, file)));
    this.buffers = decoded.filter((b): b is AudioBuffer => b !== null);
    this.state = this.buffers.length > 0 ? 'ready' : 'unavailable';
    if (this.state === 'unavailable') {
      console.warn(
        `[arcade] sound is on but no samples loaded from ${SOUND_DIR}/ - staying silent`,
      );
    }
  }

  /**
   * Play one sample.
   *
   * Deliberately not async and never throws: this is called from inside a pop, and a
   * widget's interaction must not depend on the audio stack being in any particular
   * state. Anything not ready is silence.
   */
  play(): void {
    if (!enabled) return;
    if (this.state === 'idle') {
      // First pop of a run that was enabled before the module loaded. Start the fetch so
      // the *next* one lands, rather than blocking this one on a decode.
      void this.prime();
      return;
    }
    if (this.state !== 'ready' || this.voices >= MAX_VOICES) return;

    const ctx = this.ctx;
    if (!ctx) return;
    // Suspended is the normal state after a hide, and Chromium can also start it that
    // way. Pops only ever follow a pointer press, so there is always a gesture behind it.
    if (ctx.state === 'suspended') void ctx.resume();

    const buffer = this.pick();
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * PITCH_SPREAD;

    // Level jitter as well as pitch: real sheets do not pop at one volume, and the two
    // together are what stop a run of pops sounding mechanical.
    const gain = ctx.createGain();
    gain.gain.value = BASE_GAIN * (0.8 + Math.random() * 0.4);

    source.connect(gain).connect(ctx.destination);
    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  /**
   * Let the audio hardware idle while the widget is hidden.
   *
   * The context is kept rather than closed - a closed one cannot be reopened, and
   * rebuilding it would mean decoding all four samples again on the next appearance.
   */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** A different sample than last time, so a double pop is never the same sound twice. */
  private pick(): AudioBuffer | null {
    const n = this.buffers.length;
    if (n === 0) return null;
    let i = Math.floor(Math.random() * n);
    if (n > 1 && i === this.last) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.last = i;
    return this.buffers[i] ?? null;
  }

  /**
   * The shared AudioContext, held here too so the bank can play without reaching for it
   * again on every voice. Null anywhere without Web Audio - tests, node.
   */
  private context(): AudioContext | null {
    this.ctx = audioContext();
    return this.ctx;
  }

  /** One sample, or null if it is missing or not decodable. Never rejects. */
  private async decode(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
    try {
      const bytes = await readBytes(file);
      if (!bytes) return null;
      return await ctx.decodeAudioData(bytes);
    } catch {
      return null;
    }
  }
}

/** The bubble wrap bank. One instance, because the samples are shared across runs. */
export const pops = new SoundBank(POP_FILES);

/**
 * Shared plumbing for the synthesised voices.
 *
 * `begin()` is the whole gate: disabled, no Web Audio, or out of voices all look the same
 * from the caller's side - a null it can return on. Widgets call these from inside a
 * pointer handler, so like `SoundBank.play` they must never throw and never block.
 */
abstract class Synth {
  protected voices = 0;

  protected constructor(private readonly maxVoices: number) {}

  protected begin(): AudioContext | null {
    if (!enabled) return null;
    if (this.voices >= this.maxVoices) return null;
    const ctx = audioContext();
    if (!ctx) return null;
    // Suspended is the normal state after a hide. Every voice here follows a pointer
    // event or a collision the user caused, so there is always a gesture behind it.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
}

/**
 * The thumb piano's scale, low to high.
 *
 * Major pentatonic, and that choice is doing real work rather than being a taste call. The
 * tines are plucked in whatever order a pointer happens to cross them, so any interval the
 * scale admits will be played, constantly, by accident. A pentatonic scale has no semitones
 * and no tritone, which is exactly the property that makes every one of those accidents
 * consonant - it is why a sweep across the whole instrument sounds deliberate. It is also
 * what let the tines keep their traditional layout: a real kalimba runs lowest in the
 * middle and alternates outwards, so left-to-right is not a scale, and on any other tuning
 * that would sound like a mistake.
 *
 * Nine notes, and the two the ninth tine pair added went on the bottom rather than the top.
 * Continuing up the scale would have put the outermost tines at 1319Hz and 1568Hz, where a
 * pentatonic stops sounding warm and starts sounding like a smoke alarm - and the outermost
 * tines are exactly the ones a careless sweep hits hardest. Extending downwards costs
 * nothing: G4 and A4 are already in the scale, so every interval stays consonant, and the
 * board gains a bass end a kalimba is supposed to have.
 */
export const TINE_HZ = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];

/** Partials of a struck tine: the fundamental, its octave, and the attack ping. */
const TINE_PARTIALS = [
  { ratio: 1, amp: 0.5, decay: 1 },
  { ratio: 2, amp: 0.16, decay: 0.42 },
  { ratio: 5.4, amp: 0.05, decay: 0.09 },
];
const TINE_GAIN = 0.3;

export class Tines extends Synth {
  constructor() {
    super(8);
  }

  /**
   * Pluck tine `note`, 0 lowest.
   *
   * Three decaying sines rather than one: a bare sine reads as a test tone, and the thing
   * that makes it a struck piece of metal is the octave above it fading roughly twice as
   * fast, with a short bright ping on the attack.
   */
  pluck(note: number, velocity = 1): void {
    const ctx = this.begin();
    if (!ctx) return;

    const hz = TINE_HZ[Math.max(0, Math.min(TINE_HZ.length - 1, Math.round(note)))]!;
    const now = ctx.currentTime;
    // Longer tines ring longer, which is a property of the bar rather than a taste call.
    const decay = 0.85 + 0.85 * (TINE_HZ[0]! / hz);
    const level = Math.max(0.25, Math.min(1, velocity));

    try {
      const out = ctx.createGain();
      out.gain.value = TINE_GAIN * level;
      out.connect(ctx.destination);

      let primary: OscillatorNode | null = null;
      for (const partial of TINE_PARTIALS) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz * partial.ratio;

        const env = ctx.createGain();
        const life = decay * partial.decay;
        // Exponential ramps cannot reach or pass through zero, hence the small floor.
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(partial.amp, now + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, now + life);

        osc.connect(env).connect(out);
        osc.start(now);
        osc.stop(now + life + 0.02);
        if (primary === null) primary = osc;
      }

      this.voices++;
      const release = () => {
        this.voices--;
        out.disconnect();
      };
      if (primary) primary.onended = release;
      else release();
    } catch {
      /* a context missing a node type is silence, not a broken toy */
    }
  }
}

/** Loudest a single knock gets. A bare transient, over the top of other people's work. */
const KNOCK_GAIN = 0.2;
/** Seconds of noise to draw from. Long enough that reads never line up audibly. */
const NOISE_SECONDS = 0.4;

export class Knock extends Synth {
  private noise: AudioBuffer | null = null;

  constructor() {
    super(6);
  }

  /**
   * One disc settling onto wood.
   *
   * A band-passed slice of noise with a 30ms decay. The filter centre is jittered per
   * knock, which is what stops a run of moves from sounding like one click repeated - the
   * same problem the pop samples solve with four files and pitch jitter.
   */
  tick(level = 1): void {
    const ctx = this.begin();
    if (!ctx) return;
    const buffer = this.buffer(ctx);
    if (!buffer) return;

    const now = ctx.currentTime;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      // Start anywhere in the noise, so successive knocks never read the same samples.
      const decay = 0.022 + Math.random() * 0.03;
      src.playbackRate.value = 0.8 + Math.random() * 0.8;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1700 + Math.random() * 3300;
      band.Q.value = 2.5 + Math.random() * 3.5;

      const env = ctx.createGain();
      const peak = KNOCK_GAIN * Math.max(0.15, Math.min(1, level)) * (0.6 + Math.random() * 0.6);
      env.gain.setValueAtTime(peak, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + decay);

      src.connect(band).connect(env).connect(ctx.destination);
      this.voices++;
      src.onended = () => {
        this.voices--;
        src.disconnect();
        band.disconnect();
        env.disconnect();
      };
      src.start(now, Math.random() * (NOISE_SECONDS * 0.5));
      src.stop(now + decay + 0.01);
    } catch {
      /* as above - silence rather than a throw inside a collision handler */
    }
  }

  /** White noise, generated once and reused for every knock. */
  private buffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noise) return this.noise;
    try {
      const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
      return buffer;
    } catch {
      return null;
    }
  }
}

/**
 * Loudest the buzz gets.
 *
 * Under the pads, and for the same reason they are under the pops: this is a held tone
 * rather than a transient, and the sound of somebody else's mistake is not a thing that
 * should carry across a room.
 */
const RASP_GAIN = 0.14;
/**
 * The two pitches the buzz is made of.
 *
 * Three and a bit semitones apart, so the difference between them lands at 22Hz - low
 * enough that the ear takes it as a rattle rather than as two notes. That rattle *is* the
 * rasp: either oscillator alone is a hum, and the pair of them is a doorbell transformer
 * with a short in it, which is what a buzz wire actually sounds like.
 */
const RASP_HZ = [104, 126];
/** Where the sawtooths are rolled off. Above this it stops rasping and starts hissing. */
const RASP_CUTOFF = 1500;
const RASP_SECONDS = 0.24;
const RASP_ATTACK = 0.006;
const RASP_RELEASE = 0.04;

/**
 * The buzz wire's contact.
 *
 * Synthesised, like Simon and the thumb piano, but for a slightly different reason: the
 * sound is not carrying anything the picture doesn't - the wire lights up end to end at
 * the same moment - so this is polish, and polish that arrives with the install rather
 * than needing a file is polish that is actually there.
 */
export class Rasp extends Synth {
  constructor() {
    super(2);
  }

  /** Ground the wire. */
  buzz(seconds = RASP_SECONDS): void {
    const ctx = this.begin();
    if (!ctx) return;

    const now = ctx.currentTime;
    const length = Math.max(RASP_ATTACK + RASP_RELEASE, seconds);
    try {
      const env = ctx.createGain();
      // Exponential ramps cannot reach zero, hence the floor - as in Tines.pluck.
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(RASP_GAIN, now + RASP_ATTACK);
      env.gain.setValueAtTime(RASP_GAIN, now + length - RASP_RELEASE);
      env.gain.exponentialRampToValueAtTime(0.0001, now + length);

      const tame = ctx.createBiquadFilter();
      tame.type = 'lowpass';
      tame.frequency.value = RASP_CUTOFF;
      tame.connect(env).connect(ctx.destination);

      const oscillators = RASP_HZ.map((hz) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(hz, now);
        osc.connect(tame);
        osc.start(now);
        osc.stop(now + length + 0.02);
        return osc;
      });

      // One voice for the pair, freed by the first of them to finish - they are started
      // and stopped together, and counting them separately would halve the cap.
      this.voices++;
      oscillators[0]!.onended = () => {
        this.voices--;
        for (const osc of oscillators) osc.disconnect();
        tame.disconnect();
        env.disconnect();
      };
    } catch {
      /* as everywhere here - silence rather than a throw inside a pointer handler */
    }
  }
}

/**
 * Simon's four pad tones, in pad order: green, red, yellow, blue.
 *
 * The original toy's pitches, and like the thumb piano's pentatonic they are load-bearing
 * rather than nostalgia. They spell an A major chord - A3, C#4, E4, A4 - so a sequence is
 * consonant however the generator happens to land. That matters more here than anywhere
 * else in the set: the tone is a second copy of the colour, meant to be memorised
 * alongside it, and a sequence that sounds like a mistake is one you stop listening to.
 */
export const PAD_HZ = [329.63, 277.18, 440, 220];

/**
 * Loudest a pad tone gets.
 *
 * Under the pops, and deliberately: those are transients an ear barely registers, while
 * this is a held tone, and a sustained square at pop level would be the loudest thing on
 * the desktop.
 */
const PAD_GAIN = 0.16;
/** Attack and release, in seconds. Enough to take the click off both ends of a tone. */
const PAD_ATTACK = 0.012;
const PAD_RELEASE = 0.07;
/** Shortest a pad tone can be, so even the briefest flash is a note and not a tick. */
const PAD_MIN = 0.12;
/**
 * Where the square wave is rolled off, in Hz.
 *
 * A bare square is a smoke alarm. Taking the top harmonics off leaves the shape that says
 * "cheap plastic buzzer", which is the sound being aimed at, without the fizz that makes
 * it unpleasant over a working day.
 */
const PAD_CUTOFF = 2600;

/** The wrong-pad blat: a low square sagging in pitch over half a second. */
const FAIL_HZ = 138;
const FAIL_DROP = 82;
const FAIL_TIME = 0.55;

/** The win: the four pads low to high, a beat apart, after the last press has spoken. */
const WIN_ORDER = [3, 1, 0, 2];
const WIN_DELAY = 0.14;
const WIN_STEP = 0.11;
const WIN_LENGTH = 0.22;

/**
 * Simon's voice.
 *
 * Synthesised for the same reason the thumb piano is: the pitches are the point. Simon is
 * the one game in the set built to be playable in silence - the tone never carries anything
 * the colour does not - so this is a second channel for the same information rather than
 * half of it. With sound on you can look away and still play; with sound off nothing is
 * missing.
 */
export class Buzzer extends Synth {
  constructor() {
    super(6);
  }

  /**
   * Sound pad `pad` for `seconds` - a playback flash, or a press.
   *
   * The caller passes the length because the flash shortens as the sequence grows, and a
   * tone that outlasts the light it belongs to is a tone that answers the wrong pad.
   */
  play(pad: number, seconds: number): void {
    const ctx = this.begin();
    if (!ctx) return;
    const i = Math.max(0, Math.min(PAD_HZ.length - 1, Math.round(pad)));
    this.tone(ctx, PAD_HZ[i]!, Math.max(PAD_MIN, seconds), PAD_GAIN);
  }

  /** The wrong pad, or a run left to time out. */
  fail(): void {
    const ctx = this.begin();
    if (!ctx) return;
    this.tone(ctx, FAIL_HZ, FAIL_TIME, PAD_GAIN, 0, FAIL_DROP);
  }

  /** Eight rounds. Scheduled ahead rather than driven frame by frame - see `tone`. */
  win(): void {
    const ctx = this.begin();
    if (!ctx) return;
    WIN_ORDER.forEach((pad, i) => {
      this.tone(ctx, PAD_HZ[pad]!, WIN_LENGTH, PAD_GAIN * 0.9, WIN_DELAY + i * WIN_STEP);
    });
  }

  /**
   * One filtered square, held flat and then let down.
   *
   * Flat rather than decaying from the attack: a tone that fades the moment it starts is a
   * pluck, and a Simon pad sounds for exactly as long as it is lit. `delay` schedules a
   * tone into the future on the audio clock, which is the only way to place the notes of a
   * flourish accurately - a rAF loop firing them would jitter by a frame each.
   */
  private tone(
    ctx: AudioContext,
    hz: number,
    seconds: number,
    peak: number,
    delay = 0,
    endHz?: number,
  ): void {
    const now = ctx.currentTime + delay;
    try {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(hz, now);
      if (endHz !== undefined) osc.frequency.exponentialRampToValueAtTime(endHz, now + seconds);

      const tame = ctx.createBiquadFilter();
      tame.type = 'lowpass';
      tame.frequency.value = PAD_CUTOFF;

      const env = ctx.createGain();
      // Exponential ramps cannot reach zero, hence the floor - as in Tines.pluck.
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(peak, now + PAD_ATTACK);
      env.gain.setValueAtTime(peak, now + Math.max(PAD_ATTACK, seconds - PAD_RELEASE));
      env.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

      osc.connect(tame).connect(env).connect(ctx.destination);
      this.voices++;
      osc.onended = () => {
        this.voices--;
        osc.disconnect();
        tame.disconnect();
        env.disconnect();
      };
      osc.start(now);
      osc.stop(now + seconds + 0.02);
    } catch {
      /* as everywhere here - silence rather than a throw inside a press handler */
    }
  }
}

/** The thumb piano's voice. */
export const tines = new Tines();
/** The Tower of Hanoi's discs landing. */
export const knock = new Knock();
/** The buzz wire's ring touching the wire. */
export const rasp = new Rasp();
/** Simon's pads. */
export const buzzer = new Buzzer();

/**
 * Called when the widget window hides, so nothing holds the audio device open.
 *
 * Suspends the shared context rather than each source in turn - that way a toy added later
 * is covered without anyone remembering to add it here.
 */
export function suspendSound(): void {
  if (shared && shared.state === 'running') void shared.suspend();
}
