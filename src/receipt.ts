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
  | "usage_limit"
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
  usage_limit: "Provider usage limit reached",
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

/** Phrases the CLIs use when the account is out of quota rather than broken.
 *  Kept separate because a usage limit is not a transport fault: retrying costs
 *  time and cannot succeed, and the caller usually wants to route to another
 *  provider instead. Claude Code, Codex and Gemini each word it differently. */
const USAGE_LIMIT_PATTERNS = [
  "usage limit",
  "rate limit",
  "rate_limit",
  "quota",
  "too many requests",
  "429",
  "purchase more credits",
  "out of credits",
] as const;

/** True when a failure means "no capacity left on this account", not "broken". */
export function isUsageLimit(message: string): boolean {
  const normalized = message.toLowerCase();
  return USAGE_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern));
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
      : isUsageLimit(normalized)
        ? "usage_limit"
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
