// AI SDK v2 adapter for CLI tools (Claude Code, Codex, Gemini).
//
// Implements LanguageModelV2 from @ai-sdk/provider >=3, compatible with ai@6.
// Text-first; for JSON mode it maps responseFormat.schema to the CLI's
// structured-output mode.

import {
  ReadableStream,
  type ReadableStreamDefaultController,
} from "node:stream/web";
import type {
  JSONSchema7,
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider";
import {
  createClaudeCodeClient,
  createCodexClient,
  createGeminiClient,
  type CliClient,
  type CliTool,
} from "./client.js";

type ClaudeModelOptions = Parameters<typeof createClaudeCodeClient>[0];
type CodexModelOptions = Parameters<typeof createCodexClient>[0];
type GeminiModelOptions = Parameters<typeof createGeminiClient>[0];
type CliModelOptions =
  | ClaudeModelOptions
  | CodexModelOptions
  | GeminiModelOptions;
interface PromptTextPart {
  type: "text";
  text: string;
}

function isPromptTextPart(part: { type: string }): part is PromptTextPart {
  return (
    part.type === "text" &&
    "text" in part &&
    typeof (part as PromptTextPart).text === "string"
  );
}

/**
 * Extracts and concatenates text parts from an AI SDK content array.
 *
 * The adapter is intentionally text-first. Non-text prompt parts are rejected explicitly
 * so callers do not accidentally lose multimodal content without noticing.
 *
 * @param content - Prompt content parts supplied by the AI SDK.
 * @returns The concatenated text payload.
 * @throws {Error} Thrown when a non-text part is encountered.
 */
function extractText(content: ReadonlyArray<{ type: string }>): string {
  const parts: string[] = [];
  for (const part of content) {
    if (!isPromptTextPart(part)) {
      throw new Error(
        `Envelope CLI adapter only supports text prompt parts, received: ${part.type}`
      );
    }
    parts.push(part.text);
  }
  return parts.join("");
}

/**
 * Converts an AI SDK v2 prompt array into the single prompt string expected by the
 * package's CLI wrappers.
 *
 * Each message is prefixed with its role so some conversational structure is preserved
 * when flattening the prompt into a single text blob.
 *
 * @param prompt - AI SDK v2 prompt representation.
 * @returns Flattened prompt text suitable for the CLI clients.
 * @throws {Error} Thrown when unsupported content shapes are encountered.
 */
function v2PromptToText(prompt: LanguageModelV2CallOptions["prompt"]): string {
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

/**
 * Creates the package's internal {@link CliClient} for the requested CLI tool.
 *
 * @param tool - Backing CLI implementation to instantiate.
 * @param model - Model identifier to bind to the client.
 * @param opts - Additional client factory options.
 * @returns A configured client implementation for the selected tool.
 */
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
 * Creates an AI SDK `LanguageModelV2` implementation backed by one of the local CLI clients.
 *
 * This adapter exists so code using `ai@6` can route calls through local Claude Code,
 * Codex, or Gemini binaries instead of a network provider. The adapter is intentionally
 * text-first:
 * it flattens prompts into a single string and simulates streaming by emitting a single
 * final text chunk.
 *
 * @param args - Adapter configuration.
 * @param args.tool - Backing CLI implementation.
 * @param args.model - Model identifier passed through to the selected CLI.
 * @param args.clientOptions - Additional options forwarded to the selected client factory.
 * @returns A `LanguageModelV2` object suitable for `generateText()` and related AI SDK APIs.
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
}): LanguageModelV2 {
  const client = makeClient(args.tool, args.model, args.clientOptions);

  return {
    specificationVersion: "v2",
    provider: args.tool,
    modelId: args.model,
    supportedUrls: {},

    async doGenerate(callOptions: LanguageModelV2CallOptions) {
      const promptText = v2PromptToText(callOptions.prompt);

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
          finishReason: "stop" as const,
          usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
          },
          warnings: [],
        };
      }

      // Plain text mode (default)
      const res = await client.text({ prompt: promptText });
      return {
        content: [{ type: "text" as const, text: res.text }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        },
        warnings: [],
      };
    },

    async doStream(callOptions: LanguageModelV2CallOptions) {
      // CLI tools don't truly stream, so we fake it with a single chunk.
      const result = await this.doGenerate(callOptions);
      const textContent = result.content.find(
        (c): c is { type: "text"; text: string } => c.type === "text"
      );
      const textId = "t0";

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(
          controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
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
 *
 * @param model - Claude model alias or identifier.
 * @param clientOptions - Optional Claude client configuration forwarded to
 * {@link import("./client.js").createClaudeCodeClient}.
 * @returns AI SDK model wrapper backed by Claude Code.
 */
export function claudeCode(model: string, clientOptions?: ClaudeModelOptions) {
  return cliModel({ tool: "claude-code", model, clientOptions });
}

/**
 * Convenience factory for a Codex-backed AI SDK model.
 *
 * @param model - Codex model identifier.
 * @param clientOptions - Optional Codex client configuration forwarded to
 * {@link import("./client.js").createCodexClient}.
 * @returns AI SDK model wrapper backed by Codex.
 */
export function codex(model: string, clientOptions?: CodexModelOptions) {
  return cliModel({ tool: "codex", model, clientOptions });
}

/**
 * Convenience factory for a Gemini-backed AI SDK model.
 *
 * @param model - Gemini model identifier.
 * @param clientOptions - Optional Gemini client configuration forwarded to
 * {@link import("./client.js").createGeminiClient}.
 * @returns AI SDK model wrapper backed by Gemini.
 */
export function gemini(model: string, clientOptions?: GeminiModelOptions) {
  return cliModel({ tool: "gemini", model, clientOptions });
}
