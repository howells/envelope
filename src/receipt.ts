import { createHash } from "node:crypto";

import type { CliResultMeta, CliTool } from "./client.js";

/** Stable failure classes suitable for retries, manifests, and operator display. */
export type InvocationFailureKind =
  | "cancelled"
  | "input_validation"
  | "output_validation"
  | "provider"
  | "schema"
  | "spawn"
  | "timeout"
  | "transport"
  | "unknown";

/** Redacted account of one local CLI model invocation. */
export interface InvocationReceipt {
  attemptCount: number;
  cliVersion?: string;
  configDigest: string;
  costUsd?: number;
  durationMs: number;
  error?: {
    kind: InvocationFailureKind;
    message: string;
  };
  finishedAt: string;
  finishReason?: string | null;
  inputDigest: string;
  outputDigest?: string;
  profileId?: string;
  requestedModel: string;
  resolvedModel: string;
  schemaDigest: string;
  sessionId?: string;
  startedAt: string;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  tool: CliTool;
}

export interface ReceiptSeed {
  config: unknown;
  input: unknown;
  model: string;
  profileId?: string;
  schema: unknown;
  startedAt: Date;
  tool: CliTool;
}

const REDACTED_FAILURE_MESSAGES: Record<InvocationFailureKind, string> = {
  cancelled: "Invocation cancelled",
  input_validation: "Invocation input failed validation",
  output_validation: "Provider output failed validation",
  provider: "Provider invocation failed",
  schema: "Structured output or schema handling failed",
  spawn: "Provider CLI could not be started",
  timeout: "Provider invocation timed out",
  transport: "Provider transport failed",
  unknown: "Invocation failed",
};

/** Return a stable receipt message that cannot disclose prompt or subprocess content. */
export function redactedFailureMessage(kind: InvocationFailureKind): string {
  return REDACTED_FAILURE_MESSAGES[kind];
}

/** Hash a value without retaining prompt, schema, or result content in the receipt. */
export function digestValue(value: unknown): string {
  const serialized =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

/** Build the immutable success/failure receipt shared by high-level envelopes. */
export function buildInvocationReceipt(args: {
  error?: InvocationReceipt["error"];
  finishedAt: Date;
  meta?: CliResultMeta;
  output?: unknown;
  seed: ReceiptSeed;
}): InvocationReceipt {
  const { meta, seed } = args;
  return {
    attemptCount: meta?.attemptCount ?? 1,
    ...(meta?.cliVersion ? { cliVersion: meta.cliVersion } : {}),
    configDigest: digestValue(seed.config),
    ...(meta?.costUsd !== undefined ? { costUsd: meta.costUsd } : {}),
    durationMs: Math.max(
      0,
      args.finishedAt.getTime() - seed.startedAt.getTime(),
    ),
    ...(args.error ? { error: args.error } : {}),
    finishedAt: args.finishedAt.toISOString(),
    ...(meta?.stopReason !== undefined
      ? { finishReason: meta.stopReason }
      : {}),
    inputDigest: digestValue(seed.input),
    ...(args.output === undefined
      ? {}
      : { outputDigest: digestValue(args.output) }),
    ...(seed.profileId ? { profileId: seed.profileId } : {}),
    requestedModel: seed.model,
    resolvedModel: meta?.resolvedModel ?? seed.model,
    schemaDigest: digestValue(seed.schema),
    ...(meta?.sessionId ? { sessionId: meta.sessionId } : {}),
    startedAt: seed.startedAt.toISOString(),
    ...(meta?.tokenUsage ? { tokenUsage: meta.tokenUsage } : {}),
    tool: seed.tool,
  };
}

/** Classify transport failures without exposing subprocess stderr or prompt content. */
export function classifyInvocationFailure(
  error: unknown,
): NonNullable<InvocationReceipt["error"]> {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const kind: InvocationFailureKind =
    normalized.includes("abort") || normalized.includes("cancel")
      ? "cancelled"
      : normalized.includes("timedout") || normalized.includes("timeout")
        ? "timeout"
        : normalized.includes("spawn")
          ? "spawn"
          : normalized.includes("schema") || normalized.includes("json")
            ? "schema"
            : normalized.includes("transport") || normalized.includes("argv")
              ? "transport"
              : normalized.includes("cli") || normalized.includes("provider")
                ? "provider"
                : "unknown";
  return { kind, message: redactedFailureMessage(kind) };
}
