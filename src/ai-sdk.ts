// AI SDK v2 adapter for CLI tools (Claude Code, Codex).
//
// Implements LanguageModelV2 from @ai-sdk/provider >=3, compatible with ai@6.
// Text-first; for JSON mode it maps responseFormat.schema to the CLI's
// structured-output mode.

import type {
  JSONSchema7,
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider";
import { createClaudeCodeClient, createCodexClient, type CliClient, type CliTool } from "./client.js";

function v2PromptToText(prompt: LanguageModelV2CallOptions["prompt"]): string {
  const parts: string[] = [];
  for (const m of prompt) {
    if (m.role === "system") {
      parts.push(`system: ${m.content}`);
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    const text = (m.content as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
    if (text) {
      parts.push(`${m.role}: ${text}`);
    }
  }
  return parts.join("\n");
}

function makeClient(tool: CliTool, model: string, opts?: any): CliClient {
  if (tool === "codex") {
    return createCodexClient({ model, ...(opts ?? {}) });
  }
  return createClaudeCodeClient({ model, ...(opts ?? {}) });
}

export function cliModel(args: {
  tool: CliTool;
  model: string;
  clientOptions?: any;
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
        const res = await client.structured<unknown>({ prompt: promptText, jsonSchema: schema });
        const text = JSON.stringify(res.structured ?? null);
        return {
          content: [{ type: "text" as const, text }],
          finishReason: "stop" as const,
          usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
          warnings: [],
        };
      }

      // Plain text mode (default)
      const res = await client.text({ prompt: promptText });
      return {
        content: [{ type: "text" as const, text: res.text }],
        finishReason: "stop" as const,
        usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
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
        start(controller) {
          controller.enqueue({
            type: "stream-start",
            warnings: result.warnings,
          });
          if (textContent) {
            controller.enqueue({ type: "text-start", id: textId });
            controller.enqueue({ type: "text-delta", id: textId, delta: textContent.text });
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

export function claudeCode(model: string, clientOptions?: any) {
  return cliModel({ tool: "claude-code", model, clientOptions });
}

export function codex(model: string, clientOptions?: any) {
  return cliModel({ tool: "codex", model, clientOptions });
}
