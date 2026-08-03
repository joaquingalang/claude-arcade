/**
 * Port range reserved for Claude Arcade.
 *
 * Deliberately NOT 233xx: "Clawd on Desk" (another Claude Code companion app that may
 * be installed alongside us) binds 23333-23337. Colliding there would make both apps
 * intermittently fail depending on start order.
 */
export const PORT_RANGE_START = 45970;
export const PORT_RANGE_END = 45979;

export function portsInRange(): number[] {
  const ports: number[] = [];
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) ports.push(p);
  return ports;
}

export function isPortInRange(port: number): boolean {
  return Number.isInteger(port) && port >= PORT_RANGE_START && port <= PORT_RANGE_END;
}

/** The only interface we ever bind or connect to. Never 0.0.0.0. */
export const LOOPBACK = '127.0.0.1';
