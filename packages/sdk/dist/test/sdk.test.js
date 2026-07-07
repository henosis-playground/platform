import { describe, expect, it } from "vitest";
import { defineComponent, executeBinding, executeBuild, httpUrl, isBindingValueLike, isComponentLike, materialiseBinding, materialiseToken, namespaceFor, postgresUrl, publicUrl, serviceHost, } from "../src/index.js";
describe("conventions", () => {
    it("derives namespace and addresses from component and environment", () => {
        expect(namespaceFor("pr-42")).toBe("henosis-pr-42");
        expect(serviceHost("service-a", "pr-42")).toBe("service-a.henosis-pr-42.svc.cluster.local");
        expect(httpUrl("service-a", "pr-42")).toBe("http://service-a.henosis-pr-42.svc.cluster.local:80");
        expect(publicUrl("service-b", "pr-42")).toBe("https://service-b-pr-42.henosis.example");
        expect(postgresUrl("service-b", "main", "pr-42")).toBe("postgres://henosis:henosis@service-b-main-postgres.henosis-pr-42.svc.cluster.local:5432/main");
    });
});
describe("binding tokens", () => {
    it("creates tokens with the requested convention and fills component names", () => {
        const component = defineComponent("service-a", {
            binding: (b) => ({
                api: b.httpUrl(),
                public: b.publicUrl(),
                nested: {
                    host: b.host(),
                },
            }),
            build: () => { },
        });
        const binding = executeBinding(component);
        expect(binding.api.convention).toBe("httpUrl");
        expect(binding.api.component).toBe("service-a");
        expect(binding.public.convention).toBe("publicUrl");
        expect(binding.public.component).toBe("service-a");
        expect(binding.nested.host.convention).toBe("host");
        expect(binding.nested.host.component).toBe("service-a");
    });
    it("materialises tokens through the convention functions", () => {
        const component = defineComponent("service-a", {
            binding: (b) => ({ api: b.httpUrl(), host: b.host() }),
            build: () => { },
        });
        const binding = executeBinding(component);
        expect(materialiseToken(binding.api, "preview-1")).toBe("http://service-a.henosis-preview-1.svc.cluster.local:80");
        expect(materialiseToken(binding.host, "preview-1")).toBe("service-a.henosis-preview-1.svc.cluster.local");
    });
    it("materialises a full binding shape into Resolved<T>", () => {
        const component = defineComponent("service-a", {
            binding: (b) => ({
                api: b.httpUrl(),
                nested: { host: b.host() },
                constant: "ready",
            }),
            build: () => { },
        });
        const binding = executeBinding(component);
        const resolved = materialiseBinding(binding, "dev");
        const typecheck = resolved;
        const api = resolved.api;
        void typecheck;
        void api;
        // @ts-expect-error resolved tokens are strings, not raw BindingValue tokens.
        const token = resolved.api;
        void token;
        expect(resolved).toEqual({
            api: "http://service-a.henosis-dev.svc.cluster.local:80",
            nested: { host: "service-a.henosis-dev.svc.cluster.local" },
            constant: "ready",
        });
    });
    it("exports cross-realm-safe duck-type guards", () => {
        expect(isBindingValueLike({ convention: "httpUrl", component: "service-a" })).toBe(true);
        expect(isComponentLike({
            name: "service-a",
            spec: { binding: () => ({}), build: () => { } },
        })).toBe(true);
    });
});
describe("build execution", () => {
    it("collects service and postgres records with materialised env values", () => {
        const dependency = defineComponent("service-a", {
            binding: (b) => ({ api: b.httpUrl() }),
            build: () => { },
        });
        const component = defineComponent("service-b", {
            binding: (b) => ({ app: b.publicUrl() }),
            build: (ctx) => {
                const a = ctx.use(dependency);
                const db = ctx.postgres("main", { previews: "clone" });
                const sharedDb = ctx.postgres("shared", { previews: "share-dev" });
                ctx.service({
                    image: ctx.image,
                    port: 3000,
                    env: {
                        DATABASE_URL: db.url,
                        SHARED_DATABASE_URL: sharedDb.url,
                        SERVICE_A_URL: a.api,
                        STATIC_VALUE: "enabled",
                    },
                });
            },
        });
        const resources = executeBuild(component, {
            env: { kind: "preview", id: "preview-1" },
            image: { ref: "service-b:preview-1", digest: "sha256:service-b" },
            envId: "preview-1",
            depResolver: (resolved) => materialiseBinding(executeBinding(resolved), "dev"),
        });
        expect(resources).toEqual([
            {
                kind: "postgres",
                component: "service-b",
                name: "main",
                previews: "clone",
                url: "postgres://henosis:henosis@service-b-main-postgres.henosis-preview-1.svc.cluster.local:5432/main",
                namespace: "henosis-preview-1",
            },
            {
                kind: "postgres",
                component: "service-b",
                name: "shared",
                previews: "share-dev",
                url: "postgres://henosis:henosis@service-b-shared-postgres.henosis-dev.svc.cluster.local:5432/shared",
                namespace: "henosis-dev",
            },
            {
                kind: "service",
                component: "service-b",
                image: { ref: "service-b:preview-1", digest: "sha256:service-b" },
                port: 3000,
                env: {
                    DATABASE_URL: "postgres://henosis:henosis@service-b-main-postgres.henosis-preview-1.svc.cluster.local:5432/main",
                    SHARED_DATABASE_URL: "postgres://henosis:henosis@service-b-shared-postgres.henosis-dev.svc.cluster.local:5432/shared",
                    SERVICE_A_URL: "http://service-a.henosis-dev.svc.cluster.local:80",
                    STATIC_VALUE: "enabled",
                },
                namespace: "henosis-preview-1",
            },
        ]);
    });
});
describe("component typing", () => {
    it("keeps dependency binding access compile-time checked", () => {
        const producer = defineComponent("producer", {
            binding: (b) => ({ api: b.httpUrl() }),
            build: () => { },
        });
        defineComponent("consumer", {
            binding: (b) => ({ app: b.publicUrl() }),
            build: (ctx) => {
                const binding = ctx.use(producer);
                const api = binding.api;
                void api;
                // @ts-expect-error dependency bindings are already resolved.
                const rawApi = binding.api;
                void rawApi;
                // @ts-expect-error missing is not part of producer's binding contract.
                void binding.missing;
            },
        });
    });
});
//# sourceMappingURL=sdk.test.js.map