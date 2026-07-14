import { defineComponent, output, value } from "@henosis/core";
import { tunnel } from "@henosis/platform-cloudflare";

export default defineComponent({
  name: "supabase_tunnel",
  outputs: {
    hostname: output.observed(value.string()),
  },
  build(context) {
    const emitted = context.emit(tunnel.create("supabase", {
      origin: { host: "supabase-kong", port: 8000 },
    }));
    return { hostname: emitted.outputs.privateHostname };
  },
});
