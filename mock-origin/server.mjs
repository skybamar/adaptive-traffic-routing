import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 9000);
const PROBE_TOKEN = process.env.PROBE_TOKEN ?? 'local-dev-token';
const SLOW_RESPONSE_MS = 3000;

const IDLE_HEALTH = { load: 0.35, cpu: 0.35, connections: 120, queueDepth: 0 };
const BUSY_HEALTH = { load: 0.95, cpu: 0.95, connections: 2400, queueDepth: 40 };

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const region = request.headers['x-region'] ?? url.hostname.split('.')[0];
  const simulate = simulationFor(region, url.searchParams.get('simulate'));

  if (simulate === 'down') {
    return send(response, 503, 'Service unavailable');
  }
  if (simulate === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, SLOW_RESPONSE_MS));
  }

  switch (url.pathname) {
    case '/time':
      return sendJson(response, { region, serverTime: new Date().toISOString() });
    case '/health':
      if (request.headers.authorization !== `Bearer ${PROBE_TOKEN}`) return send(response, 401, 'Unauthorized');
      return sendJson(response, simulate === 'busy' ? BUSY_HEALTH : IDLE_HEALTH);
    default:
      return send(response, 404, 'Not found');
  }
}).listen(PORT, () => console.log(`mock origin listening on http://localhost:${PORT}`));

function simulationFor(region, param) {
  if (!param) return undefined;
  const [target, mode] = param.includes(':') ? param.split(':') : [region, param];
  return target === region ? mode : undefined;
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/plain' }).end(body);
}

function sendJson(response, body) {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
