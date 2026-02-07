import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createEnvelope, EnvelopeError } from "./envelope.js";
import type { CliClient } from "./client.js";

function mockClient(response: unknown): CliClient {
  return {
    tool: "claude-code",
    model: "opus",
    text: vi.fn().mockResolvedValue({ text: "" }),
    structured: vi.fn().mockResolvedValue({ structured: response }),
  };
}

describe("createEnvelope", () => {
  const input = z.object({ text: z.string().min(1) });
  const output = z.object({ summary: z.string().min(1) });

  it("validates input and returns parsed output", async () => {
    const client = mockClient({ summary: "A short summary." });
    const envelope = createEnvelope({
      input,
      output,
      prompt: ({ text }) => `Summarize: ${text}`,
      client,
    });

    const result = await envelope({ text: "Hello world" });
    expect(result).toEqual({ summary: "A short summary." });

    // Verify prompt function received parsed data
    expect(client.structured).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Summarize: Hello world" })
    );
  });

  it("throws EnvelopeError on invalid input", async () => {
    const client = mockClient({ summary: "irrelevant" });
    const envelope = createEnvelope({
      input,
      output,
      prompt: ({ text }) => text,
      client,
    });

    // Empty string fails z.string().min(1)
    await expect(envelope({ text: "" })).rejects.toThrow(EnvelopeError);
  });

  it("throws EnvelopeError on missing input field", async () => {
    const client = mockClient({ summary: "irrelevant" });
    const envelope = createEnvelope({
      input,
      output,
      prompt: ({ text }) => text,
      client,
    });

    await expect(envelope({})).rejects.toThrow(EnvelopeError);
  });

  it("throws EnvelopeError when model output fails validation", async () => {
    // Model returns empty summary, which fails min(1)
    const client = mockClient({ summary: "" });
    const envelope = createEnvelope({
      input,
      output,
      prompt: ({ text }) => text,
      client,
    });

    await expect(envelope({ text: "valid input" })).rejects.toThrow(
      "Model returned invalid structured output"
    );
  });

  it("throws EnvelopeError when model returns wrong shape", async () => {
    const client = mockClient({ wrong_field: true });
    const envelope = createEnvelope({
      input,
      output,
      prompt: ({ text }) => text,
      client,
    });

    await expect(envelope({ text: "valid input" })).rejects.toThrow(EnvelopeError);
  });

  it("passes jsonSchema to client.structured", async () => {
    const client = mockClient({ summary: "ok" });
    const envelope = createEnvelope({
      input,
      output,
      prompt: ({ text }) => text,
      client,
    });

    await envelope({ text: "hi" });
    const call = (client.structured as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.jsonSchema).toBeDefined();
    expect(call.jsonSchema.type).toBe("object");
  });
});
