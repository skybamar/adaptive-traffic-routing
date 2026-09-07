# Adaptive Traffic Routing Service

A Cloudflare Worker that sits in front of three physical regions – Europe
(Gravelines), North America (Beauharnois) and Asia (Singapore) – and sends
each request to the region with the lowest expected latency, taking current
load and outages into account. `GET /time` returns the time of the server
that was picked.

## Requirements

Node 22.12 or newer (`.nvmrc` points to it). No Cloudflare account is needed:
`wrangler dev` runs the worker locally on the same runtime Cloudflare uses in
production.

```bash
nvm use
npm install
```

## Running locally

The physical servers are replaced by a small mock in `mock-origin/`. It is a
plain Node HTTP server, deliberately outside the Cloudflare tooling, so the
worker talks to it the same way it would talk to a real origin: over HTTP.

Two terminals:

```bash
npm run dev:origin      # mock origin on http://localhost:9000
npm run dev             # worker on http://localhost:8787
```

The mock serves `/time` and `/health` for any region; the region comes from
the `X-Region` header (or the first label of the hostname). `/health` requires
the probe token (`local-dev-token` by default, `PROBE_TOKEN` to override).
Failures can be simulated per request with a query parameter, optionally
limited to one region with a `region:` prefix. The worker forwards the query
string, so the same parameter works through it:

| Query | Effect |
|---|---|
| `?simulate=down` | responds 503 |
| `?simulate=slow` | responds after 3 s |
| `?simulate=busy` | `/health` reports load 0.95 |
| `?simulate=asia:down` | as above, but only when serving as `asia` |

### Scenarios

Locally there is no real geolocation, so the worker accepts `X-Debug-Colo`
and `X-Debug-Continent` headers while `DEBUG` is on. Every response carries
`x-served-region` and `x-route-reason` (`best` or `failover`).

```bash
# a user in Tokyo gets Singapore
curl -i -H 'X-Debug-Colo: NRT' -H 'X-Debug-Continent: AS' localhost:8787/time

# Singapore is down: the same request fails over within the request
curl -i -H 'X-Debug-Colo: NRT' -H 'X-Debug-Continent: AS' 'localhost:8787/time?simulate=asia:down'

# after the second failure the breaker opens and a down marker is written;
# from now on Singapore is not even tried
curl -i -H 'X-Debug-Colo: NRT' -H 'X-Debug-Continent: AS' 'localhost:8787/time?simulate=asia:down'
curl -i -H 'X-Debug-Colo: NRT' -H 'X-Debug-Continent: AS' localhost:8787/time
npx wrangler kv key get --binding STATE --local down:asia

# a POST is never retried
curl -i -X POST -H 'X-Debug-Continent: EU' 'localhost:8787/time?simulate=eu:slow'

# the cron probe (start the worker with --test-scheduled)
curl 'localhost:8787/__scheduled?cron=*+*+*+*+*'
npx wrangler kv key get --binding STATE --local regions
```

The local KV lives in `.wrangler/state` and survives restarts, like the real
one. Delete the directory for a clean start.

## Tests

```bash
npm test          # vitest inside the Workers runtime
npm run typecheck
```

Both run in CI (GitHub Actions) on every push to `main` and on every pull
request.

## How it works

```
user ──► router worker (every Cloudflare PoP)
           │  1. read regions, rtt:<colo>, down:* from KV
           │  2. rank regions, fetch the best one, retry once on the next
           │  3. after the response: update latency, write markers
           ▼
        origin (eu | na | asia)

cron (once a minute, one location) ──► /health of every region ──► KV regions
```

All shared state is in one KV namespace, split into three kinds of keys so
that no writer ever overwrites another writer's data:

| Key | Written by | Value |
|---|---|---|
| `regions` | the cron probe | `{ eu: { healthy, load }, … }` – reachability and origin-reported load |
| `rtt:<colo>` | routers in that PoP | `{ eu: ms, na: ms, asia: ms }` – moving average of measured latency to each region |
| `down:<region>` | a router whose breaker just opened | a timestamp; the key's existence is the signal, it expires after 3 minutes |

### Routing decision (`src/routing.ts`)

For every region that is healthy, not marked down and not behind an open
breaker:

```
score = latency to the region          measured for this PoP, static estimate per continent otherwise
      + load penalty                   0 up to 70 % load, then quadratic up to 400 ms
      - 20 ms                          if this is the region used last time
```

Lowest score wins, the rest is the fallback order. The load penalty moves
traffic away from a busy region before it starts failing; the bonus for the
previous region stops two similar regions from flapping.

### Failover (`src/index.ts`, `src/breaker.ts`)

The chosen region is called with a 2 s timeout. A timeout or a 5xx triggers
one retry on the next region, inside the same request – but only for `GET`,
`HEAD`, `OPTIONS` or requests with an `Idempotency-Key`, because a lost
response does not mean the origin did not process the request. Everything
else gets a 503 with `Retry-After`.

Two failures in a row open a per-isolate circuit breaker for 30 s: the
region is skipped without being tried. On that transition the worker writes
`down:<region>` to KV so other PoPs learn about it within their KV cache TTL
(60 s); the marker expires on its own, nobody has to "forgive" the region.

### State (`src/state.ts`, `src/probe.ts`, `src/latency.ts`)

- The cron probe calls `/health` of each region with a bearer token and
  writes `regions`. Load is normalised by the origin itself – it knows its
  own capacity, the edge does not.
- Each isolate keeps an exponentially weighted moving average (α = 0.2) of
  the latency it measured per region, seeded from `rtt:<colo>`, and writes
  it back at most every 10 s. Lost writes between isolates of the same PoP
  do not matter: the average converges.
- The router reads everything with a 60 s `cacheTtl`; when KV has nothing,
  a static table (continent → latency estimate) keeps routing sane.

### Why these choices

- **A worker instead of Cloudflare Load Balancing.** Load Balancing steers by
  health and geography; it does not know the load the origin reports about
  itself and cannot retry inside the user's request. With three origins the
  custom logic is small.
- **KV only, no Durable Object.** For each piece of state a lost write is
  harmless, so strong consistency would be paid for and never used. A DO
  would also add a round trip to its home location on every write.
- **Markers by existence, not by value.** A boolean would need someone with
  the authority to reset it; a TTL needs nobody.
- **Origins report their own load.** Capacity lives where it changes, with
  the hardware.

### What I would do next

- Require several failed probes before flipping `healthy`, and several good
  ones before flipping back.
- A manual `drain:<region>` marker without expiry for planned maintenance.
- Per-endpoint timeouts and retry policies; `/time` is the cheap case.
- Long-term latency history in Workers Analytics Engine, and a Durable
  Object if exact error rates over a window are ever needed.
- Cloudflare Tunnel in front of the origins and the probe token as a Worker
  secret instead of a config variable.

## Time spent

| Time | What |
|---|---|
| 0:40 | reading the assignment, design notes, plan |
| 0:15 | project bootstrap |
| 0:30 | region ranking with tests |
| 0:25 | mock origin, first README |
| 0:50 | KV state, circuit breaker, router with failover, tests |
| 0:30 | cron probe, latency tracking |
| 0:15 | CI, README |
| **3:25** | |
