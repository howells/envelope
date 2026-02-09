import { z } from "zod";
import { toJSONSchema } from "zod/v4";
import type { JSONSchema7 } from "@ai-sdk/provider";
import {
  claudeCodeStructured,
  claudeCodeText,
  type ClaudeCodeOptions,
} from "./claude-code.js";
import { codexStructured, codexText, type CodexOptions } from "./codex-cli.js";

export type CliTool = "claude-code" | "codex";

export interface GenerateTextArgs {
  prompt: string;
}

export interface GenerateStructuredArgs {
  prompt: string;
  jsonSchema: JSONSchema7;
}

export interface CliClient {
  tool: CliTool;
  model: string;
  text(args: GenerateTextArgs): Promise<{ text: string }>;
  structured<T>(args: GenerateStructuredArgs): Promise<{ structured: T }>;
}

export function jsonSchemaFromZod(schema: z.ZodTypeAny): JSONSchema7 {
  return toJSONSchema(schema) as unknown as JSONSchema7;
}

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
