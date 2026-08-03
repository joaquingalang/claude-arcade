import { describe, expect, it } from 'vitest';

import { buildHookSettings, serializeHookSettings } from '../packages/cli/src/hook-settings';
import { SUBSCRIBED_EVENTS } from '../packages/shared/src/protocol';
import { PORT_RANGE_END, PORT_RANGE_START } from '../packages/shared/src/ports';

describe('buildHookSettings', () => {
  const settings = buildHookSettings(45970, 'tok-123');

  it('registers every event the state machine consumes', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual([...SUBSCRIBED_EVENTS].sort());
  });

  it('only ever points at loopback', () => {
    for (const entries of Object.values(settings.hooks)) {
      for (const entry of entries) {
        for (const handler of entry.hooks) {
          const url = new URL(handler.url);
          expect(url.hostname).toBe('127.0.0.1');
          expect(url.protocol).toBe('http:');
        }
      }
    }
  });

  it('only ever uses a port in the reserved range', () => {
    for (const entries of Object.values(settings.hooks)) {
      for (const entry of entries) {
        for (const handler of entry.hooks) {
          const port = Number(new URL(handler.url).port);
          expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START);
          expect(port).toBeLessThanOrEqual(PORT_RANGE_END);
        }
      }
    }
  });

  it('never collides with the port range Clawd on Desk uses', () => {
    expect(PORT_RANGE_START).toBeGreaterThan(23337);
  });

  it('is async so Claude never blocks on us', () => {
    for (const entries of Object.values(settings.hooks)) {
      for (const entry of entries) {
        for (const handler of entry.hooks) {
          expect(handler.async).toBe(true);
          expect(handler.type).toBe('http');
          expect(handler.timeout).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it('carries the session token so hooks can be correlated to a launcher', () => {
    const url = new URL(settings.hooks['Stop']![0]!.hooks[0]!.url);
    expect(url.searchParams.get('token')).toBe('tok-123');
  });

  it('serialises to a single argv element small enough for a Windows command line', () => {
    const json = serializeHookSettings(settings);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain('\n');
    expect(json.length).toBeLessThan(8000);
  });
});
