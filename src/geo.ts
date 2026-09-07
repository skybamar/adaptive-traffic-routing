export interface Geolocation {
  colo: string;
  continent: string;
}

export function geolocation(request: Request, env: Env): Geolocation {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  const override = (name: string) => (env.DEBUG === 'true' ? request.headers.get(name) : null);
  return {
    colo: override('x-debug-colo') || cf?.colo || 'unknown',
    continent: override('x-debug-continent') || cf?.continent || 'unknown',
  };
}
