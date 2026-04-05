import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("implements specificationVersion v3", () => {
    const model = claudeCode("sonnet");
    expect(model.specificationVersion).toBe("v3");
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
    } as LanguageModelV3CallOptions);

    expect(text).toHaveBeenCalledWith({
      prompt: "system: be brief\nuser: say hello",
    });
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("returns V3 finish reason shape", async () => {
    text.mockResolvedValue({ text: "ok" });
    const model = claudeCode("sonnet");

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as LanguageModelV3CallOptions);

    expect(result.finishReason).toEqual({
      unified: "stop",
      raw: undefined,
    });
  });

  it("returns V3 nested usage shape", async () => {
    text.mockResolvedValue({ text: "ok" });
    const model = claudeCode("sonnet");

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as LanguageModelV3CallOptions);

    expect(result.usage).toEqual({
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
    });
  });

  it("surfaces cost as provider metadata", async () => {
    text.mockResolvedValue({
      text: "ok",
      meta: { costUsd: 0.02, sessionId: "sess-123" },
    });
    const model = claudeCode("sonnet");

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as LanguageModelV3CallOptions);

    expect(result.providerMetadata).toEqual({
      envelope: { costUsd: 0.02, sessionId: "sess-123" },
    });
  });

  it("omits provider metadata when no meta returned", async () => {
    text.mockResolvedValue({ text: "ok" });
    const model = claudeCode("sonnet");

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as LanguageModelV3CallOptions);

    expect(result.providerMetadata).toBeUndefined();
  });

  it("emits warnings for unsupported parameters", async () => {
    text.mockResolvedValue({ text: "ok" });
    const model = claudeCode("sonnet");

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      temperature: 0.5,
      topP: 0.9,
    } as LanguageModelV3CallOptions);

    const unsupported = result.warnings.filter((w) => w.type === "unsupported");
    expect(unsupported).toHaveLength(2);
    expect(unsupported.map((w) => w.feature)).toContain("temperature");
    expect(unsupported.map((w) => w.feature)).toContain("topP");
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
      } as LanguageModelV3CallOptions)
    ).rejects.toThrow("only supports text prompt parts");
  });

  it("can create a Gemini-backed adapter", async () => {
    text.mockResolvedValue({ text: "gemini hello" });
    const model = gemini("gemini-2.5-pro");

    const result = await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "say hello" }],
        },
      ],
    } as LanguageModelV3CallOptions);

    expect(text).toHaveBeenCalledWith({
      prompt: "user: say hello",
    });
    expect(result.content).toEqual([{ type: "text", text: "gemini hello" }]);
  });
});
