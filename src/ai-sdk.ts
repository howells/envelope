// AI SDK v3 adapter for CLI tools (Claude Code, Codex, Gemini).
//
// Implements LanguageModelV3 from @ai-sdk/provider >=3, compatible with ai@6.
// Text-first; for JSON mode it maps responseFormat.schema to the CLI's
// structured-output mode.

import {
  ReadableStream,
  type ReadableStreamDefaultController,
} from "node:stream/web";
import type {
  JSONObject,
  JSONSchema7,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  type CliClient,
  type CliResultMeta,
  type CliTool,
  createClaudeCodeClient,
  createCodexClient,
  createGeminiClient,
} from "./client.js";

type ClaudeModelOptions = Parameters<typeof createClaudeCodeClient>[0];
type CodexModelOptions = Parameters<typeof createCodexClient>[0];
type GeminiModelOptions = Parameters<typeof createGeminiClient>[0];
type CliModelOptions =
  | ClaudeModelOptions
  | CodexModelOptions
  | GeminiModelOptions;

const UNSUPPORTED_PARAMS = [
  "temperature",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "stopSequences",
  "seed",
] as const;

/**
 * Collects warnings for AI SDK parameters that CLI tools silently ignore.
 */
function collectWarnings(
  options: LanguageModelV3CallOptions
): SharedV3Warning[] {
  const warnings: SharedV3Warning[] = [];
  for (const param of UNSUPPORTED_PARAMS) {
    const value = options[param as keyof LanguageModelV3CallOptions];
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    warnings.push({
      type: "unsupported",
      feature: param,
      details: `CLI tools do not support ${param}. It will be ignored.`,
    });
  }

  if (
    options.responseFormat?.type === "json" &&
    !options.responseFormat.schema
  ) {
    warnings.push({
      type: "unsupported",
      feature: "responseFormat",
      details:
        "JSON response format requires a schema for CLI providers. The request will be treated as plain text.",
    });
  }

  return warnings;
}

function emptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
}

function metaToProviderMetadata(
  meta: CliResultMeta | undefined
): SharedV3ProviderMetadata | undefined {
  if (!(meta?.costUsd || meta?.sessionId)) {
    return undefined;
  }
  return {
    envelope: {
      ...(meta.costUsd !== undefined && { costUsd: meta.costUsd }),
      ...(meta.sessionId !== undefined && { sessionId: meta.sessionId }),
    } as JSONObject,
  };
}

const STOP_FINISH: LanguageModelV3FinishReason = {
  unified: "stop",
  raw: undefined,
};

/**
 * Extracts and concatenates text parts from a V3 prompt content array.
 *
 * The adapter is intentionally text-first. Non-text prompt parts are rejected
 * so callers do not accidentally lose multimodal content without noticing.
 */
function extractText(content: ReadonlyArray<{ type: string }>): string {
  const parts: string[] = [];
  for (const part of content) {
    if (part.type !== "text" || !("text" in part)) {
      throw new Error(
        `Envelope CLI adapter only supports text prompt parts, received: ${part.type}`
      );
    }
    parts.push((part as { type: "text"; text: string }).text);
  }
  return parts.join("");
}

/**
 * Converts a V3 prompt array into the single prompt string expected by CLI wrappers.
 *
 * Each message is prefixed with its role so conversational structure is preserved
 * when flattening into a single text blob.
 */
function promptToText(prompt: LanguageModelV3CallOptions["prompt"]): string {
  const parts: string[] = [];
  for (const m of prompt) {
    if (m.role === "system") {
      parts.push(`system: ${m.content}`);
      continue;
    }
    if (typeof m.content === "string") {
      parts.push(`${m.role}: ${m.content}`);
      continue;
    }
    if (!Array.isArray(m.content)) {
      throw new Error(`Unsupported prompt content for role: ${m.role}`);
    }
    const text = extractText(m.content);
    if (text) {
      parts.push(`${m.role}: ${text}`);
    }
  }
  return parts.join("\n");
}

