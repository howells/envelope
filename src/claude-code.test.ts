import { describe, it, expect, vi } from "vitest";
import EventEmitter from "node:events";
import {
  buildBaseArgs,
  defaultClaudeOptions,
  claudeCodeStructured,
  claudeCodeText,
} from "./claude-code.js";

interface MockStream extends EventEmitter {
  setEncoding: ReturnType<typeof vi.fn>;
}

interface MockChild extends EventEmitter {
  stdout: MockStream;
  stderr: MockStream;
  kill: ReturnType<typeof vi.fn>;
}

interface TimeoutError extends Error {
  killed?: boolean;
  signal?: string;
}

function collectFlagIndices(args: string[], flag: string) {
  return args.reduce<number[]>((indices, value, index) => {
    if (value === flag) {
      indices.push(index);
    }
    return indices;
  }, []);
}

function getRequiredIndex(indices: number[], position: number) {
  const index = indices.at(position);
  if (index == null) {
    throw new Error(`Missing expected index at position ${position}`);
  }
  return index;
}

// ---------------------------------------------------------------------------
// buildBaseArgs
// ---------------------------------------------------------------------------

describe("buildBaseArgs", () => {
  it("produces correct baseline with defaults", () => {
    const opts = defaultClaudeOptions();
    const args = buildBaseArgs(opts);

    expect(args).toEqual([
      "--model",
      "opus",
      "-p",
      "--permission-mode",
      "dontAsk",
    ]);
  });

  it("includes --system-prompt when set", () => {
    const opts = defaultClaudeOptions({ systemPrompt: "Be concise." });
    const args = buildBaseArgs(opts);
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("Be concise.");
  });

  it("includes --append-system-prompt when set", () => {
    const opts = defaultClaudeOptions({ appendSystemPrompt: "Extra context." });
    const args = buildBaseArgs(opts);
    expect(args).toContain("--append-system-prompt");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(
      "Extra context."
    );
  });

  it("repeats --allowedTools for each entry", () => {
    const opts = defaultClaudeOptions({
      allowedTools: ["Read", "Write", "Bash"],
    });
    const args = buildBaseArgs(opts);
    const indices = collectFlagIndices(args, "--allowedTools");
    expect(indices).toHaveLength(3);
    expect(args[getRequiredIndex(indices, 0) + 1]).toBe("Read");
    expect(args[getRequiredIndex(indices, 1) + 1]).toBe("Write");
    expect(args[getRequiredIndex(indices, 2) + 1]).toBe("Bash");
  });

  it("repeats --disallowedTools for each entry", () => {
    const opts = defaultClaudeOptions({ disallowedTools: ["Edit"] });
    const args = buildBaseArgs(opts);
    expect(args).toContain("--disallowedTools");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("Edit");
  });

  it("includes --fallback-model when set", () => {
    const opts = defaultClaudeOptions({ fallbackModel: "haiku" });
    const args = buildBaseArgs(opts);
    expect(args).toContain("--fallback-model");
    expect(args[args.indexOf("--fallback-model") + 1]).toBe("haiku");
  });

  it("repeats --betas for each entry", () => {
    const opts = defaultClaudeOptions({
      betas: ["interleaved-thinking", "extended-thinking"],
    });
    const args = buildBaseArgs(opts);
    const indices = collectFlagIndices(args, "--betas");
    expect(indices).toHaveLength(2);
    expect(args[getRequiredIndex(indices, 0) + 1]).toBe("interleaved-thinking");
    expect(args[getRequiredIndex(indices, 1) + 1]).toBe("extended-thinking");
  });

  it("includes --agent when set", () => {
    const opts = defaultClaudeOptions({ agent: "coder" });
    const args = buildBaseArgs(opts);
    expect(args).toContain("--agent");
    expect(args[args.indexOf("--agent") + 1]).toBe("coder");
  });

  it("includes --agents when set", () => {
    const opts = defaultClaudeOptions({ agents: "/path/to/agents" });
    const args = buildBaseArgs(opts);
    expect(args).toContain("--agents");
    expect(args[args.indexOf("--agents") + 1]).toBe("/path/to/agents");
  });

  it("omits optional flags when defaults are empty", () => {
    const opts = defaultClaudeOptions();
    const args = buildBaseArgs(opts);
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--append-system-prompt");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
    expect(args).not.toContain("--fallback-model");
    expect(args).not.toContain("--betas");
    expect(args).not.toContain("--agent");
    expect(args).not.toContain("--agents");
  });

  it("includes --tools when explicitly set", () => {
    const opts = defaultClaudeOptions({ tools: "default" });
    const args = buildBaseArgs(opts);
    expect(args).toContain("--tools");
    expect(args[args.indexOf("--tools") + 1]).toBe("default");
  });

  it("respects non-default permissionMode", () => {
    const opts = defaultClaudeOptions({ permissionMode: "plan" });
    const args = buildBaseArgs(opts);
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
  });
});

