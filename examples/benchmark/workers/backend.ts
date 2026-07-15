interface Env {
  SUPABASE_REST_URL: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    const url = new URL(request.url);
    return new Response([
      "Henosis benchmark backend",
      `path=${url.pathname}`,
      `database=${env.SUPABASE_REST_URL}`,
    ].join("\n"), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
