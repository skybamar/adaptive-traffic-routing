import { createExecutionContext, env, reset, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Region } from '../src/regions';
import { downKey } from '../src/state';

type OriginBehaviour = number | 'unreachable';

const originFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', originFetch);

afterEach(async () => {
  originFetch.mockReset();
  await reset();
});

function origins(behaviour: Partial<Record<Region, OriginBehaviour>>) {
  originFetch.mockImplementation(async (_url, init) => {
    const region = new Headers(init?.headers).get('x-region') as Region;
    const status = behaviour[region] ?? 200;
    if (status === 'unreachable') throw new Error('connection refused');
    return Response.json({ region, serverTime: '2026-09-07T00:00:00.000Z' }, { status });
  });
}

const regionsCalled = () => originFetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-region'));

async function userFrom(colo: string, continent: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const request = new Request('http://router/time', { ...init, cf: { colo, continent } });
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('GET /time', () => {
  it('serves an Asian user from the Asian region', async () => {
    origins({});

    const response = await userFrom('NRT', 'AS');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-served-region')).toBe('asia');
    expect(response.headers.get('x-route-reason')).toBe('best');
    expect(await response.json()).toMatchObject({ region: 'asia' });
    expect(regionsCalled()).toEqual(['asia']);
  });

  it('fails over to the next region when the best one errors', async () => {
    origins({ eu: 503 });

    const response = await userFrom('PRG', 'EU');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-served-region')).toBe('na');
    expect(response.headers.get('x-route-reason')).toBe('failover');
    expect(regionsCalled()).toEqual(['eu', 'na']);
  });

  it('skips a region that is marked down in KV', async () => {
    await env.STATE.put(downKey('na'), 'marked');
    origins({});

    const response = await userFrom('YUL', 'NA');

    expect(response.headers.get('x-served-region')).toBe('eu');
    expect(response.headers.get('x-route-reason')).toBe('best');
    expect(regionsCalled()).toEqual(['eu']);
  });

  it('does not retry a non-idempotent request', async () => {
    origins({ na: 'unreachable' });

    const response = await userFrom('YUL', 'NA', { method: 'POST' });

    expect(regionsCalled()).toEqual(['na']);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('opens the breaker after repeated failures and marks the region down', async () => {
    origins({ asia: 'unreachable' });

    await userFrom('NRT', 'AS');
    expect(await env.STATE.get(downKey('asia'))).toBeNull();

    await userFrom('NRT', 'AS');
    expect(await env.STATE.get(downKey('asia'))).not.toBeNull();

    const response = await userFrom('NRT', 'AS');
    expect(response.headers.get('x-served-region')).toBe('eu');
    expect(response.headers.get('x-route-reason')).toBe('best');
    expect(regionsCalled()).toEqual(['asia', 'eu', 'asia', 'eu', 'eu']);
  });
});
