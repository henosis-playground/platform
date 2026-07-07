import {
  httpUrl,
  namespaceFor,
  publicUrl,
  serviceHost,
} from "./conventions.js";
import {
  createBindingValue,
  isBindingValue,
  type BindingBuilder,
  type BindingShape,
  type BindingValue,
  type BuildContext,
  type Component,
  type DependencyResolver,
  type Env,
  type ImageRef,
  type ResourceRecord,
} from "./types.js";

const bindingBuilder: BindingBuilder = {
  httpUrl: () => createBindingValue("httpUrl"),
  publicUrl: () => createBindingValue("publicUrl"),
  host: () => createBindingValue("host"),
};

export function executeBinding<B extends BindingShape>(
  component: Component<B>,
  envId: string,
): B {
  const binding = component.spec.binding(bindingBuilder);
  fillTokenComponents(binding, component.name);
  void envId;
  return binding;
}

export function executeBuild<B extends BindingShape>(
  component: Component<B>,
  opts: {
    env: Env;
    image: ImageRef;
    depResolver: DependencyResolver;
    envId: string;
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
        env: materialiseEnv(serviceOpts.env, opts.envId),
        namespace,
      });
    },
    postgres: (name, postgresOpts) => {
      const url = createBindingValue(
        "host",
        postgresAddressComponent(component.name, name),
      );

      records.push({
        kind: "postgres",
        component: component.name,
        name,
        previews: postgresOpts.previews,
        url: materialiseToken(url, opts.envId),
        namespace,
      });

      return { url };
    },
  };

  const self = executeBinding(component, opts.envId);
  component.spec.build(ctx, self);
  return records;
}

export function materialiseToken(token: BindingValue, envId: string): string {
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

function fillTokenComponents(shape: BindingShape, component: string): void {
  if (isBindingValue(shape)) {
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
  envId: string,
): Record<string, string> {
  const materialised: Record<string, string> = {};

  for (const [key, value] of Object.entries(env ?? {})) {
    materialised[key] = isBindingValue(value)
      ? materialiseToken(value, envId)
      : value;
  }

  return materialised;
}

function postgresAddressComponent(component: string, name: string): string {
  return `${component}-${name}-postgres`;
}
