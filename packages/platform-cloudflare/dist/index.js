import { defineResource, output, value, } from "@henosis/core";
const artifactSourceSymbol = Symbol.for("henosis.artifact-source.v1");
export const workerOutputs = {
    url: output.observed(value.url()),
    workerName: output.observed(value.string()),
    deploymentId: output.observed(value.string()),
    versionId: output.observed(value.string()),
};
const workerResource = defineResource({
    kind: "cloudflare/worker@1",
    outputs: workerOutputs,
});
export const worker = Object.freeze({
    kind: workerResource.kind,
    outputs: workerResource.outputs,
    configFiles: workerResource.configFiles,
    create(name, body) {
        return workerResource.create(name, {
            ...body,
            source: {
                entry: artifactSource("cloudflare-worker", body.source.entry),
                ...(body.source.assets === undefined
                    ? {}
                    : { assets: artifactSource("static-assets", body.source.assets) }),
            },
        });
    },
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
function artifactSource(kind, path) {
    if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
        throw new Error("Worker source paths must be normalized repository-relative paths");
    }
    return Object.freeze({
        [artifactSourceSymbol]: Object.freeze({ kind, path }),
    });
}
//# sourceMappingURL=index.js.map