interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  BACKEND_URL: string;
  BACKEND: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const backendUrl = `${env.BACKEND_URL}${url.pathname}${url.search}`;
    const backend = await env.BACKEND.fetch(backendUrl);
    const body = await backend.text();
    return new Response([
      "Henosis benchmark frontend",
      `backend=${env.BACKEND_URL}`,
      "--- fetched from backend ---",
      body,
    ].join("\n"), {
      status: backend.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
