import { execFile } from "node:child_process";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { z } from "zod";
import { toJSONSchema } from "zod/v4";
import {
  type ClaudeCodeOptions,
  claudeCodeStructured,
  claudeCodeText,
} from "./claude-code.js";
import { type CodexOptions, codexStructured, codexText } from "./codex-cli.js";
import {
  type GeminiOptions,
  geminiStructured,
  geminiText,
} from "./gemini-cli.js";

function extractClaudeMeta(envelope: {
  attempt_count?: number;
  model?: string;
  total_cost_usd?: number;
  session_id?: string;
  stop_reason?: string | null;
}): CliResultMeta {
  return {
    ...(envelope.attempt_count !== undefined && {
      attemptCount: envelope.attempt_count,
    }),
    ...(envelope.total_cost_usd !== undefined && {
      costUsd: envelope.total_cost_usd,
    }),
    ...(envelope.session_id !== undefined && {
      sessionId: envelope.session_id,
    }),
    ...(envelope.stop_reason !== undefined && {
      stopReason: envelope.stop_reason,
    }),
    ...(envelope.model !== undefined && {
      resolvedModel: envelope.model,
    }),
  };
}

function createVersionReader(args: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  file: string;
}): () => Promise<string | undefined> {
  let cached: Promise<string | undefined> | undefined;
  return () => {
    cached ??= new Promise((resolve) => {
      execFile(
        args.file,
        ["--version"],
        { cwd: args.cwd, env: args.env, timeout: 5_000 },
        (error, stdout, stderr) => {
          if (error) {
            resolve(undefined);
            return;
          }
          const version = `${stdout}${stderr}`.trim().split(/\r?\n/, 1)[0];
          resolve(version || undefined);
        },
      );
    });
    return cached;
  };
}

/**
 * Identifies the backing CLI used by a {@link CliClient}.
 */
export type CliTool = "claude-code" | "codex" | "gemini";

/**
 * Arguments for plain-text model calls.
 */
export interface GenerateTextArgs {
  /**
   * Prompt text to send to the model.
   */
  prompt: string;
  /** Cancels the subprocess and prevents further retry attempts. */
  signal?: AbortSignal;
}

/**
 * Arguments for structured model calls.
 */
export interface GenerateStructuredArgs {
  /**
   * JSON Schema describing the final response shape expected from the model.
   */
  jsonSchema: JSONSchema7;
  /**
   * Prompt text to send to the model.
   */
  prompt: string;
  /** Cancels the subprocess and prevents further retry attempts. */
  signal?: AbortSignal;
}

/**
 * Optional metadata returned alongside CLI responses.
 *
 * Not all CLI backends populate every field. Claude Code provides cost data;
 * Codex and Gemini currently return no metadata.
 */
export interface CliResultMeta {
  attemptCount?: number;
  cliVersion?: string;
  costUsd?: number;
  sessionId?: string;
  stopReason?: string | null;
  resolvedModel?: string;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
}

/**
 * Minimal client interface implemented by this package's Claude Code, Codex, and Gemini
 * adapters.
 *
 * Most users will obtain an instance via {@link createClaudeCodeClient},
 * {@link createCodexClient}, or {@link createGeminiClient}. The interface is exported so
 * callers can provide custom clients to {@link import("./envelope.js").createEnvelope}.
 */
export interface CliClient {
  /**
   * Model identifier configured for this client.
   */
  model: string;
  /** Identifier of the enforced execution profile, when one is active. */
  profileId?: string;
  /**
   * Executes a structured generation request and returns already-parsed output.
   *
   * @typeParam T - Expected structured response shape.
   */
  structured<T>(
    args: GenerateStructuredArgs,
  ): Promise<{ structured: T; meta?: CliResultMeta }>;
  /**
   * Executes a plain-text completion request.
   */
  text(args: GenerateTextArgs): Promise<{ text: string; meta?: CliResultMeta }>;
  /**
   * Name of the backing CLI implementation.
   */
  tool: CliTool;
  /** Reads the installed provider CLI version; failures resolve as undefined. */
  version?: () => Promise<string | undefined>;
}

/**
 * Converts a Zod schema into the JSON Schema shape expected by the wrapped CLIs.
 *
 * Zod v4 emits a top-level `$schema` property by default. Claude Code currently ignores
 * schemas that include that meta-schema URI, so this helper strips it before returning.
 *
 * @param schema - Zod schema to convert.
 * @returns A JSON Schema object compatible with the package's structured-output helpers.
 */
