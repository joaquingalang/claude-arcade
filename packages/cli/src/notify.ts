import * as http from 'node:http';

import { LOOPBACK } from '@claude-arcade/shared';

/** Fire-and-forget POST to the app. Never throws, never blocks meaningfully. */
export function postJson(
  port: number,
  path: string,
  body: unknown,
  timeoutMs = 1500,
): Promise<void> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: LOOPBACK,
        port,
        path,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.end(payload);
  });
}
