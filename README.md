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
the `X-Region` header (or the first label of the hostname). Failures can be
simulated per request with a query parameter, optionally limited to one
region with a `region:` prefix. The worker forwards the query string, so the
same parameter works through it:

| Query | Effect |
|---|---|
| `?simulate=down` | responds 503 |
| `?simulate=slow` | responds after 3 s |
| `?simulate=busy` | `/health` reports load 0.95 |
| `?simulate=asia:down` | as above, but only when serving as `asia` |

```bash
curl -H 'X-Region: asia' localhost:9000/time
curl -H 'X-Region: asia' 'localhost:9000/time?simulate=asia:down'
curl 'localhost:9000/health?simulate=busy'
```

## Tests

```bash
npm test          # vitest inside the Workers runtime
npm run typecheck
```
