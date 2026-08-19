import { describe, expect, it } from 'vitest';

import {
  CycleHold,
  GAME_IDS,
  HOLD_CAP_MS,
  TOY_IDS,
  WIDGET_IDS,
  WidgetRotation,
  isSelfPaced,
  wantsKeyboard,
} from '../packages/app/src/main/widget-ids';
import { WIDGET_REGISTRY } from '../packages/app/src/renderer/widgets/registry';

const isToy = (id: string) => (TOY_IDS as readonly string[]).includes(id);

function drawMany(count: number, random?: () => number): string[] {
  const rotation = new WidgetRotation(random);
  return Array.from({ length: count }, () => rotation.next('random'));
}

describe('WidgetRotation', () => {
  it('opens on a toy', () => {
    for (let i = 0; i < 50; i++) {
      expect(isToy(drawMany(1)[0]!)).toBe(true);
    }
  });

  it('alternates toy, game, toy, game', () => {
    const drawn = drawMany(60);
    for (let i = 0; i < drawn.length; i++) {
      expect(isToy(drawn[i]!)).toBe(i % 2 === 0);
    }
  });

  it('only ever returns known ids', () => {
    for (const id of drawMany(60)) {
      expect(WIDGET_IDS as readonly string[]).toContain(id);
    }
  });

  // The point of the shuffle bag over plain random picking: plain random would leave one
  // toy showing up a third more often than another over a run this long, and nobody would
  // be able to tell that from a bug.
  it('shows every widget exactly equally over a whole number of laps', () => {
    const laps = 40;
    const drawn = drawMany(laps * TOY_IDS.length * 2);
    const counts = new Map<string, number>();
    for (const id of drawn) counts.set(id, (counts.get(id) ?? 0) + 1);

    expect(counts.size).toBe(WIDGET_IDS.length);
    for (const id of WIDGET_IDS) expect(counts.get(id)).toBe(laps);
  });

  it('never repeats a widget across the seam between two laps', () => {
    // Two draws apart is the same kind, and the only place a bag could hand back what it
    // just finished with.
    const drawn = drawMany(400);
    for (let i = 2; i < drawn.length; i++) {
      expect(drawn[i]).not.toBe(drawn[i - 2]);
    }
  });

  it('is not a fixed order - the same kind comes up in different sequences', () => {
    const sequences = new Set<string>();
    for (let i = 0; i < 60; i++) {
      sequences.add(drawMany(6).filter(isToy).join(','));
    }
    expect(sequences.size).toBeGreaterThan(1);
  });

  it('honours a pinned widget without consuming a draw', () => {
    const rotation = new WidgetRotation();
    expect(rotation.next('fidget-spinner')).toBe('fidget-spinner');
    expect(rotation.next('fidget-spinner')).toBe('fidget-spinner');
    // The pin never advanced the alternation, so random still starts where it would have.
    expect(isToy(rotation.next('random'))).toBe(true);
  });

  it('falls back to the first widget for an unknown preference', () => {
    expect(new WidgetRotation().next('not-a-widget')).toBe(WIDGET_IDS[0]);
  });

  it('survives a degenerate random source', () => {
    // Math.random() is specified as < 1, but a shuffle that indexes out of bounds on a
    // 0.999999 is the kind of thing that only shows up in the wild.
    for (const value of [0, 0.999999]) {
      const drawn = drawMany(20, () => value);
      expect(drawn.every((id) => (WIDGET_IDS as readonly string[]).includes(id))).toBe(true);
    }
  });
});

describe('widget kinds', () => {
  it('splits every widget into exactly one kind', () => {
    expect([...TOY_IDS, ...GAME_IDS]).toEqual([...WIDGET_IDS]);
  });

  // Alternation only spreads the six evenly if the two sides are the same size. Adding a
  // fourth game without a fourth toy would quietly make each game rarer than each toy.
  it('keeps the two kinds the same size, which is what makes alternation fair', () => {
    expect(TOY_IDS.length).toBe(GAME_IDS.length);
  });
});

