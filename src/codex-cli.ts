import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Model identifier accepted by the Codex CLI.
 */
export type CodexModel = string;

/**
 * Options forwarded to the Codex CLI wrappers.
 */
export interface CodexOptions {
  /**
   * Executable path for the Codex binary.
   *
   * Defaults to `"codex"`.
   */
  codexPath?: string;
  /**
   * Working directory for the spawned Codex process.
   */
  cwd?: string;
  /**
   * Environment variables passed to the child process.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Codex model identifier to pass to `--model`.
   */
  model?: CodexModel;
  /**
   * Maximum subprocess runtime in milliseconds.
   */
  timeoutMs?: number;
  /**
   * Whether to emit `--skip-git-repo-check`.
   *
   * Defaults to `true` so the wrappers remain usable outside a checked-out Git repository.
   */
  skipGitRepoCheck?: boolean;
  /**
   * Sandbox policy passed to the Codex CLI.
   *
   * The package defaults this to `"workspace-write"`; callers must opt into
   * `"danger-full-access"` explicitly.
   */
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  /**
   * Optional named Codex profile.
   */
  profile?: string;
  /**
   * Additional `--config key=value` arguments.
   */
  config?: string[];
  /**
   * Whether to request JSONL event output via `--json`.
   */
  jsonlEvents?: boolean;
  /**
   * Optional image paths to attach to the initial prompt.
   */
  image?: string[];
}

interface CodexCliError extends Error {
  code?: number | string | null;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  cause?: unknown;
}

/**
 * Spawns Codex and captures stdout/stderr while optionally writing the prompt to stdin.
 *
 * Unlike the previous `execFile`-based implementation, this helper supports stdin-driven
 * prompt transport so large prompt bodies do not have to be forced through argv.
 */
function spawnAsync(
  file: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    stdin?: string;
    maxBufferBytes?: number;
  }
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const maxBufferBytes = opts.maxBufferBytes ?? 128 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | null = null;
    let hardKill: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (hardKill) {
        clearTimeout(hardKill);
        hardKill = null;
      }
    };

    const maybeKillOnBuffer = () => {
      if (stdout.length + stderr.length > maxBufferBytes) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        const e = new Error("codex CLI output exceeded maxBufferBytes");
        const error = e as CodexCliError;
        error.code = "MAXBUFFER";
        reject(error);
        cleanup();
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      maybeKillOnBuffer();
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      maybeKillOnBuffer();
    });

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        hardKill = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 2000);
      }, opts.timeoutMs);
    }

    child.on("error", (err) => {
      cleanup();
      const e = new Error(`codex CLI spawn error: ${String(err)}`);
      const error = e as CodexCliError;
      error.cause = err;
      reject(error);
    });

    child.on("close", (code, signal) => {
      cleanup();
      if (code !== 0) {
        const e = new Error(
          `codex CLI failed (code=${code ?? "?"}, signal=${signal ?? "?"}, timedOut=${timedOut}): ${stderr || stdout}`
        );
        const error = e as CodexCliError;
        error.code = code;
        error.signal = signal;
        error.timedOut = timedOut;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin?.end(opts.stdin ?? "");
  });
}

/**
 * Builds the shared portion of a Codex CLI command line.
 *
 * Exported mainly for tests and for advanced inspection of the emitted CLI flags.
 *
 * @param options - Fully-resolved Codex options, usually from {@link defaultOptions}.
 * @returns CLI argument fragments common to both text and structured calls.
 */
export function baseArgs(options: Required<CodexOptions>) {
  const args: string[] = ["exec"];
  if (options.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }
  if (options.cwd) {
    args.push("-C", options.cwd);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }
  if (options.profile) {
    args.push("--profile", options.profile);
  }
  for (const c of options.config) {
    args.push("--config", c);
  }
  if (options.jsonlEvents) {
    args.push("--json");
  }
  for (const img of options.image) {
    args.push("--image", img);
  }
  return args;
}

/**
 * Produces a fully-populated Codex option object with package defaults applied.
 *
 * @param opts - Partial Codex configuration.
 * @returns A normalized options object where every field is defined.
 */
export function defaultOptions(opts?: CodexOptions): Required<CodexOptions> {
  return {
    codexPath: opts?.codexPath ?? "codex",
    cwd: opts?.cwd ?? process.cwd(),
    env: opts?.env ?? process.env,
    model: opts?.model ?? "gpt-5.3-codex",
    timeoutMs: opts?.timeoutMs ?? 180_000,
    skipGitRepoCheck: opts?.skipGitRepoCheck ?? true,
    sandbox: opts?.sandbox ?? "workspace-write",
    profile: opts?.profile ?? "",
    config: opts?.config ?? [],
    jsonlEvents: opts?.jsonlEvents ?? false,
    image: opts?.image ?? [],
  };
}

/**
 * Executes a Codex request in a disposable temporary directory.
 *
 * The wrapper writes transient files such as output capture files and JSON schema files
 * into a unique temp directory, then removes that directory regardless of success or
 * failure.
 */
async function execInTempDir(
  options: Required<CodexOptions>,
  setup: (
    td: string,
    outPath: string
  ) => Promise<{ args: string[]; stdin?: string }>
): Promise<string> {
  const td = await mkdtemp(join(tmpdir(), "envelope-codex-"));
  try {
    const outPath = join(td, "last.txt");
    const setupResult = await setup(td, outPath);

    const cliArgs = [
      ...baseArgs(options),
      ...setupResult.args,
      "--output-last-message",
      outPath,
    ];

    await spawnAsync(options.codexPath, cliArgs, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
      stdin: setupResult.stdin,
    });

    return await readFile(outPath, "utf8");
  } finally {
    await rm(td, { recursive: true, force: true });
  }
}

/**
 * Requests a plain-text response from Codex.
 *
 * The prompt is supplied over stdin by passing `-` as the prompt argument, which avoids
 * argv size limits for large prompts.
 *
 * @param args - Text request configuration.
 * @param args.prompt - Prompt text to send to Codex.
 * @param args.options - Optional Codex CLI configuration.
 * @returns An object containing the final message text written by Codex.
 */
export async function codexText(args: {
  prompt: string;
  options?: CodexOptions;
}) {
  const options = defaultOptions(args.options);
  const text = await execInTempDir(options, async () => ({
    args: ["-"],
    stdin: args.prompt,
  }));
  return { text };
}

/**
 * Requests structured output from Codex using `--output-schema`.
 *
 * The prompt is supplied over stdin and the JSON schema is written to a temporary file
 * because the current Codex CLI expects a file path for `--output-schema`.
 *
 * @typeParam TStructured - Expected type of the parsed JSON response.
 * @param args - Structured request configuration.
 * @param args.prompt - Prompt text to send to Codex.
 * @param args.jsonSchema - JSON schema string written to a temporary schema file.
 * @param args.options - Optional Codex CLI configuration.
 * @returns The parsed structured response plus the raw JSON string emitted by Codex.
 *
 * @throws {Error} Thrown when the subprocess fails or when Codex does not emit valid JSON.
 */
export async function codexStructured<TStructured>(args: {
  prompt: string;
  jsonSchema: string;
  options?: CodexOptions;
}) {
  const options = defaultOptions(args.options);

  const raw = await execInTempDir(options, async (td) => {
    const schemaPath = join(td, "schema.json");
    await writeFile(schemaPath, args.jsonSchema, "utf8");
    return {
      args: ["--output-schema", schemaPath, "-"],
      stdin: args.prompt,
    };
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `codex output was not JSON. First 200 chars:\n${raw.slice(0, 200)}`
    );
  }

  return { structured: parsed as TStructured, raw };
}
