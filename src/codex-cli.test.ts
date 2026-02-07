import { describe, it, expect, vi } from "vitest";
import { baseArgs, defaultOptions } from "./codex-cli.js";

// ---------------------------------------------------------------------------
// defaultOptions
// ---------------------------------------------------------------------------

describe("defaultOptions", () => {
  it("fills all defaults from empty input", () => {
    const opts = defaultOptions();
    expect(opts.codexPath).toBe("codex");
    expect(opts.model).toBe("gpt-5.3-codex");
    expect(opts.timeoutMs).toBe(180_000);
    expect(opts.skipGitRepoCheck).toBe(true);
    expect(opts.sandbox).toBe("danger-full-access");
    expect(opts.profile).toBe("");
    expect(opts.config).toEqual([]);
    expect(opts.jsonlEvents).toBe(false);
    expect(opts.image).toEqual([]);
  });

  it("preserves provided values", () => {
    const opts = defaultOptions({
      model: "o3",
      sandbox: "read-only",
      image: ["a.png", "b.png"],
    });
    expect(opts.model).toBe("o3");
    expect(opts.sandbox).toBe("read-only");
    expect(opts.image).toEqual(["a.png", "b.png"]);
  });
});

// ---------------------------------------------------------------------------
// baseArgs
// ---------------------------------------------------------------------------

describe("baseArgs", () => {
  it("produces correct baseline with defaults", () => {
    const opts = defaultOptions();
    const args = baseArgs(opts);

    expect(args[0]).toBe("exec");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.3-codex");
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("danger-full-access");
  });

  it("omits --skip-git-repo-check when false", () => {
    const opts = defaultOptions({ skipGitRepoCheck: false });
    const args = baseArgs(opts);
    expect(args).not.toContain("--skip-git-repo-check");
  });

  it("includes --profile when set", () => {
    const opts = defaultOptions({ profile: "my-profile" });
    const args = baseArgs(opts);
    expect(args).toContain("--profile");
    expect(args[args.indexOf("--profile") + 1]).toBe("my-profile");
  });

  it("repeats --config for each entry", () => {
    const opts = defaultOptions({ config: ["key1=val1", "key2=val2"] });
    const args = baseArgs(opts);
    const indices = args.reduce<number[]>(
      (acc, v, i) => (v === "--config" ? [...acc, i] : acc),
      []
    );
    expect(indices).toHaveLength(2);
    expect(args[indices[0]! + 1]).toBe("key1=val1");
    expect(args[indices[1]! + 1]).toBe("key2=val2");
  });

  it("includes --json when jsonlEvents is true", () => {
    const opts = defaultOptions({ jsonlEvents: true });
    const args = baseArgs(opts);
    expect(args).toContain("--json");
  });

  it("repeats --image for each file", () => {
    const opts = defaultOptions({ image: ["screenshot.png", "diagram.jpg"] });
    const args = baseArgs(opts);
    const indices = args.reduce<number[]>(
      (acc, v, i) => (v === "--image" ? [...acc, i] : acc),
      []
    );
    expect(indices).toHaveLength(2);
    expect(args[indices[0]! + 1]).toBe("screenshot.png");
    expect(args[indices[1]! + 1]).toBe("diagram.jpg");
  });

  it("omits --image when array is empty", () => {
    const opts = defaultOptions();
    const args = baseArgs(opts);
    expect(args).not.toContain("--image");
  });
});
