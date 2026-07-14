import { defineResource, output, value, } from "@henosis/core";
export const workerOutputs = {
    url: output.observed(value.url()),
    workerName: output.observed(value.string()),
    deploymentId: output.observed(value.string()),
    versionId: output.observed(value.string()),
};
export const worker = defineResource({
    kind: "cloudflare/worker@1",
    outputs: workerOutputs,
});
export const tunnelOutputs = {
    tunnelId: output.observed(value.string()),
    tunnelName: output.observed(value.string()),
    privateHostname: output.observed(value.string()),
    tokenRef: output.observed(value.string()),
};
export const tunnel = defineResource({
    kind: "cloudflare/tunnel@1",
    outputs: tunnelOutputs,
});
export const routeOutputs = {
    hostname: output.observed(value.string()),
};
export const route = defineResource({
    kind: "cloudflare/route@1",
    outputs: routeOutputs,
});
/** Emit a Worker while retaining its precise output-handle type. */
export function emitWorker(context, name, body) {
    return context.emit(worker.create(name, body));
}
//# sourceMappingURL=index.js.map