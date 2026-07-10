import type { ComponentDependencyGraph, ResolvedComponent } from "./assembler.js";
import { envName, type RuntimeEnv } from "@henosis/core";
import type {
  ExecutionComponent,
  ExecutionResult,
} from "./execute.js";
import type { PipelineFailure } from "@henosis/core";
import { formatOutputs } from "./render.js";
import type { SchemaData } from "./schema-data.js";

/** Existing strict Rust-bot failure object; its JSON fields are unchanged. */
export type GateFailure = {
  consumer: string;
  producer: string;
  pinnedSha: string | null;
  resolvedSha: string | null;
  outputsSchemaAtPinned: SchemaData | null;
  outputsSchemaAtResolved: SchemaData | null;
  consumedPaths: string[];
  kind: "compile" | "render" | "validate" | "resolve";
  message: string;
  excerpt: string;
};

/** Existing strict Rust-bot report object; do not add fields. */
export type GateReport = {
  ok: boolean;
  failures: GateFailure[];
};

/** Extracts D20-compatible component failures from TypeScript diagnostics. */
export function parseCompileFailures(
  compileOutput: string,
  graph: ComponentDependencyGraph,
): GateFailure[] {
  const lines = compileOutput.split(/\r?\n/);
  const failures: GateFailure[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fieldMatch = /Property '([^']+)' does not exist on type/.exec(line);
    if (fieldMatch === null) {
      continue;
    }

    const field = fieldMatch[1] ?? "unknown";
    const filePath = parseErrorFilePath(line);
    const component = filePath === undefined ? undefined : componentFromPath(filePath);
    const consumer = component ?? firstConsumerWithDependency(graph) ?? "unknown";
    const producer = firstProducerForConsumer(graph, consumer) ?? "unknown";
    const message = `${consumer} consumes ${producer}.${field} which no longer exists`;
    failures.push(contractFailure({
      consumer,
      producer,
      kind: "compile",
      message,
      excerpt: excerptFrom(lines, index),
      consumedPaths: [field],
    }));
  }

  if (failures.length > 0) {
    return failures;
  }

  return [
    contractFailure({
      consumer: "workspace",
      producer: "unknown",
      kind: "compile",
      message: "TypeScript compile failed",
      excerpt: compileOutput.trim(),
      consumedPaths: [],
    }),
  ];
}

/** Converts one core failure to the first bot-compatible failure. */
export function pipelineFailure(failure: PipelineFailure): GateFailure {
  return pipelineFailures(failure)[0] ?? renderFailure(failure.message);
}

/** Converts all structured issues in a core failure without dropping evidence. */
export function pipelineFailures(
  failure: PipelineFailure,
  environment?: RuntimeEnv,
): GateFailure[] {
  const environmentName = environment === undefined ? undefined : envName(environment);
  if (failure.issues !== undefined && failure.issues.length > 0) {
    return failure.issues.map((issue) =>
      contractFailure({
        consumer: issue.component,
        producer: "unknown",
        kind: "validate",
        message: prefixEnvironment(issue.message, environmentName),
        excerpt: JSON.stringify(issue),
        consumedPaths:
          issue.record === undefined ? [] : [issue.record.path],
      }),
    );
  }
  const kind = failureKind(failure.stage);
  const component = failure.component ?? "world";
  const resolution = resolutionDetails(failure.message);
  const outputPath = outputValidationPath(component, failure.message);
  return [contractFailure({
    consumer: component,
    producer: resolution?.producer ?? (kind === "validate" ? component : "unknown"),
    kind,
    message: prefixEnvironment(failure.message, environmentName),
    excerpt: prefixEnvironment(failure.message, environmentName),
    consumedPaths:
      resolution?.path === undefined
        ? outputPath === undefined
          ? []
          : [outputPath]
        : [resolution.path],
  })];
}

/** Creates a renderer-scoped bot-compatible failure. */
export function renderFailure(message: string, excerpt = message): GateFailure {
  return contractFailure({
    consumer: "renderer",
    producer: "unknown",
    kind: "render",
    message,
    excerpt,
    consumedPaths: [],
  });
}

