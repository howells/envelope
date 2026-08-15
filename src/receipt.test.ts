import { describe, expect, it } from "vitest";

import {
  classifyInvocationFailure,
  isUsageLimit,
  redactedFailureMessage,
} from "./receipt.js";

describe("isUsageLimit", () => {
  it("recognises the real Codex exhaustion message", () => {
    expect(
      isUsageLimit(
        "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 20th, 2026 6:33 PM.",
      ),
    ).toBe(true);
  });

  it("recognises the common provider phrasings", () => {
    for (const message of [
      "Rate limit exceeded, please retry later",
      "error: rate_limit_error",
      "You have exceeded your current quota",
      "HTTP 429 Too Many Requests",
      "You are out of credits",
    ]) {
      expect(isUsageLimit(message), message).toBe(true);
    }
  });

  it("does not fire on ordinary transport failures", () => {
    for (const message of [
      "codex CLI failed (code=1, signal=?, timedOut=false): spawn ENOENT",
      "Structured output did not match the schema",
      "claude CLI failed: connection reset",
    ]) {
      expect(isUsageLimit(message), message).toBe(false);
    }
  });
});

describe("classifyInvocationFailure", () => {
  it("classifies a usage limit as its own kind, not a generic provider fault", () => {
    const classified = classifyInvocationFailure(
      new Error(
        "codex CLI failed (code=1, signal=?, timedOut=false): ERROR: You've hit your usage limit.",
      ),
    );
    expect(classified.kind).toBe("usage_limit");
  });

  it("redacts the usage-limit message so no subprocess content escapes", () => {
    const classified = classifyInvocationFailure(
      new Error(
        "You've hit your usage limit. Visit https://example.com/billing",
      ),
    );
    expect(classified.message).toBe("Provider usage limit reached");
    expect(classified.message).not.toContain("example.com");
  });

  it("still classifies cancellation ahead of a usage limit", () => {
    const classified = classifyInvocationFailure(
      new Error("aborted before the rate limit could apply"),
    );
    expect(classified.kind).toBe("cancelled");
  });

  it("leaves the other kinds alone", () => {
    expect(classifyInvocationFailure(new Error("spawn ENOENT")).kind).toBe(
      "spawn",
    );
    expect(classifyInvocationFailure(new Error("timedOut=true")).kind).toBe(
      "timeout",
    );
    expect(
      classifyInvocationFailure(new Error("something odd happened")).kind,
    ).toBe("unknown");
  });

  it("has a redacted message for every kind", () => {
    for (const kind of [
      "cancelled",
      "input_validation",
      "output_validation",
      "provider",
      "schema",
      "spawn",
      "timeout",
      "transport",
      "usage_limit",
      "unknown",
    ] as const) {
      expect(redactedFailureMessage(kind), kind).toBeTruthy();
    }
  });
});
