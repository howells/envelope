import type { z } from "zod";
import { toJSONSchema } from "zod/v4";
import type { JSONSchema7 } from "@ai-sdk/provider";
import {
  claudeCodeStructured,
  claudeCodeText,
  type ClaudeCodeOptions,
} from "./claude-code.js";
import { codexStructured, codexText, type CodexOptions } from "./codex-cli.js";
import {
  geminiStructured,
  geminiText,
  type GeminiOptions,
} from "./gemini-cli.js";

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
}

/**
 * Arguments for structured model calls.
 */
export interface GenerateStructuredArgs {
  /**
   * Prompt text to send to the model.
   */
  prompt: string;
  /**
   * JSON Schema describing the final response shape expected from the model.
   */
  jsonSchema: JSONSchema7;
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
   * Name of the backing CLI implementation.
   */
  tool: CliTool;
  /**
   * Model identifier configured for this client.
   */
  model: string;
  /**
   * Executes a plain-text completion request.
   */
  text(args: GenerateTextArgs): Promise<{ text: string }>;
  /**
   * Executes a structured generation request and returns already-parsed output.
   *
   * @typeParam T - Expected structured response shape.
   */
  structured<T>(args: GenerateStructuredArgs): Promise<{ structured: T }>;
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
  timeoutMs?: number;
  options?: Omit<ClaudeCodeOptions, "model" | "maxBudgetUsd" | "timeoutMs">;
}): CliClient {
  const cfg = args;
  const model = cfg?.model ?? "opus";
  const maxBudgetUsd = cfg?.maxBudgetUsd ?? 5;
  const timeoutMs = cfg?.timeoutMs ?? 120_000;

  return {
    tool: "claude-code",
    model,
    async text(input: GenerateTextArgs) {
      const res = await claudeCodeText({
        prompt: input.prompt,
        options: { ...cfg?.options, model, maxBudgetUsd, timeoutMs },
      });
      return { text: res.text };
    },
    async structured<T>(input: GenerateStructuredArgs) {
      const envelope = await claudeCodeStructured<T>({
        prompt: input.prompt,
        jsonSchema: JSON.stringify(input.jsonSchema),
        options: { ...cfg?.options, model, maxBudgetUsd, timeoutMs },
      });
      return { structured: envelope.structured_output as T };
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
  timeoutMs?: number;
  options?: Omit<CodexOptions, "model" | "timeoutMs">;
}): CliClient {
  const cfg = args;
  const model = cfg?.model ?? "gpt-5.3-codex";
  const timeoutMs = cfg?.timeoutMs ?? 180_000;

  return {
    tool: "codex",
    model,
    async text(input: GenerateTextArgs) {
      const res = await codexText({
        prompt: input.prompt,
        options: { ...cfg?.options, model, timeoutMs },
      });
      return { text: res.text };
    },
    async structured<T>(input: GenerateStructuredArgs) {
      const res = await codexStructured<T>({
        prompt: input.prompt,
        jsonSchema: JSON.stringify(input.jsonSchema),
        options: { ...cfg?.options, model, timeoutMs },
      });
      return { structured: res.structured };
    },
  };
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
  timeoutMs?: number;
  options?: Omit<GeminiOptions, "model" | "timeoutMs">;
}): CliClient {
  const cfg = args;
  const model = cfg?.model ?? "gemini-3-flash-preview";
  const timeoutMs = cfg?.timeoutMs ?? 180_000;

  return {
    tool: "gemini",
    model,
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
