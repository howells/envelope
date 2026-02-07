import { describe, it, expect } from "vitest";
import { z } from "zod";
import { jsonSchemaFromZod, createClaudeCodeClient, createCodexClient } from "./client.js";

// ---------------------------------------------------------------------------
// jsonSchemaFromZod
// ---------------------------------------------------------------------------

describe("jsonSchemaFromZod", () => {
  it("produces a schema without $ref", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const json = jsonSchemaFromZod(schema);

    expect(json.type).toBe("object");
    expect(JSON.stringify(json)).not.toContain("$ref");
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
    expect(props?.["items"]?.type).toBe("array");
  });

  it("handles enums", () => {
    const schema = z.object({
      status: z.enum(["active", "inactive"]),
    });
    const json = jsonSchemaFromZod(schema);

    expect(json.type).toBe("object");
    const props = json.properties as Record<string, { enum?: string[] }>;
    expect(props?.["status"]?.enum).toEqual(["active", "inactive"]);
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
