import {
  httpUrl,
  namespaceFor,
  postgresUrl,
  publicUrl,
  serviceHost,
} from "./conventions.js";
import {
  createBindingValue,
  isBindingValueLike,
  type BindingBuilder,
  type BindingShape,
  type BindingValue,
  type BuildContext,
  type Component,
  type DependencyResolver,
  type Env,
  type EnvId,
  type ImageRef,
  type ResourceRecord,
  type Resolved,
} from "./types.js";

const bindingBuilder: BindingBuilder = {
  httpUrl: () => createBindingValue("httpUrl"),
  publicUrl: () => createBindingValue("publicUrl"),
  host: () => createBindingValue("host"),
};

export function executeBinding<B extends BindingShape>(
  component: Component<B>,
): B {
  const binding = component.spec.binding(bindingBuilder);
  fillTokenComponents(binding, component.name);
  return binding;
}

export function executeBuild<B extends BindingShape>(
  component: Component<B>,
  opts: {
    env: Env;
    image: ImageRef;
    depResolver: DependencyResolver;
    envId: EnvId;
  },
): ResourceRecord[] {
  const records: ResourceRecord[] = [];
  const namespace = namespaceFor(opts.envId);

  const ctx: BuildContext = {
    env: opts.env,
    image: opts.image,
    use: opts.depResolver,
    service: (serviceOpts) => {
      records.push({
        kind: "service",
        component: component.name,
        image: serviceOpts.image,
        port: serviceOpts.port,
        env: materialiseEnv(serviceOpts.env, opts.envId, component.name),
        namespace,
      });
    },
    postgres: (name, postgresOpts) => {
      const postgresEnvId = postgresAddressEnvId(
        opts.env,
        opts.envId,
        postgresOpts.previews,
      );
      const url = postgresUrl(component.name, name, postgresEnvId);

      records.push({
        kind: "postgres",
        component: component.name,
        name,
        previews: postgresOpts.previews,
        url,
        namespace: namespaceFor(postgresEnvId),
      });

      return { url };
    },
  };

  const self = executeBinding(component);
  component.spec.build(ctx, self);
  return records;
}

export function materialiseToken(token: BindingValue, envId: EnvId): string {
  const component = token.component;
  if (component === undefined) {
    throw new Error(
      `Cannot materialise ${token.convention} binding token without a component`,
    );
  }

  switch (token.convention) {
    case "httpUrl":
      return httpUrl(component, envId);
    case "publicUrl":
      return publicUrl(component, envId);
    case "host":
      return serviceHost(component, envId);
  }
}

export function materialiseBinding<B extends BindingShape>(
  binding: B,
  envId: EnvId,
): Resolved<B> {
  return materialiseShape(binding, envId) as Resolved<B>;
}

function fillTokenComponents(shape: BindingShape, component: string): void {
  if (isBindingValueLike(shape)) {
    shape.component = component;
    return;
  }

  if (typeof shape !== "object" || shape === null) {
    return;
  }

  for (const value of Object.values(shape)) {
    fillTokenComponents(value, component);
  }
}

function materialiseEnv(
  env: Record<string, string | BindingValue> | undefined,
  envId: EnvId,
  component: string,
): Record<string, string> {
  const materialised: Record<string, string> = {};

  for (const [key, value] of Object.entries(env ?? {})) {
    if (isBindingValueLike(value)) {
      if (value.component !== component) {
        throw new Error(
          `Cannot materialise ${value.component ?? "unowned"} binding token in ${component}'s service environment`,
        );
      }

      materialised[key] = materialiseToken(value, envId);
    } else {
      materialised[key] = value;
    }
  }

  return materialised;
}

type MaterialisedBindingShape =
  | string
  | number
  | boolean
  | { [key: string]: MaterialisedBindingShape };

function materialiseShape(
  shape: BindingShape,
  envId: EnvId,
): MaterialisedBindingShape {
  if (isBindingValueLike(shape)) {
    return materialiseToken(shape, envId);
  }

  if (
    typeof shape === "string" ||
    typeof shape === "number" ||
    typeof shape === "boolean"
  ) {
    return shape;
  }

  if (!isRecord(shape)) {
    throw new Error("Unsupported binding shape");
  }

  return Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [
      key,
      materialiseShape(value, envId),
    ]),
  );
}

function postgresAddressEnvId(
  env: Env,
  envId: EnvId,
  previews: "clone" | "share-dev",
): EnvId {
  if (env.kind === "preview" && previews === "share-dev") {
    return "dev";
  }

  return envId;
}

function isRecord(value: unknown): value is Record<string, BindingShape> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
