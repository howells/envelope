import { describe, expect, it } from "vitest";

import {
  createOpenRouterClient,
  createSafeOpenRouterClient,
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
