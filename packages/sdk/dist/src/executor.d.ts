import { type BindingShape, type BindingValue, type Component, type DependencyResolver, type Env, type EnvId, type ImageRef, type ResourceRecord, type Resolved } from "./types.js";
export declare function executeBinding<B extends BindingShape>(component: Component<B>): B;
export declare function executeBuild<B extends BindingShape>(component: Component<B>, opts: {
    env: Env;
    image: ImageRef;
    depResolver: DependencyResolver;
    envId: EnvId;
}): ResourceRecord[];
export declare function materialiseToken(token: BindingValue, envId: EnvId): string;
export declare function materialiseBinding<B extends BindingShape>(binding: B, envId: EnvId): Resolved<B>;
//# sourceMappingURL=executor.d.ts.map