/** Formats the retained single-environment human report helper. */
export function formatGateText(opts: {
  ok: boolean;
  environment: RuntimeEnv;
  components: readonly ResolvedComponent[];
  execution?: ExecutionResult;
  failures: readonly GateFailure[];
  compileOutput?: string;
}): string {
  const lines = [
    `Henosis gate: ${opts.ok ? "PASS" : "FAIL"}`,
    `Environment: ${envName(opts.environment)}`,
    "Components:",
    ...opts.components.map(formatComponentSummary),
  ];

  if (!opts.ok) {
    for (const failure of opts.failures) {
      lines.push("", `Contract violation: ${failure.message}`);
    }

    if (opts.compileOutput !== undefined && opts.compileOutput.trim().length > 0) {
      lines.push("", "TypeScript errors:");
      lines.push(
        ...opts.compileOutput
          .trim()
          .split(/\r?\n/)
          .map((line) => `  ${line}`),
      );
    } else {
      lines.push(
        ...opts.failures.flatMap((failure) => [
          "",
          `${failure.kind} error:`,
          ...failure.excerpt.split(/\r?\n/).map((line) => `  ${line}`),
        ]),
      );
    }

    return `${lines.join("\n")}\n`;
  }

  lines.push("", "Resolved outputs:");
  if (opts.execution === undefined) {
    lines.push("  no resolved outputs available");
  } else {
    lines.push(...formatExecutionSummary(opts.execution));
  }

  return `${lines.join("\n")}\n`;
}

function contractFailure(opts: {
  consumer: string;
  producer: string;
  kind: GateFailure["kind"];
  message: string;
  excerpt: string;
  consumedPaths: string[];
}): GateFailure {
  return {
    consumer: opts.consumer,
    producer: opts.producer,
    pinnedSha: null,
    resolvedSha: null,
    outputsSchemaAtPinned: null,
    outputsSchemaAtResolved: null,
    consumedPaths: opts.consumedPaths,
    kind: opts.kind,
    message: opts.message,
    excerpt: opts.excerpt,
  };
}

function formatComponentSummary(component: ResolvedComponent): string {
  const sha = component.ref.slice(0, 7);
  const disposition =
    component.entry.kind === "pinned"
      ? "[PINNED]"
      : `[FOLLOW ${component.entry.follow}]`;
  return `  ${component.name}  ${disposition} sha:${sha}`;
}

function formatExecutionSummary(execution: ExecutionResult): string[] {
  return Object.entries(execution.components).flatMap(([name, component]) => {
    return [
      `  ${name}: ${formatDisposition(component)} ${component.digest}`,
      ...formatComponentOutputs(component).map((line) => `    ${line}`),
      "",
    ];
  });
}

function formatDisposition(component: ExecutionComponent): string {
  if (component.disposition.kind === "borrowed") {
    return `borrowed from ${component.disposition.from}`;
  }
  return component.source.kind === "follower"
    ? `materialized from ${component.source.follow} pin`
    : "materialized pinned";
}

function failureKind(stage: PipelineFailure["stage"]): GateFailure["kind"] {
  if (stage === "resolution") return "resolve";
  if (
    stage === "pending-output-validation" ||
    stage === "resolved-output-validation" ||
    stage === "validator" ||
    stage === "world-validation"
  ) {
    return "validate";
  }
  return "render";
}

function prefixEnvironment(message: string, environment: string | undefined): string {
  return environment === undefined ? message : `[${environment}] ${message}`;
}

function resolutionDetails(
  message: string,
): { producer: string; path: string } | undefined {
  const match = / consumes missing ([a-z0-9-]+)\.([A-Za-z0-9_$.]+)/.exec(message);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { producer: match[1], path: match[2] };
}

function outputValidationPath(
  component: string,
  message: string,
): string | undefined {
  const match = new RegExp(`^${escapeRegExp(component)}\\.([^ ]+) expected `).exec(
    message,
  );
  return match?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatComponentOutputs(component: ExecutionComponent): string[] {
  return formatOutputs(component.outputs);
}

function parseErrorFilePath(line: string): string | undefined {
  const parenMatch = /^(.+?)\(\d+,\d+\): error TS\d+:/.exec(line);
  if (parenMatch !== null) {
    return parenMatch[1];
  }

  const colonMatch = /^(.+?):\d+:\d+ - error TS\d+:/.exec(line);
  if (colonMatch !== null) {
    return colonMatch[1];
  }

  return undefined;
}

function componentFromPath(filePath: string): string | undefined {
  const normalized = filePath.replaceAll("\\", "/");
  const nodeModulesMatch =
    /\/node_modules\/(?:\.pnpm\/.+?\/node_modules\/)?@henosis\/([^/]+)\/src\//.exec(
      normalized,
    );
  if (nodeModulesMatch !== null) {
    return nodeModulesMatch[1];
  }

  const packageMatch = /\/@henosis\/([^/]+)\/src\//.exec(normalized);
  return packageMatch?.[1];
}

function firstConsumerWithDependency(
  graph: ComponentDependencyGraph,
): string | undefined {
  return Object.entries(graph).find(([, dependencies]) => dependencies.length > 0)?.[0];
}

function firstProducerForConsumer(
  graph: ComponentDependencyGraph,
  consumer: string,
): string | undefined {
  return graph[consumer]?.[0];
}

function excerptFrom(lines: readonly string[], index: number): string {
  return lines.slice(index, Math.min(index + 5, lines.length)).join("\n").trim();
}