describe('isSelfPaced', () => {
  // Named one by one rather than derived from GAME_IDS: a test that reads the same list
  // the implementation reads would pass however a widget was filed.
  it('exempts every game from the cycle clock', () => {
    for (const id of [
      'snake',
      'flappy-bird',
      'pong',
      'simon',
      'suika',
      'space-invaders',
      'tetris',
    ]) {
      expect(isSelfPaced(id)).toBe(true);
    }
  });

  it('leaves the fidget toys on the clock', () => {
    for (const id of [
      'bubble-wrap',
      'fidget-spinner',
      'newtons-cradle',
      'falling-sand',
      'tower-of-hanoi',
      'thumb-piano',
      'buzz-wire',
    ]) {
      expect(isSelfPaced(id)).toBe(false);
    }
  });

  it('treats an unknown id as clock-paced, so a typo cannot wedge the cycle', () => {
    expect(isSelfPaced('not-a-widget')).toBe(false);
  });

  it('names only ids that exist', () => {
    for (const id of WIDGET_IDS.filter(isSelfPaced)) {
      expect(WIDGET_REGISTRY[id]).toBeDefined();
    }
  });
});

describe('CycleHold', () => {
  const T0 = 1_000_000;

  it('lets the swap through when nobody has asked for anything', () => {
    expect(new CycleHold().blocks('tower-of-hanoi', T0)).toBe(false);
  });

  it('makes the cycle wait for the widget that asked, and only that one', () => {
    const hold = new CycleHold();
    hold.set('tower-of-hanoi', true, T0);
    expect(hold.blocks('tower-of-hanoi', T0 + 5_000)).toBe(true);
    // The swap that comes due for a different board is nothing to do with this hold.
    expect(hold.blocks('bubble-wrap', T0 + 5_000)).toBe(false);
  });

  it('lets go when the widget says it is finished', () => {
    const hold = new CycleHold();
    hold.set('tower-of-hanoi', true, T0);
    hold.set('tower-of-hanoi', false, T0 + 5_000);
    expect(hold.blocks('tower-of-hanoi', T0 + 5_001)).toBe(false);
  });

  // The whole point of the cap: a toy that forgets to let go, or a player who never
  // finishes, must not end up owning the screen.
  it('stops blocking once the cap is spent', () => {
    const hold = new CycleHold();
    hold.set('tower-of-hanoi', true, T0);
    expect(hold.blocks('tower-of-hanoi', T0 + HOLD_CAP_MS - 1)).toBe(true);
    expect(hold.blocks('tower-of-hanoi', T0 + HOLD_CAP_MS)).toBe(false);
  });

  // Asking again is how a widget keeps saying "still busy"; if that reset the clock, the
  // cap would be no cap at all.
  it('runs the cap from the first ask, not the latest', () => {
    const hold = new CycleHold();
    hold.set('tower-of-hanoi', true, T0);
    hold.set('tower-of-hanoi', true, T0 + HOLD_CAP_MS - 1);
    expect(hold.blocks('tower-of-hanoi', T0 + HOLD_CAP_MS)).toBe(false);
  });

  // A release from the board that already left must not cancel its replacement's hold.
  it('ignores a release from a widget that is no longer the one holding', () => {
    const hold = new CycleHold();
    hold.set('tower-of-hanoi', true, T0);
    hold.set('suika', false, T0 + 100);
    expect(hold.blocks('tower-of-hanoi', T0 + 200)).toBe(true);
  });

  it('drops everything when the widget is taken away', () => {
    const hold = new CycleHold();
    hold.set('tower-of-hanoi', true, T0);
    hold.clear();
    expect(hold.blocks('tower-of-hanoi', T0 + 1)).toBe(false);
  });
});

describe('wantsKeyboard', () => {
  // The arrow keys are taken from the whole desktop while a widget that wants them is up,
  // so this list existing at all is the reason it stays short. Snake and Tetris are the
  // two games arrows are the natural control for everywhere else; both are still complete
  // under the pointer, which is the price of being on the list.
  //
  // This is a spelt-out list rather than a count on purpose: adding to it means editing a
  // test that says what the cost is, which is the point.
  it('is snake and tetris and nothing else', () => {
    expect(WIDGET_IDS.filter(wantsKeyboard)).toEqual(['snake', 'tetris']);
  });

  it('is false for an unknown id', () => {
    expect(wantsKeyboard('not-a-widget')).toBe(false);
  });
});

describe('registry agreement', () => {
  // The main process and the renderer keep separate lists on purpose - main must not
  // import React. The cost is that a new widget has to be added twice, and forgetting
  // the second edit means the cycle lands on an id that silently falls back to
  // bubble-wrap. This is the test that catches it.
  it('WIDGET_IDS matches the renderer registry exactly, in order', () => {
    expect(Object.keys(WIDGET_REGISTRY)).toEqual([...WIDGET_IDS]);
  });

  it('every id builds a widget', () => {
    for (const id of WIDGET_IDS) {
      expect(WIDGET_REGISTRY[id]).toBeDefined();
      expect(typeof WIDGET_REGISTRY[id]!.label).toBe('string');
    }
  });
});
