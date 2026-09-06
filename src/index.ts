export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/healthz') {
      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler;
