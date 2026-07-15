export default {
  fetch(): Response {
    return new Response("Henosis benchmark frontend", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
