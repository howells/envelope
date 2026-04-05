import EventEmitter from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  buildGeminiArgs,
  defaultGeminiOptions,
  geminiStructured,
  geminiText,
} from "./gemini-cli.js";

interface MockStream extends EventEmitter {
  setEncoding: ReturnType<typeof vi.fn>;
}

interface MockChild extends EventEmitter {
  kill: ReturnType<typeof vi.fn>;
  stderr: MockStream;
  stdout: MockStream;
}

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
      const child = nextChild;
      nextChild = null;
      return child;
    }
    return createMockChild(JSON.stringify({ response: "ok" }), 0);
  }),
}));

function setNextChild(child: EventEmitter) {
  nextChild = child as MockChild;
}

function getLatestSpawnCall(spawnCalls: unknown[][]) {
  const call = spawnCalls.at(-1);
  if (!call) {
    throw new Error("Expected spawn to be called");
  }
  return call;
}

describe("defaultGeminiOptions", () => {
  it("fills all defaults from empty input", () => {
    const opts = defaultGeminiOptions();
    expect(opts.geminiPath).toBe("gemini");
    expect(opts.model).toBe("gemini-3-flash-preview");
    expect(opts.timeoutMs).toBe(180_000);
    expect(opts.approvalMode).toBe("plan");
    expect(opts.sandbox).toBe(false);
    expect(opts.debug).toBe(false);
    expect(opts.policy).toEqual([]);
    expect(opts.adminPolicy).toEqual([]);
    expect(opts.extensions).toEqual([""]);
    expect(opts.includeDirectories).toEqual([]);
  });

  it("preserves provided values", () => {
    const opts = defaultGeminiOptions({
      model: "gemini-2.5-pro",
      approvalMode: "auto_edit",
      sandbox: true,
      policy: ["./policy.md"],
    });
    expect(opts.model).toBe("gemini-2.5-pro");
    expect(opts.approvalMode).toBe("auto_edit");
    expect(opts.sandbox).toBe(true);
    expect(opts.policy).toEqual(["./policy.md"]);
  });
});

describe("buildGeminiArgs", () => {
  it("produces the baseline flags", () => {
    const args = buildGeminiArgs(defaultGeminiOptions());
    expect(args).toEqual([
      "--model",
      "gemini-3-flash-preview",
      "--approval-mode",
      "plan",
      "--extensions",
      "",
    ]);
  });

  it("includes optional repeated flags when provided", () => {
    const args = buildGeminiArgs(
      defaultGeminiOptions({
        sandbox: true,
        debug: true,
        policy: ["./policy-a.md", "./policy-b.md"],
        adminPolicy: ["./admin.md"],
        extensions: ["ext-a"],
        includeDirectories: ["../shared"],
      })
    );

    expect(args).toContain("--debug");
    expect(args).toContain("--sandbox");
    expect(args.filter((value) => value === "--policy")).toHaveLength(2);
    expect(args).toContain("--admin-policy");
    expect(args).toContain("--extensions");
    expect(args).toContain("--include-directories");
  });
});

describe("geminiText", () => {
  it("extracts the response field from the Gemini JSON envelope", async () => {
    setNextChild(
      createMockChild(JSON.stringify({ response: "hello world" }), 0)
    );

    const result = await geminiText({ prompt: "test" });
    expect(result.text).toBe("hello world");
  });

  it("falls back to raw stdout when the CLI output is not a JSON envelope", async () => {
    setNextChild(createMockChild("plain text response", 0));

    const result = await geminiText({ prompt: "test" });
    expect(result.text).toBe("plain text response");
  });

  it("passes expected flags to spawn", async () => {
    const { spawn } = await import("node:child_process");
    const mockedSpawn = vi.mocked(spawn);
    setNextChild(createMockChild(JSON.stringify({ response: "ok" }), 0));

    await geminiText({
      prompt: "hello",
      options: {
        model: "gemini-2.5-pro",
        approvalMode: "auto_edit",
        sandbox: true,
        policy: ["./policy.md"],
      },
    });

    const spawnCall = getLatestSpawnCall(mockedSpawn.mock.calls);
    const args: string[] = spawnCall[1];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-2.5-pro");
    expect(args).toContain("--approval-mode");
    expect(args[args.indexOf("--approval-mode") + 1]).toBe("auto_edit");
    expect(args).toContain("--sandbox");
    expect(args).toContain("--policy");
    expect(args[args.indexOf("--policy") + 1]).toBe("./policy.md");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args).toContain("--prompt");
    expect(args[args.indexOf("--prompt") + 1]).toBe("hello");
  });
});

describe("geminiStructured", () => {
  it("parses bare JSON returned by Gemini", async () => {
    setNextChild(
      createMockChild(JSON.stringify({ response: '{"answer":42}' }), 0)
    );

    const result = await geminiStructured<{ answer: number }>({
      prompt: "answer the question",
      jsonSchema: '{"type":"object"}',
    });

    expect(result.structured).toEqual({ answer: 42 });
    expect(result.raw).toBe('{"answer":42}');
  });

  it("accepts a single surrounding markdown fence", async () => {
    setNextChild(
      createMockChild(
        JSON.stringify({ response: '```json\n{"answer":42}\n```' }),
        0
      )
    );

    const result = await geminiStructured<{ answer: number }>({
      prompt: "answer the question",
      jsonSchema: '{"type":"object"}',
    });

    expect(result.structured).toEqual({ answer: 42 });
  });

  it("throws when Gemini does not return JSON", async () => {
    setNextChild(createMockChild(JSON.stringify({ response: "not json" }), 0));

    await expect(
      geminiStructured({
        prompt: "answer the question",
        jsonSchema: '{"type":"object"}',
      })
    ).rejects.toThrow("gemini output was not JSON");
  });
});
