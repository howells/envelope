import { describe, expect, it } from "vitest";

import {
  createOpenRouterClient,
  createSafeOpenRouterClient,
  stripMarkdownFence,
} from "./openrouter.js";

describe("createOpenRouterClient", () => {
  it("refuses to construct without a key rather than reading the environment", () => {
    expect(() =>
      createOpenRouterClient({ apiKey: "", model: "z-ai/glm-4.7" }),
    ).toThrow(/apiKey/);
  });

  it("reports itself as the openrouter tool so a receipt names the right provider", () => {
    const client = createOpenRouterClient({
      apiKey: "sk-test",
      model: "z-ai/glm-4.7",
    });
    expect(client.tool).toBe("openrouter");
    expect(client.model).toBe("z-ai/glm-4.7");
  });

  it("carries no profile identity unless one is declared", () => {
    const client = createOpenRouterClient({
      apiKey: "sk-test",
      model: "z-ai/glm-4.7",
    });
    expect(client.profileId).toBeUndefined();
  });
});

describe("stripMarkdownFence", () => {
  it("unwraps a json fence, measured live from glm-4.7", () => {
    expect(stripMarkdownFence('```json\n[{"id":1}]\n```')).toBe('[{"id":1}]');
  });
  it("unwraps a bare fence", () => {
    expect(stripMarkdownFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves bare JSON alone", () => {
    expect(stripMarkdownFence('{"a":1}')).toBe('{"a":1}');
  });
  it("does not unwrap prose that merely starts with a fence", () => {
    const partial = "```json\n{broken";
    expect(stripMarkdownFence(partial)).toBe(partial);
  });
});

describe("createSafeOpenRouterClient", () => {
  it("declares a profile so the receipt can name what ran", () => {
    const client = createSafeOpenRouterClient({
      apiKey: "sk-test",
      model: "deepseek/deepseek-v4-pro",
    });
    expect(client.profileId).toBe("openrouter-stateless-v1");
    expect(client.tool).toBe("openrouter");
  });

  it("is still refused without a key", () => {
    expect(() =>
      createSafeOpenRouterClient({ apiKey: "", model: "z-ai/glm-4.7" }),
    ).toThrow(/apiKey/);
  });
});
