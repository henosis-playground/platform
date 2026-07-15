export default {
  async fetch(request: Request, env: { SUPABASE_REST_URL: string }): Promise<Response> {
    const url = new URL(request.url);
    return fetch(`${env.SUPABASE_REST_URL}${url.pathname}${url.search}`);
  },
};