function makeClient(
  tool: CliTool,
  model: string,
  opts?: CliModelOptions
): CliClient {
  if (tool === "codex") {
    return createCodexClient({
      ...(opts as CodexModelOptions | undefined),
      model,
    });
  }
  if (tool === "gemini") {
    return createGeminiClient({
      ...(opts as GeminiModelOptions | undefined),
      model,
    });
  }
  return createClaudeCodeClient({
    ...(opts as ClaudeModelOptions | undefined),
    model,
  });
}

/**
 * Creates an AI SDK `LanguageModelV3` implementation backed by one of the local CLI clients.
 *
 * This adapter exists so code using `ai@6` can route calls through local Claude Code,
 * Codex, or Gemini binaries instead of a network provider. The adapter is intentionally
 * text-first: it flattens prompts into a single string and simulates streaming by
 * emitting a single final text chunk.
 *
 * @example
 * ```ts
 * import { generateText } from "ai";
 * import { cliModel } from "@howells/envelope/ai-sdk";
 *
 * const model = cliModel({ tool: "codex", model: "gpt-5.3-codex" });
 * const result = await generateText({ model, prompt: "Write a haiku." });
 * ```
 */
export function cliModel(args: {
  tool: CliTool;
  model: string;
  clientOptions?: CliModelOptions;
}): LanguageModelV3 {
  const client = makeClient(args.tool, args.model, args.clientOptions);

  return {
    specificationVersion: "v3",
    provider: args.tool,
    modelId: args.model,
    supportedUrls: {},

    async doGenerate(
      callOptions: LanguageModelV3CallOptions
    ): Promise<LanguageModelV3GenerateResult> {
      const promptText = promptToText(callOptions.prompt);
      const warnings = collectWarnings(callOptions);

      // Structured JSON output mode
      if (
        callOptions.responseFormat?.type === "json" &&
        callOptions.responseFormat.schema
      ) {
        const schema = callOptions.responseFormat.schema as JSONSchema7;
        const res = await client.structured<unknown>({
          prompt: promptText,
          jsonSchema: schema,
        });
        const text = JSON.stringify(res.structured ?? null);
        return {
          content: [{ type: "text" as const, text }],
          finishReason: STOP_FINISH,
          usage: emptyUsage(),
          providerMetadata: metaToProviderMetadata(res.meta),
          warnings,
        };
      }

      // Plain text mode (default)
      const res = await client.text({ prompt: promptText });
      return {
        content: [{ type: "text" as const, text: res.text }],
        finishReason: STOP_FINISH,
        usage: emptyUsage(),
        providerMetadata: metaToProviderMetadata(res.meta),
        warnings,
      };
    },

    async doStream(callOptions: LanguageModelV3CallOptions) {
      // CLI tools don't truly stream, so we simulate with a single chunk.
      const result = await this.doGenerate(callOptions);
      const textContent = result.content.find(
        (c): c is { type: "text"; text: string } => c.type === "text"
      );
      const textId = "t0";

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(
          controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>
        ) {
          controller.enqueue({
            type: "stream-start",
            warnings: result.warnings,
          });
          if (textContent) {
            controller.enqueue({ type: "text-start", id: textId });
            controller.enqueue({
              type: "text-delta",
              id: textId,
              delta: textContent.text,
            });
            controller.enqueue({ type: "text-end", id: textId });
          }
          controller.enqueue({
            type: "finish",
            finishReason: result.finishReason,
            usage: result.usage,
            providerMetadata: result.providerMetadata,
          });
          controller.close();
        },
      });

      return { stream };
    },
  };
}

/**
 * Convenience factory for a Claude Code-backed AI SDK model.
 */
export function claudeCode(model: string, clientOptions?: ClaudeModelOptions) {
  return cliModel({ tool: "claude-code", model, clientOptions });
}

/**
 * Convenience factory for a Codex-backed AI SDK model.
 */
export function codex(model: string, clientOptions?: CodexModelOptions) {
  return cliModel({ tool: "codex", model, clientOptions });
}

/**
 * Convenience factory for a Gemini-backed AI SDK model.
 */
export function gemini(model: string, clientOptions?: GeminiModelOptions) {
  return cliModel({ tool: "gemini", model, clientOptions });
}
