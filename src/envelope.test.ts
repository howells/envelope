import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CliClient } from "./client.js";
import {
  createEnvelope,
  createReceiptedEnvelope,
  EnvelopeError,
  EnvelopeInvocationError,
} from "./envelope.js";

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
      expect.objectContaining({ prompt: "Summarize: Hello world" }),
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
      "Model returned invalid structured output",
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

    await expect(envelope({ text: "valid input" })).rejects.toThrow(
      EnvelopeError,
    );
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
    const call = (client.structured as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    if (!call) {
      throw new Error("Expected structured client call to be recorded");
    }
    expect(call.jsonSchema).toBeDefined();
    expect(call.jsonSchema.type).toBe("object");
  });
});

describe("createReceiptedEnvelope", () => {
  const input = z.object({ text: z.string().min(1) });
  const output = z.object({ summary: z.string().min(1) });

  it("returns validated output with a redacted invocation receipt", async () => {
    const client = mockClient({ summary: "A short summary." });
    client.profileId = "claude-tool-free-ephemeral-v1";
    client.structured = vi.fn().mockResolvedValue({
      structured: { summary: "A short summary." },
      meta: {
        attemptCount: 2,
        cliVersion: "2.1.0",
        costUsd: 0.01,
        resolvedModel: "claude-opus-4-1",
      },
    });
    const envelope = createReceiptedEnvelope({
      input,
      output,
      prompt: ({ text }) => `Summarize: ${text}`,
      client,
    });

    const result = await envelope({ text: "Hello world" });
    expect(result.output).toEqual({ summary: "A short summary." });
    expect(result.receipt).toMatchObject({
      attemptCount: 2,
      cliVersion: "2.1.0",
      profileId: "claude-tool-free-ephemeral-v1",
      requestedModel: "opus",
      resolvedModel: "claude-opus-4-1",
      tool: "claude-code",
    });
    expect(result.receipt.inputDigest).toMatch(/^sha256:/);
    expect(result.receipt.outputDigest).toMatch(/^sha256:/);
    expect(JSON.stringify(result.receipt)).not.toContain("Hello world");
    expect(JSON.stringify(result.receipt)).not.toContain("A short summary");
  });

  it("throws a receipted validation error without spawning a client", async () => {
    const client = mockClient({ summary: "unused" });
    const envelope = createReceiptedEnvelope({
      input,
      output,
      prompt: ({ text }) => text,
      client,
    });

    const promise = envelope({ text: "" });
    await expect(promise).rejects.toBeInstanceOf(EnvelopeInvocationError);
    await promise.catch((error: unknown) => {
      expect((error as EnvelopeInvocationError).receipt.error?.kind).toBe(
        "input_validation",
      );
    });
    expect(client.structured).not.toHaveBeenCalled();
  });

  it("does not retain provider stderr or prompt content in failed receipts", async () => {
    const client = mockClient({ summary: "unused" });
    client.structured = vi
      .fn()
      .mockRejectedValue(
        new Error("claude CLI failed: secret evidence from subprocess stderr"),
      );
    const envelope = createReceiptedEnvelope({
      input,
      output,
      prompt: ({ text }) => `Analyze ${text}`,
      client,
    });

    await envelope({ text: "confidential prompt body" }).catch(
      (error: unknown) => {
        const serialized = JSON.stringify(
          (error as EnvelopeInvocationError).receipt,
        );
        expect(serialized).not.toContain("secret evidence");
        expect(serialized).not.toContain("confidential prompt body");
        expect((error as EnvelopeInvocationError).receipt.error).toEqual({
          kind: "provider",
          message: "Provider invocation failed",
        });
      },
    );
  });
});
