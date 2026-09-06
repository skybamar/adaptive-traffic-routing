import { createScheduledController, env, reset } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { REGIONS_KEY } from '../src/state';

const originFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', originFetch);

afterEach(async () => {
  originFetch.mockReset();
  await reset();
});

it('records health and load of every region from the cron probe', async () => {
  originFetch.mockImplementation(async (_url, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${env.PROBE_TOKEN}`);
    switch (headers.get('x-region')) {
      case 'eu':
        return Response.json({ load: 0.35 });
      case 'na':
        return Response.json({ load: 0.95 });
      default:
        throw new Error('connection refused');
    }
  });

  await worker.scheduled(createScheduledController(), env);

  expect(await env.STATE.get(REGIONS_KEY, 'json')).toEqual({
    eu: { healthy: true, load: 0.35 },
    na: { healthy: true, load: 0.95 },
    asia: { healthy: false, load: 1 },
  });
});
