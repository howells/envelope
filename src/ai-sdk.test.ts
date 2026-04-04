import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";

const text = vi.fn();
const structured = vi.fn();

vi.mock("./client.js", () => ({
  createClaudeCodeClient: vi.fn(() => ({
    tool: "claude-code",
    model: "sonnet",
    text,
    structured,
  })),
  createCodexClient: vi.fn(() => ({
    tool: "codex",
    model: "gpt-5.3-codex",
    text,
    structured,
  })),
  createGeminiClient: vi.fn(() => ({
    tool: "gemini",
    model: "gemini-3-flash-preview",
    text,
    structured,
  })),
}));

import { claudeCode, gemini } from "./ai-sdk.js";

describe("ai-sdk adapter", () => {
  beforeEach(() => {
    text.mockReset();
    structured.mockReset();
  });

  it("passes through text prompts", async () => {
    text.mockResolvedValue({ text: "hello world" });
    const model = claudeCode("sonnet");

    const result = await model.doGenerate({
      prompt: [
        { role: "system", content: "be brief" },
        {
          role: "user",
          content: [{ type: "text", text: "say hello" }],
        },
      ],
    } as LanguageModelV2CallOptions);

    expect(text).toHaveBeenCalledWith({
      prompt: "system: be brief\nuser: say hello",
    });
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("rejects non-text prompt parts instead of silently dropping them", async () => {
    const model = claudeCode("sonnet");

    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "image", image: "ignored" }],
          },
        ],
      } as LanguageModelV2CallOptions)
    ).rejects.toThrow("only supports text prompt parts");
  });

  it("can create a Gemini-backed adapter", async () => {
    text.mockResolvedValue({ text: "gemini hello" });
    const model = gemini("gemini-2.5-pro");

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: "say hello" }],
    } as LanguageModelV2CallOptions);

    expect(text).toHaveBeenCalledWith({
      prompt: "user: say hello",
    });
    expect(result.content).toEqual([{ type: "text", text: "gemini hello" }]);
  });
});