export function jsonSchemaFromZod(schema: z.ZodTypeAny): JSONSchema7 {
  // Strip $schema — claude CLI's --json-schema silently ignores schemas
  // that contain the JSON Schema meta-schema URI from Zod v4's toJSONSchema()
  const generated = toJSONSchema(schema);
  const { $schema: _ignored, ...schemaWithoutMeta } = generated as Record<
    string,
    unknown
  >;
  return schemaWithoutMeta as JSONSchema7;
}

/**
 * Creates a high-level client backed by the Claude Code CLI.
 *
 * The returned client normalizes plain-text and structured generation into the
 * package-level {@link CliClient} interface and injects the configured model, budget,
 * timeout, and Claude-specific options into each request.
 *
 * @param args - Optional client configuration.
 * @param args.model - Claude model alias or full model name. Defaults to `"opus"`.
 * @param args.maxBudgetUsd - Per-call budget cap passed to Claude Code. Defaults to `5`.
 * @param args.timeoutMs - Subprocess timeout in milliseconds. Defaults to `120_000`.
 * @param args.options - Additional Claude Code CLI options excluding the values controlled
 * by this factory.
 * @returns A reusable {@link CliClient} bound to Claude Code.
 *
 * @example
 * ```ts
 * const client = createClaudeCodeClient({
 *   model: "sonnet",
 *   maxBudgetUsd: 2,
 *   options: { systemPrompt: "Be concise." },
 * });
 * ```
 */
export function createClaudeCodeClient(args?: {
  model?: string;
  maxBudgetUsd?: number;
  profileId?: string;
  timeoutMs?: number;
  options?: Omit<ClaudeCodeOptions, "model" | "maxBudgetUsd" | "timeoutMs">;
}): CliClient {
  const cfg = args;
  const model = cfg?.model ?? "opus";
  const maxBudgetUsd = cfg?.maxBudgetUsd ?? 5;
  const timeoutMs = cfg?.timeoutMs ?? 120_000;
  const version = createVersionReader({
    cwd: cfg?.options?.cwd,
    env: cfg?.options?.env,
    file: cfg?.options?.claudePath ?? "claude",
  });

  return {
    tool: "claude-code",
    model,
    ...(cfg?.profileId ? { profileId: cfg.profileId } : {}),
    version,
    async text(input: GenerateTextArgs) {
      const [res, cliVersion] = await Promise.all([
        claudeCodeText({
          prompt: input.prompt,
          signal: input.signal,
          options: { ...cfg?.options, model, maxBudgetUsd, timeoutMs },
        }),
        version(),
      ]);
      return {
        text: res.text,
        meta: { ...extractClaudeMeta(res), cliVersion },
      };
    },
    async structured<T>(input: GenerateStructuredArgs) {
      const [envelope, cliVersion] = await Promise.all([
        claudeCodeStructured<T>({
          prompt: input.prompt,
          jsonSchema: JSON.stringify(input.jsonSchema),
          signal: input.signal,
          options: { ...cfg?.options, model, maxBudgetUsd, timeoutMs },
        }),
        version(),
      ]);
      return {
        structured: envelope.structured_output as T,
        meta: { ...extractClaudeMeta(envelope), cliVersion },
      };
    },
  };
}

/**
 * Creates a high-level client backed by the Codex CLI.
 *
 * The returned client exposes the same {@link CliClient} interface as the Claude-backed
 * client so application code can switch between tools without changing call sites.
 *
 * @param args - Optional client configuration.
 * @param args.model - Codex model identifier. Defaults to `"gpt-5.3-codex"`.
 * @param args.timeoutMs - Subprocess timeout in milliseconds. Defaults to `180_000`.
 * @param args.options - Additional Codex CLI options excluding the values controlled by
 * this factory.
 * @returns A reusable {@link CliClient} bound to Codex.
 *
 * @example
 * ```ts
 * const client = createCodexClient({
 *   model: "o3",
 *   options: { sandbox: "read-only" },
 * });
 * ```
 */
export function createCodexClient(args?: {
  model?: string;
  profileId?: string;
  timeoutMs?: number;
  options?: Omit<CodexOptions, "model" | "timeoutMs">;
}): CliClient {
  const cfg = args;
  const model = cfg?.model ?? "gpt-5.3-codex";
  const timeoutMs = cfg?.timeoutMs ?? 180_000;
  const version = createVersionReader({
    cwd: cfg?.options?.cwd,
    env: cfg?.options?.env,
    file: cfg?.options?.codexPath ?? "codex",
  });

  return {
    tool: "codex",
    model,
    ...(cfg?.profileId ? { profileId: cfg.profileId } : {}),
    version,
    async text(input: GenerateTextArgs) {
      const [res, cliVersion] = await Promise.all([
        codexText({
          prompt: input.prompt,
          signal: input.signal,
          options: { ...cfg?.options, model, timeoutMs },
        }),
        version(),
      ]);
      return { text: res.text, meta: { attemptCount: 1, cliVersion } };
    },
    async structured<T>(input: GenerateStructuredArgs) {
      const [res, cliVersion] = await Promise.all([
        codexStructured<T>({
          prompt: input.prompt,
          jsonSchema: JSON.stringify(input.jsonSchema),
          signal: input.signal,
          options: { ...cfg?.options, model, timeoutMs },
        }),
        version(),
      ]);
      return {
        structured: res.structured,
        meta: { attemptCount: 1, cliVersion },
      };
    },
  };
}