// ---------------------------------------------------------------------------
// defaultClaudeOptions
// ---------------------------------------------------------------------------

describe("defaultClaudeOptions", () => {
  it("fills all defaults from empty input", () => {
    const opts = defaultClaudeOptions();
    expect(opts.claudePath).toBe("claude");
    expect(opts.model).toBe("opus");
    expect(opts.maxBudgetUsd).toBe(5);
    expect(opts.timeoutMs).toBe(120_000);
    expect(opts.retries).toBe(1);
    expect(opts.retryDelayMs).toBe(800);
    expect(opts.permissionMode).toBe("dontAsk");
    expect(opts.tools).toBe("");
    expect(opts.systemPrompt).toBe("");
    expect(opts.appendSystemPrompt).toBe("");
    expect(opts.allowedTools).toEqual([]);
    expect(opts.disallowedTools).toEqual([]);
    expect(opts.fallbackModel).toBe("");
    expect(opts.betas).toEqual([]);
    expect(opts.agent).toBe("");
    expect(opts.agents).toBe("");
  });

  it("preserves provided values", () => {
    const opts = defaultClaudeOptions({
      model: "sonnet",
      systemPrompt: "test",
      allowedTools: ["Bash"],
      betas: ["beta1"],
    });
    expect(opts.model).toBe("sonnet");
    expect(opts.systemPrompt).toBe("test");
    expect(opts.allowedTools).toEqual(["Bash"]);
    expect(opts.betas).toEqual(["beta1"]);
  });
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockChild(stdout: string, exitCode: number, signal?: string) {
  const child = new EventEmitter() as MockChild;
  const stdoutStream = new EventEmitter() as MockStream;
  const stderrStream = new EventEmitter() as MockStream;
  stdoutStream.setEncoding = vi.fn();
  stderrStream.setEncoding = vi.fn();
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.kill = vi.fn();

  setTimeout(() => {
    stdoutStream.emit("data", stdout);
    child.emit("close", exitCode, signal ?? null);
  }, 0);

  return child;
}

let nextChild: MockChild | null = null;

vi.mock("node:child_process", () => ({
  spawn: vi.fn((..._args: unknown[]) => {
    if (nextChild) {
      const c = nextChild;
      nextChild = null;
      return c;
    }
    return createMockChild(JSON.stringify({ result: "ok" }), 0);
  }),
}));

function setNextChild(child: EventEmitter) {
  nextChild = child as MockChild;
}

// ---------------------------------------------------------------------------
// claudeCodeStructured (mocked spawn)
// ---------------------------------------------------------------------------

describe("claudeCodeStructured", () => {
  it("parses a valid JSON envelope", async () => {
    const envelope = {
      type: "result",
      result: "done",
      structured_output: { answer: 42 },
      total_cost_usd: 0.01,
    };
    setNextChild(createMockChild(JSON.stringify(envelope), 0));

    const res = await claudeCodeStructured<{ answer: number }>({
      prompt: "test",
      jsonSchema: '{"type":"object"}',
    });

    expect(res.structured_output).toEqual({ answer: 42 });
    expect(res.total_cost_usd).toBe(0.01);
  });

  it("throws on error envelope", async () => {
    const envelope = { is_error: true, subtype: "rate_limit" };
    setNextChild(createMockChild(JSON.stringify(envelope), 0));

    await expect(
      claudeCodeStructured({ prompt: "test", jsonSchema: '{"type":"object"}' })
    ).rejects.toThrow("rate_limit");
  });

  it("throws on non-JSON output", async () => {
    setNextChild(createMockChild("not json at all", 0));

    await expect(
      claudeCodeStructured({ prompt: "test", jsonSchema: '{"type":"object"}' })
    ).rejects.toThrow("non-JSON output");
  });

  it("passes all args to spawn", async () => {
    const { spawn } = await import("node:child_process");
    const mockedSpawn = vi.mocked(spawn);
    const envelope = { result: "ok", structured_output: {} };
    setNextChild(createMockChild(JSON.stringify(envelope), 0));

    await claudeCodeStructured({
      prompt: "hello",
      jsonSchema: '{"type":"object"}',
      options: {
        model: "sonnet",
        systemPrompt: "be brief",
        allowedTools: ["Read"],
        maxBudgetUsd: 1,
      },
    });

    const spawnCall = mockedSpawn.mock.calls.at(-1);
    if (!spawnCall) {
      throw new Error("Expected spawn to be called");
    }
    const args: string[] = spawnCall[1];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("be brief");
    expect(args).toContain("--allowedTools");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read");
    expect(args).toContain("--json-schema");
    expect(args.at(-1)).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// claudeCodeText (mocked spawn)
// ---------------------------------------------------------------------------

describe("claudeCodeText", () => {
  it("extracts result from JSON envelope", async () => {
    setNextChild(createMockChild(JSON.stringify({ result: "hello world" }), 0));

    const res = await claudeCodeText({ prompt: "test" });
    expect(res.text).toBe("hello world");
  });

  it("falls back to raw stdout for non-JSON", async () => {
    setNextChild(createMockChild("plain text response", 0));

    const res = await claudeCodeText({ prompt: "test" });
    expect(res.text).toBe("plain text response");
  });

  it("falls back to raw stdout for non-object JSON", async () => {
    setNextChild(createMockChild('"just a string"', 0));

    const res = await claudeCodeText({ prompt: "test" });
    expect(res.text).toBe('"just a string"');
  });

  it("throws on error envelope", async () => {
    setNextChild(
      createMockChild(
        JSON.stringify({ is_error: true, subtype: "rate_limit" }),
        0
      )
    );

    await expect(claudeCodeText({ prompt: "test" })).rejects.toThrow(
      "rate_limit"
    );
  });
});

// ---------------------------------------------------------------------------
// Retry on timeout
// ---------------------------------------------------------------------------

describe("retry on timeout", () => {
  it("retries after a timeout kill and succeeds", async () => {
    const { spawn } = await import("node:child_process");
    const mockedSpawn = vi.mocked(spawn);

    let callCount = 0;
    mockedSpawn.mockImplementation(() => {
      callCount++;
      const child = new EventEmitter() as MockChild;
      const stdoutStream = new EventEmitter() as MockStream;
      const stderrStream = new EventEmitter() as MockStream;
      stdoutStream.setEncoding = vi.fn();
      stderrStream.setEncoding = vi.fn();
      child.stdout = stdoutStream;
      child.stderr = stderrStream;
      child.kill = vi.fn();

      setTimeout(() => {
        if (callCount === 1) {
          // Emit "error" with the shape isTimeoutKill expects (.killed + .signal).
          // spawnAsync wraps this as .cause, and the retry logic checks the cause.
          const err = new Error("timeout") as TimeoutError;
          err.killed = true;
          err.signal = "SIGTERM";
          child.emit("error", err);
        } else {
          stdoutStream.emit("data", JSON.stringify({ result: "retry worked" }));
          child.emit("close", 0, null);
        }
      }, 0);

      return child;
    });

    const res = await claudeCodeText({
      prompt: "test",
      options: { retries: 1, retryDelayMs: 1 },
    });
    expect(res.text).toBe("retry worked");
    expect(callCount).toBe(2);

    // Reset mock to default behavior
    mockedSpawn.mockImplementation((..._args: unknown[]) => {
      return createMockChild(JSON.stringify({ result: "ok" }), 0);
    });
  });
});
