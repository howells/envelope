// AI SDK adapter for CLI tools (Claude Code, Codex).
//
// This is intentionally minimal and text-first. For `object-json` mode, it
// maps the JSON schema to the tool's structured output mode.

import type {
  JSONSchema7,
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import { createClaudeCodeClient, createCodexClient, type CliClient, type CliTool } from "./client.js";

function v1PromptToText(prompt: LanguageModelV1CallOptions["prompt"]): string {
  const parts: string[] = [];
  for (const m of prompt) {
    const role = (m as any).role;
    const content = (m as any).content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter(
        (p: any) =>
          p && typeof p === "object" && p.type === "text" && typeof p.text === "string"
      )
      .map((p: any) => p.text)
      .join("");
    if (text) {
      parts.push(`${role}: ${text}`);
    }
  }
  return parts.join("\n");
}

function toSchema(schema: JSONSchema7 | undefined): JSONSchema7 | null {
  if (!schema) return null;
  return schema;
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
}): LanguageModelV1 {
  const client = makeClient(args.tool, args.model, args.clientOptions);

  return {
    specificationVersion: "v1",
    provider: args.tool,
    modelId: args.model,
    defaultObjectGenerationMode: "json",
    supportsStructuredOutputs: true,

    async doGenerate(callOptions: LanguageModelV1CallOptions) {
      const promptText = v1PromptToText(callOptions.prompt);
      const finishReason: LanguageModelV1FinishReason = "stop";

      if (callOptions.mode.type === "object-json") {
        const schema = toSchema(callOptions.mode.schema);
        if (!schema) {
          throw new Error("object-json mode requires a JSON schema");
        }
        const res = await client.structured<unknown>({ prompt: promptText, jsonSchema: schema });
        return {
          text: JSON.stringify(res.structured ?? null),
          finishReason,
          usage: { promptTokens: 0, completionTokens: 0 },
          rawCall: { rawPrompt: promptText, rawSettings: { mode: callOptions.mode } },
        };
      }

      const res = await client.text({ prompt: promptText });
      return {
        text: res.text,
        finishReason,
        usage: { promptTokens: 0, completionTokens: 0 },
        rawCall: { rawPrompt: promptText, rawSettings: { mode: callOptions.mode } },
      };
    },

    async doStream(callOptions: LanguageModelV1CallOptions) {
      const res = await this.doGenerate(callOptions);
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        start(controller) {
          if (res.text) {
            controller.enqueue({ type: "text-delta", textDelta: res.text });
          }
          controller.enqueue({
            type: "finish",
            finishReason: res.finishReason,
            usage: res.usage,
          });
          controller.close();
        },
      });

      return { stream, rawCall: res.rawCall, warnings: [] };
    },
  };
}

export function claudeCode(model: string, clientOptions?: any) {
  return cliModel({ tool: "claude-code", model, clientOptions });
}

export function codex(model: string, clientOptions?: any) {
  return cliModel({ tool: "codex", model, clientOptions });
}

