import { spawn } from "node:child_process";

/**
 * Model identifier accepted by the Gemini CLI.
 *
 * The wrapper treats model names as opaque strings so callers can use whatever aliases or
 * full model identifiers the installed Gemini CLI currently accepts.
 */
export type GeminiModel = string;

/**
 * Options forwarded to the Gemini CLI wrappers.
 *
 * Gemini's headless mode currently exposes prompt-based output shaping rather than a
 * native JSON-schema flag, so these options focus on subprocess behavior and the CLI's
 * request-scoped execution controls.
 */
export interface GeminiOptions {
  /**
   * Executable path for the Gemini binary.
   *
   * Defaults to `"gemini"`.
   */
  geminiPath?: string;
  /**
   * Working directory for the spawned Gemini process.
   *
   * Defaults to `process.cwd()`.
   */
  cwd?: string;
  /**
   * Environment variables passed to the Gemini subprocess.
   *
   * Defaults to `process.env`.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Gemini model identifier passed to `--model`.
   */
  model?: GeminiModel;
  /**
   * Maximum subprocess runtime in milliseconds.
   */
  timeoutMs?: number;
  /**
   * Gemini approval mode.
   *
   * The package defaults to `"plan"` so Gemini runs in a read-only posture unless the
   * caller opts into a more permissive mode explicitly.
   */
  approvalMode?: "default" | "auto_edit" | "yolo" | "plan";
  /**
   * Whether to request Gemini's sandbox mode.
   */
  sandbox?: boolean;
  /**
   * Whether to enable Gemini debug mode.
   */
  debug?: boolean;
  /**
   * Additional policy files or directories loaded via repeated `--policy` flags.
   */
  policy?: string[];
  /**
   * Additional admin policy files or directories loaded via repeated
   * `--admin-policy` flags.
   */
  adminPolicy?: string[];
  /**
   * Restricts enabled Gemini extensions via repeated `--extensions` flags.
   */
  extensions?: string[];
  /**
   * Additional directories included in the Gemini workspace via repeated
   * `--include-directories` flags.
   */
  includeDirectories?: string[];
}

/**
 * JSON envelope emitted by Gemini when `--output-format json` is used.
 *
 * The wrapper primarily relies on the `response` field, but the extra metadata is kept
 * available for advanced callers and future debugging.
 */
export interface GeminiEnvelope {
  session_id?: string;
  response?: string;
  stats?: unknown;
}

interface GeminiCliError extends Error {
  code?: number | string | null;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  cause?: unknown;
}

/**
 * Conservative per-argument transport limit for Gemini prompts and schema instructions.
 *
 * Gemini's current non-interactive mode uses `--prompt`, so this wrapper fails early
 * before hitting operating-system command-line limits.
 */
const MAX_GEMINI_ARG_BYTES = 128 * 1024;
/**
 * Conservative combined transport limit for the prompt plus embedded schema guidance.
 */
const MAX_GEMINI_COMBINED_ARG_BYTES = 256 * 1024;
const FENCED_JSON_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/**
 * Checks whether a value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates that prompt and schema payloads are small enough to transport over argv.
 *
 * @param prompt - Prompt text passed to `--prompt`.
 * @param jsonSchema - Optional JSON schema string embedded into the structured prompt.
 * @throws {Error} Thrown when the payload exceeds the wrapper's conservative argv budget.
 */
function assertGeminiArgSize(prompt: string, jsonSchema?: string) {
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  const schemaBytes = Buffer.byteLength(jsonSchema ?? "", "utf8");
  if (
    promptBytes > MAX_GEMINI_ARG_BYTES ||
    schemaBytes > MAX_GEMINI_ARG_BYTES ||
    promptBytes + schemaBytes > MAX_GEMINI_COMBINED_ARG_BYTES
  ) {
    throw new Error(
      "gemini CLI prompt/schema exceeds the safe argv transport limit; reduce the payload size before calling this wrapper"
    );
  }
}

/**
 * Removes a single surrounding fenced-code wrapper from a JSON candidate.
 *
 * Gemini is instructed to return bare JSON in structured mode, but this helper tolerates
 * the common failure mode where a model wraps the JSON in a single ```json fence.
 *
 * @param value - Raw model response text.
 * @returns The normalized JSON candidate.
 */
function stripMarkdownFence(value: string) {
  const trimmed = value.trim();
  const match = FENCED_JSON_PATTERN.exec(trimmed);
  const inner = match?.[1];
  return inner ? inner.trim() : trimmed;
}

/**
 * Builds a prompt that asks Gemini to return JSON matching the supplied schema.
 *
 * Gemini's current CLI does not expose a native schema flag, so structured mode relies
 * on prompt-level instructions plus strict JSON parsing and downstream Zod validation.
 *
 * Tracking upstream schema support:
 * - https://github.com/google-gemini/gemini-cli/issues/13388
 * - https://github.com/google-gemini/gemini-cli/issues/5021
 *
 * @param prompt - User task prompt.
 * @param jsonSchema - JSON schema string to embed verbatim.
 * @returns A prompt suitable for Gemini structured generation.
 */
function buildStructuredPrompt(prompt: string, jsonSchema: string) {
  return [
    prompt,
    "",
    "Return only valid JSON matching this JSON Schema.",
    "Do not wrap the JSON in markdown fences.",
    "Do not add commentary before or after the JSON.",
    "",
    "JSON Schema:",
    jsonSchema,
  ].join("\n");
}

/**
 * Spawns Gemini and captures stdout/stderr with timeout and max-buffer safeguards.
 */