/** Tool-free, ephemeral Claude profile for processing untrusted evidence. */
export function createSafeClaudeCodeClient(args: {
  cwd: string;
  effort?: "low" | "medium" | "high";
  maxBudgetUsd?: number;
  model?: string;
  retries?: number;
  timeoutMs?: number;
}): CliClient {
  return createClaudeCodeClient({
    model: args.model,
    maxBudgetUsd: args.maxBudgetUsd,
    profileId: "claude-tool-free-ephemeral-v1",
    timeoutMs: args.timeoutMs,
    options: {
      cwd: args.cwd,
      effort: args.effort,
      permissionMode: "plan",
      retries: args.retries,
      sessionPersistence: false,
      tools: "",
    },
  });
}

/** Read-only, ephemeral Codex profile for processing untrusted evidence. */
export function createSafeCodexClient(args: {
  cwd: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  model?: string;
  timeoutMs?: number;
}): CliClient {
  return createCodexClient({
    model: args.model,
    profileId: "codex-read-only-ephemeral-v1",
    timeoutMs: args.timeoutMs,
    options: {
      cwd: args.cwd,
      effort: args.effort,
      ephemeral: true,
      sandbox: "read-only",
    },
  });
}

/** Read-only, ephemeral Gemini profile for processing untrusted evidence.
 *
 * The third safe profile, added so a caller whose first two providers are
 * exhausted still has somewhere safe to route. `plan` is Gemini's read-only
 * approval posture, the sandbox is requested explicitly rather than inherited,
 * and extensions are emptied so no tool surface is carried into a run that is
 * reading untrusted text. */
export function createSafeGeminiClient(args: {
  cwd: string;
  model?: string;
  timeoutMs?: number;
}): CliClient {
  return createGeminiClient({
    model: args.model,
    profileId: "gemini-read-only-ephemeral-v1",
    timeoutMs: args.timeoutMs,
    options: {
      approvalMode: "plan",
      cwd: args.cwd,
      extensions: [],
      sandbox: true,
    },
  });
}

/**
 * Creates a high-level client backed by the Gemini CLI.
 *
 * Gemini's CLI currently supports structured generation only via prompt-level JSON
 * instructions rather than a native schema flag. This factory still exposes the same
 * {@link CliClient} interface as the Claude and Codex clients, while documenting that the
 * Gemini backend relies on strict JSON parsing plus downstream schema validation.
 *
 * @param args - Optional client configuration.
 * @param args.model - Gemini model identifier. Defaults to `"gemini-3-flash-preview"`.
 * @param args.timeoutMs - Subprocess timeout in milliseconds. Defaults to `180_000`.
 * @param args.options - Additional Gemini CLI options excluding the values controlled by
 * this factory.
 * @returns A reusable {@link CliClient} bound to Gemini.
 *
 * @example
 * ```ts
 * const client = createGeminiClient({
 *   model: "gemini-2.5-pro",
 *   options: { approvalMode: "plan" },
 * });
 * ```
 */
export function createGeminiClient(args?: {
  model?: string;
  profileId?: string;
  timeoutMs?: number;
  options?: Omit<GeminiOptions, "model" | "timeoutMs">;
}): CliClient {
  const cfg = args;
  const model = cfg?.model ?? "gemini-3-flash-preview";
  const timeoutMs = cfg?.timeoutMs ?? 180_000;

  return {
    tool: "gemini",
    model,
    ...(cfg?.profileId ? { profileId: cfg.profileId } : {}),
    async text(input: GenerateTextArgs) {
      const res = await geminiText({
        prompt: input.prompt,
        options: { ...cfg?.options, model, timeoutMs },
      });
      return { text: res.text };
    },
    async structured<T>(input: GenerateStructuredArgs) {
      const res = await geminiStructured<T>({
        prompt: input.prompt,
        jsonSchema: JSON.stringify(input.jsonSchema),
        options: { ...cfg?.options, model, timeoutMs },
      });
      return { structured: res.structured };
    },
  };
}
