import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createClaudeCodeClient,
  createCodexClient,
  createGeminiClient,
  createSafeClaudeCodeClient,
  createSafeCodexClient,
  createSafeGeminiClient,
  jsonSchemaFromZod,
} from "./client.js";

// ---------------------------------------------------------------------------
// jsonSchemaFromZod
// ---------------------------------------------------------------------------

describe("jsonSchemaFromZod", () => {
  it("produces a schema without $ref or $schema", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const json = jsonSchemaFromZod(schema);

    expect(json.type).toBe("object");
    expect(JSON.stringify(json)).not.toContain("$ref");
    expect(json).not.toHaveProperty("$schema");
  });

  it("handles nested objects without definitions wrapper", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      count: z.number().int(),
    });
    const json = jsonSchemaFromZod(schema);

    expect(json.type).toBe("object");
    expect(JSON.stringify(json)).not.toContain("$ref");
    expect(JSON.stringify(json)).not.toContain("definitions");
  });

  it("handles arrays", () => {
    const schema = z.object({
      items: z.array(z.string()),
    });
    const json = jsonSchemaFromZod(schema);

    expect(json.type).toBe("object");
    const props = json.properties as Record<string, { type: string }>;
    expect(props?.items?.type).toBe("array");
  });

  it("handles enums", () => {
    const schema = z.object({
      status: z.enum(["active", "inactive"]),
    });
    const json = jsonSchemaFromZod(schema);

    expect(json.type).toBe("object");
    const props = json.properties as Record<string, { enum?: string[] }>;
    expect(props?.status?.enum).toEqual(["active", "inactive"]);
  });
});

// ---------------------------------------------------------------------------
// createClaudeCodeClient
// ---------------------------------------------------------------------------

describe("createClaudeCodeClient", () => {
  it("creates a client with defaults", () => {
    const client = createClaudeCodeClient();
    expect(client.tool).toBe("claude-code");
    expect(client.model).toBe("opus");
  });

  it("accepts custom model and options", () => {
    const client = createClaudeCodeClient({
      model: "sonnet",
      maxBudgetUsd: 10,
      options: { systemPrompt: "be brief" },
    });
    expect(client.tool).toBe("claude-code");
    expect(client.model).toBe("sonnet");
  });
});

// ---------------------------------------------------------------------------
// createCodexClient
// ---------------------------------------------------------------------------

describe("createCodexClient", () => {
  it("creates a client with defaults", () => {
    const client = createCodexClient();
    expect(client.tool).toBe("codex");
    expect(client.model).toBe("gpt-5.3-codex");
  });

  it("accepts custom model and options", () => {
    const client = createCodexClient({
      model: "o3",
      options: { image: ["test.png"] },
    });
    expect(client.tool).toBe("codex");
    expect(client.model).toBe("o3");
  });
});

describe("safe execution profiles", () => {
  it("marks the Claude profile as tool-free and ephemeral", () => {
    const client = createSafeClaudeCodeClient({ cwd: "/tmp/envelope" });
    expect(client.profileId).toBe("claude-tool-free-ephemeral-v1");
  });

  it("marks the Codex profile as read-only and ephemeral", () => {
    const client = createSafeCodexClient({ cwd: "/tmp/envelope" });
    expect(client.profileId).toBe("codex-read-only-ephemeral-v1");
  });

  it("marks the Gemini profile as read-only and ephemeral", () => {
    const client = createSafeGeminiClient({ cwd: "/tmp/envelope" });
    expect(client.profileId).toBe("gemini-read-only-ephemeral-v1");
  });

  it("gives every safe profile a declared identity, so a receipt can name it", () => {
    for (const client of [
      createSafeClaudeCodeClient({ cwd: "/tmp/envelope" }),
      createSafeCodexClient({ cwd: "/tmp/envelope" }),
      createSafeGeminiClient({ cwd: "/tmp/envelope" }),
    ]) {
      expect(client.profileId, client.tool).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// createGeminiClient
// ---------------------------------------------------------------------------

describe("createGeminiClient", () => {
  it("creates a client with defaults", () => {
    const client = createGeminiClient();
    expect(client.tool).toBe("gemini");
    expect(client.model).toBe("gemini-3-flash-preview");
  });

  it("accepts custom model and options", () => {
    const client = createGeminiClient({
      model: "gemini-2.5-pro",
      options: { approvalMode: "plan" },
    });
    expect(client.tool).toBe("gemini");
    expect(client.model).toBe("gemini-2.5-pro");
  });
});