function spawnAsync(
  file: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    maxBufferBytes?: number;
  }
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
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
        const error = new Error("gemini CLI output exceeded maxBufferBytes");
        const cliError = error as GeminiCliError;
        cliError.code = "MAXBUFFER";
        reject(cliError);
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
      const error = new Error(`gemini CLI spawn error: ${String(err)}`);
      const cliError = error as GeminiCliError;
      cliError.cause = err;
      reject(cliError);
    });

    child.on("close", (code, signal) => {
      cleanup();
      if (code !== 0) {
        const error = new Error(
          `gemini CLI failed (code=${code ?? "?"}, signal=${signal ?? "?"}, timedOut=${timedOut}): ${stderr || stdout}`
        );
        const cliError = error as GeminiCliError;
        cliError.code = code;
        cliError.signal = signal;
        cliError.timedOut = timedOut;
        reject(cliError);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Produces a fully-populated Gemini options object with package defaults applied.
 *
 * @param opts - Partial Gemini CLI configuration.
 * @returns A normalized options object where every field is defined.
 */
export function defaultGeminiOptions(
  opts?: GeminiOptions
): Required<GeminiOptions> {
  return {
    geminiPath: opts?.geminiPath ?? "gemini",
    cwd: opts?.cwd ?? process.cwd(),
    env: opts?.env ?? process.env,
    model: opts?.model ?? "gemini-3-flash-preview",
    timeoutMs: opts?.timeoutMs ?? 180_000,
    approvalMode: opts?.approvalMode ?? "plan",
    sandbox: opts?.sandbox ?? false,
    debug: opts?.debug ?? false,
    policy: opts?.policy ?? [],
    adminPolicy: opts?.adminPolicy ?? [],
    extensions: opts?.extensions ?? [],
    includeDirectories: opts?.includeDirectories ?? [],
  };
}

/**
 * Builds the shared portion of a Gemini CLI command line.
 *
 * @param options - Fully-resolved Gemini options, usually from
 * {@link defaultGeminiOptions}.
 * @returns CLI argument fragments common to Gemini text and structured requests.
 */
export function buildGeminiArgs(options: Required<GeminiOptions>) {
  const args: string[] = [];
  if (options.debug) {
    args.push("--debug");
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.approvalMode) {
    args.push("--approval-mode", options.approvalMode);
  }
  if (options.sandbox) {
    args.push("--sandbox");
  }
  for (const path of options.policy) {
    args.push("--policy", path);
  }
  for (const path of options.adminPolicy) {
    args.push("--admin-policy", path);
  }
  for (const extension of options.extensions) {
    args.push("--extensions", extension);
  }
  for (const dir of options.includeDirectories) {
    args.push("--include-directories", dir);
  }
  return args;
}

/**
 * Requests a plain-text response from Gemini in headless JSON-output mode.
 *
 * The Gemini CLI currently emits a JSON envelope with a `response` field in this mode.
 * If the CLI ever falls back to plain stdout, this wrapper returns the raw stdout so
 * callers still receive the generated text.
 *
 * @param args - Text request configuration.
 * @param args.prompt - Prompt text to send to Gemini.
 * @param args.options - Optional Gemini CLI configuration.
 * @returns The plain-text response plus the parsed Gemini envelope when available.
 */
export async function geminiText(args: {
  prompt: string;
  options?: GeminiOptions;
}) {
  assertGeminiArgSize(args.prompt);
  const options = defaultGeminiOptions(args.options);
  const { stdout } = await spawnAsync(
    options.geminiPath,
    [
      ...buildGeminiArgs(options),
      "--output-format",
      "json",
      "--prompt",
      args.prompt,
    ],
    {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
    }
  );

  try {
    const parsed = JSON.parse(stdout);
    if (isRecord(parsed) && typeof parsed.response === "string") {
      return { text: parsed.response, envelope: parsed as GeminiEnvelope };
    }
  } catch {
    // Fall back to raw stdout if Gemini does not emit the expected JSON envelope.
  }

  return { text: stdout };
}

/**
 * Requests structured output from Gemini.
 *
 * Gemini does not currently expose a CLI schema flag comparable to Claude's
 * `--json-schema` or Codex's `--output-schema`, so this helper embeds the JSON Schema
 * into the prompt, requires bare JSON output, then parses the result strictly.
 *
 * When the Gemini CLI adds native schema support, this function should switch from
 * prompt-embedded schema guidance to the official CLI flag/path immediately. See:
 * - https://github.com/google-gemini/gemini-cli/issues/13388
 * - https://github.com/google-gemini/gemini-cli/issues/5021
 *
 * Callers should still validate the parsed object with Zod or another schema validator;
 * this wrapper only guarantees that the response is valid JSON.
 *
 * @typeParam TStructured - Expected type of the parsed structured response.
 * @param args - Structured request configuration.
 * @param args.prompt - Task prompt sent to Gemini.
 * @param args.jsonSchema - JSON schema string embedded into the prompt.
 * @param args.options - Optional Gemini CLI configuration.
 * @returns The parsed structured response plus the raw text returned by Gemini.
 *
 * @throws {Error} Thrown when Gemini does not return valid JSON.
 */
export async function geminiStructured<TStructured>(args: {
  prompt: string;
  jsonSchema: string;
  options?: GeminiOptions;
}) {
  const prompt = buildStructuredPrompt(args.prompt, args.jsonSchema);
  assertGeminiArgSize(prompt, args.jsonSchema);

  const { text: raw } = await geminiText({
    prompt,
    options: args.options,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFence(raw));
  } catch {
    throw new Error(
      `gemini output was not JSON. First 200 chars:\n${raw.slice(0, 200)}`
    );
  }

  return { structured: parsed as TStructured, raw };
}
