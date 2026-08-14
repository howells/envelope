import { spawn } from "node:child_process";

/**
 * Model identifier accepted by the Claude Code CLI.
 *
 * The package treats model names as opaque strings so callers can use aliases such as
 * `"sonnet"` or fully-qualified Claude model identifiers as they become available.
 */
export type ClaudeCodeModel = string;

/**
 * Options forwarded to the Claude Code CLI wrappers.
 *
 * These options control subprocess behavior, CLI flag generation, and request-shaping
 * concerns such as timeouts, retry behavior, permissions, and tool allow/deny lists.
 */
export interface ClaudeCodeOptions {
  /**
   * Name of a custom agent to use for the session.
   */
  agent?: string;
  /**
   * JSON string describing custom agents for the session, forwarded to `--agents`.
   */
  agents?: string;
  /**
   * Tool allow-list entries, each emitted as a separate `--allowedTools` flag.
   */
  allowedTools?: string[];
  /**
   * Appends additional content to the default Claude system prompt.
   */
  appendSystemPrompt?: string;
  /**
   * Beta feature headers to pass through to Claude Code.
   */
  betas?: string[];
  /**
   * Executable path for the Claude Code binary.
   *
   * Defaults to `"claude"` and relies on the binary being available on `PATH`.
   */
  claudePath?: string;
  /**
   * Working directory used for the spawned Claude Code process.
   *
   * Defaults to `process.cwd()`.
   */
  cwd?: string;
  /**
   * Tool deny-list entries, each emitted as a separate `--disallowedTools` flag.
   */
  disallowedTools?: string[];
  /**
   * Environment variables passed to the child process.
   *
   * Defaults to the current process environment.
   */
  env?: NodeJS.ProcessEnv;
  /** Claude reasoning effort passed through to `--effort`. */
  effort?: "low" | "medium" | "high";
  /**
   * Fallback model used by Claude Code when the primary model is overloaded.
   */
  fallbackModel?: string;
  /**
   * Budget cap, in USD, passed through `--max-budget-usd`.
   */
  maxBudgetUsd?: number;
  /**
   * Claude model alias or fully-qualified model name.
   */
  model?: ClaudeCodeModel;
  /**
   * Claude Code permission mode.
   *
   * See `claude --help` for the current set of supported modes.
   */
  permissionMode?:
    | "default"
    | "plan"
    | "dontAsk"
    | "acceptEdits"
    | "bypassPermissions"
    | "auto";
  /**
   * Number of retries after a timeout (SIGTERM kill) or transient failure.
   * Total attempts = 1 + retries.
   */
  retries?: number;
  /**
   * Base delay between retries (ms). Uses simple linear backoff by attempt.
   */
  retryDelayMs?: number;
  /**
   * Replaces the default Claude system prompt.
   */
  systemPrompt?: string;
  /** Keep Claude Code session state after the invocation. Defaults to true. */
  sessionPersistence?: boolean;
  /**
   * Maximum time to allow the subprocess to run before attempting termination.
   */
  timeoutMs?: number;
  /**
   * Built-in tool configuration.
   *
   * `"default"` omits the flag and keeps the CLI's built-in tools. An empty string passes
   * an explicit empty tool set, or provide explicit tool names as supported by Claude Code.
   */
  tools?: string;
}

/**
 * Parsed JSON envelope returned by Claude Code when `--output-format json` is used.
 *
 * @typeParam TStructured - Shape of the `structured_output` field when structured
 * generation is requested.
 */
export interface ClaudeCodeEnvelope<TStructured> {
  is_error?: boolean;
  permission_denials?: unknown[];
  result?: string;
  session_id?: string;
  stop_reason?: string | null;
  structured_output?: TStructured;
  subtype?: string;
  total_cost_usd?: number;
  type?: string;
}

interface ClaudeCliError extends Error {
  aborted?: boolean;
  cause?: unknown;
  code?: number | string | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

/**
 * Conservative schema-argument transport limit used for Claude Code requests.
 * Prompts are supplied through stdin and therefore are not subject to argv limits.
 */
const MAX_CLAUDE_ARG_BYTES = 128 * 1024;

/**
 * Checks whether a value is a non-null, non-array object.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reduce Claude Code's stdout payload to the single envelope carrying the reply.
 *
 * The CLI emits either one envelope object or — since 2.1.x — an array of stream
 * events (`system`, `assistant`, `rate_limit_event`, `result`) with the reply on
 * the terminal `result` event. Both shapes are accepted so the wrapper keeps
 * working across CLI versions.
 *
 * @param payload - Parsed JSON value read from the CLI's stdout.
 * @returns The envelope carrying the reply, or `undefined` when the payload holds none.
 */
export function selectResultEnvelope(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (isRecord(payload)) {
    return payload;
  }
  if (!Array.isArray(payload)) {
    return undefined;
  }

  let lastRecord: Record<string, unknown> | undefined;
  for (const event of payload) {
    if (!isRecord(event)) {
      continue;
    }
    lastRecord = event;
  }

  for (let i = payload.length - 1; i >= 0; i--) {
    const event = payload[i];
    if (isRecord(event) && event.type === "result") {
      return event;
    }
  }

  return lastRecord;
}

/**
 * Validates that the schema payload is small enough to transport over argv.
 *
 * @param jsonSchema - Optional JSON schema string appended in structured mode.
 * @throws {Error} Thrown when the payload exceeds the conservative transport budget.
 */
function assertClaudeArgSize(jsonSchema?: string) {
  const schemaBytes = Buffer.byteLength(jsonSchema ?? "", "utf8");
  if (schemaBytes > MAX_CLAUDE_ARG_BYTES) {
    throw new Error(
      "claude CLI schema exceeds the safe argv transport limit; reduce the schema before calling this wrapper",
    );
  }
}

/**
 * Spawns Claude Code and captures stdout/stderr with timeout and max-buffer safeguards.
 *
 * This is a low-level helper used by the exported Claude wrappers. It is intentionally
 * not exported because callers are expected to use {@link claudeCodeText},
 * {@link claudeCodeStructured}, or the higher-level client factories instead.
 */
function spawnAsync(
  file: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    maxBufferBytes?: number;
    signal?: AbortSignal;
    stdin?: string;
    timeoutMs?: number;
  },
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
    let killedByAbort = false;
    let killedByTimeout = false;
    let timeout: NodeJS.Timeout | null = null;
    let hardKill: NodeJS.Timeout | null = null;

    const abort = () => {
      killedByAbort = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // The close/error handler owns settlement.
      }
    };

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (hardKill) {
        clearTimeout(hardKill);
        hardKill = null;
      }
      opts.signal?.removeEventListener("abort", abort);
    };

    const maybeKillOnBuffer = () => {
      if (stdout.length + stderr.length > maxBufferBytes) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        const e = new Error("claude CLI output exceeded maxBufferBytes");
        const error = e as ClaudeCliError;
        error.code = "MAXBUFFER";
        reject(error);
        cleanup();
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (d: string) => {
      stdout += d;
      maybeKillOnBuffer();
    });
    child.stderr?.on("data", (d: string) => {
      stderr += d;
      maybeKillOnBuffer();
    });

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        killedByTimeout = true;
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

    if (opts.signal?.aborted) {
      abort();
    } else {
      opts.signal?.addEventListener("abort", abort, { once: true });
    }

    child.on("error", (err) => {
      cleanup();
      const e = new Error(`claude CLI spawn error: ${String(err)}`);
      const error = e as ClaudeCliError;
      error.cause = err;
      reject(error);
    });

    child.on("close", (code, signal) => {
      cleanup();
      if (killedByAbort) {
        const error = new Error(
          "claude CLI invocation aborted",
        ) as ClaudeCliError;
        error.aborted = true;
        error.signal = signal;
        reject(error);
        return;
      }
      if (code !== 0) {
        const e = new Error(
          `claude CLI failed (code=${code ?? "?"}, signal=${
            signal ?? "?"
          }, killed=${killedByTimeout}): ${stderr || stdout}`,
        );
        const error = e as ClaudeCliError;
        error.code = code;
        error.signal = signal;
        error.killed = killedByTimeout;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin?.end(opts.stdin ?? "");
  });
}

/**
 * Produces a fully-populated Claude option object with package defaults applied.
 *
 * @param opts - Partial Claude Code configuration.
 * @returns A normalized options object where every field is defined.
 */
export function defaultClaudeOptions(
  opts?: ClaudeCodeOptions,
): Required<ClaudeCodeOptions> {
  return {
    claudePath: opts?.claudePath ?? "claude",
    cwd: opts?.cwd ?? process.cwd(),
    env: opts?.env ?? process.env,
    effort: opts?.effort ?? "high",
    model: opts?.model ?? "opus",
    maxBudgetUsd: opts?.maxBudgetUsd ?? 5,
    timeoutMs: opts?.timeoutMs ?? 120_000,
    retries: opts?.retries ?? 1,
    retryDelayMs: opts?.retryDelayMs ?? 800,
    permissionMode: opts?.permissionMode ?? "dontAsk",
    tools: opts?.tools ?? "default",
    systemPrompt: opts?.systemPrompt ?? "",
    sessionPersistence: opts?.sessionPersistence ?? true,
    appendSystemPrompt: opts?.appendSystemPrompt ?? "",
    allowedTools: opts?.allowedTools ?? [],
    disallowedTools: opts?.disallowedTools ?? [],
    fallbackModel: opts?.fallbackModel ?? "",
    betas: opts?.betas ?? [],
    agent: opts?.agent ?? "",
    agents: opts?.agents ?? "",
  };
}

/**
 * Builds the shared portion of the Claude Code CLI argument vector.
 *
 * This helper is exported primarily for tests and for advanced callers who want to inspect
 * exactly which flags this package will emit before spawning the subprocess.
 *
 * @param opts - Fully-resolved Claude Code options, usually from {@link defaultClaudeOptions}.
 * @returns CLI argument fragments that are common to both text and structured calls.
 */
export function buildBaseArgs(opts: Required<ClaudeCodeOptions>) {
  const args = [
    "--model",
    opts.model,
    "-p",
    "--permission-mode",
    opts.permissionMode,
  ];
  if (opts.tools !== "default") {
    args.push("--tools", opts.tools);
  }
  args.push("--effort", opts.effort);
  if (!opts.sessionPersistence) {
    args.push("--no-session-persistence");
  }
  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }
  if (opts.appendSystemPrompt) {
    args.push("--append-system-prompt", opts.appendSystemPrompt);
  }
  for (const t of opts.allowedTools) {
    args.push("--allowedTools", t);
  }
  for (const t of opts.disallowedTools) {
    args.push("--disallowedTools", t);
  }
  if (opts.fallbackModel) {
    args.push("--fallback-model", opts.fallbackModel);
  }
  for (const b of opts.betas) {
    args.push("--betas", b);
  }
  if (opts.agent) {
    args.push("--agent", opts.agent);
  }
  if (opts.agents) {
    args.push("--agents", opts.agents);
  }
  return args;
}

/**
 * Promise-based sleep helper used for linear retry backoff.
 */
function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    const abort = () => {
      clearTimeout(timeout);
      const error = new Error(
        "claude CLI invocation aborted",
      ) as ClaudeCliError;
      error.aborted = true;
      reject(error);
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Determines whether a failure was caused by a timeout-driven SIGTERM.
 */
function isTimeoutKill(err: unknown) {
  const e = err as ClaudeCliError | null;
  return Boolean(e && e.killed === true && e.signal === "SIGTERM");
}

/**
 * Executes Claude Code with retry behavior for timeout-driven termination.
 *
 * Retries are intentionally narrow: only failures recognized as timeout kills are retried.
 * Any other CLI or parsing failure is surfaced immediately.
 */
async function spawnWithRetry(
  options: Required<ClaudeCodeOptions>,
  cliArgs: string[],
  prompt: string,
  signal?: AbortSignal,
): Promise<{ attemptCount: number; stdout: string }> {
  let stdout: string | null = null;
  let lastErr: unknown = null;
  let attemptCount = 0;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    attemptCount = attempt + 1;
    try {
      ({ stdout } = await spawnAsync(options.claudePath, cliArgs, {
        cwd: options.cwd,
        env: options.env,
        signal,
        stdin: prompt,
        timeoutMs: options.timeoutMs,
      }));
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if ((e as ClaudeCliError).aborted) {
        throw e;
      }
      if (
        !isTimeoutKill((e as ClaudeCliError | null)?.cause ?? e) ||
        attempt >= options.retries
      ) {
        throw e;
      }
      const delay = options.retryDelayMs * (attempt + 1);
      await sleep(delay, signal);
    }
  }

  if (stdout == null) {
    throw lastErr instanceof Error ? lastErr : new Error("claude CLI failed");
  }

  return { attemptCount, stdout };
}

/**
 * Requests structured output from Claude Code using `--output-format json`.
 *
 * The function validates schema transport size, sends the prompt over stdin, parses the returned JSON
 * envelope, and throws when Claude signals an error envelope or emits malformed JSON.
 * Both CLI output shapes are accepted: a single envelope object, or an array of stream
 * events whose terminal `result` event carries the reply.
 *
 * @typeParam TStructured - Expected type of the parsed `structured_output` field.
 * @param args - Structured request configuration.
 * @param args.prompt - Prompt text to send to Claude Code.
 * @param args.jsonSchema - JSON schema string passed to `--json-schema`.
 * @param args.options - Optional Claude Code CLI configuration.
 * @returns The parsed Claude JSON envelope, including `structured_output`.
 *
 * @throws {Error}
 * Thrown when the schema is too large for argv transport, the subprocess fails,
 * the response is not valid JSON, or Claude returns an error envelope.
 */
export async function claudeCodeStructured<TStructured>(args: {
  prompt: string;
  jsonSchema: string;
  options?: ClaudeCodeOptions;
  signal?: AbortSignal;
}) {
  const options = defaultClaudeOptions(args.options);
  assertClaudeArgSize(args.jsonSchema);

  const cliArgs = [
    ...buildBaseArgs(options),
    "--max-budget-usd",
    String(options.maxBudgetUsd),
    "--output-format",
    "json",
    "--json-schema",
    args.jsonSchema,
  ];

  const { attemptCount, stdout } = await spawnWithRetry(
    options,
    cliArgs,
    args.prompt,
    args.signal,
  );

  let envelopeUnknown: unknown;
  try {
    envelopeUnknown = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(
      `claude CLI returned non-JSON output. First 200 chars:\n${stdout.slice(0, 200)}`,
    );
  }

  const selected = selectResultEnvelope(envelopeUnknown);
  if (!selected) {
    throw new Error(
      "claude CLI returned non-object JSON envelope: found neither an envelope object nor a terminal `result` event",
    );
  }

  const envelope = selected as ClaudeCodeEnvelope<TStructured>;
  if (envelope.is_error) {
    throw new Error(
      `claude CLI error envelope: ${envelope.subtype ?? "unknown"}`,
    );
  }

  return { ...envelope, attempt_count: attemptCount };
}

/**
 * Requests plain-text output from Claude Code.
 *
 * The wrapper prefers Claude's JSON envelope mode so it can detect structured CLI errors.
 * Both CLI output shapes are accepted: a single envelope object, or an array of stream
 * events whose terminal `result` event carries the reply. If the response cannot be parsed
 * as a JSON envelope, the raw stdout is returned as a fallback so callers can still work
 * with plain-text CLI output.
 *
 * @param args - Text request configuration.
 * @param args.prompt - Prompt text to send to Claude Code.
 * @param args.options - Optional Claude Code CLI configuration.
 * @returns An object containing the extracted text response.
 *
 * @throws {Error}
 * Thrown when the subprocess fails, the parsed
 * JSON envelope reports `is_error: true`, or the envelope carries no `result` field at all.
 * A missing `result` is treated as an error rather than an empty reply so that a breaking
 * CLI output change cannot degrade silently into empty text; an explicit empty string is
 * still returned as `""`.
 */
export async function claudeCodeText(args: {
  prompt: string;
  options?: ClaudeCodeOptions;
  signal?: AbortSignal;
}) {
  const options = defaultClaudeOptions(args.options);

  const cliArgs = [
    ...buildBaseArgs(options),
    "--max-budget-usd",
    String(options.maxBudgetUsd),
    "--output-format",
    "json",
  ];

  const { attemptCount, stdout } = await spawnWithRetry(
    options,
    cliArgs,
    args.prompt,
    args.signal,
  );

  let envelopeUnknown: unknown;
  try {
    envelopeUnknown = JSON.parse(stdout) as unknown;
  } catch {
    // fallback: if the user configured output-format defaults, just return the raw stdout
    return { attempt_count: attemptCount, text: stdout };
  }

  const selected = selectResultEnvelope(envelopeUnknown);
  if (!selected) {
    return { attempt_count: attemptCount, text: stdout };
  }

  const envelope = selected as ClaudeCodeEnvelope<unknown>;
  if (envelope.is_error) {
    throw new Error(
      `claude CLI error envelope: ${envelope.subtype ?? "unknown"}`,
    );
  }
  if (envelope.result === undefined) {
    throw new Error(
      `claude CLI returned an envelope with no \`result\` field (type=${
        envelope.type ?? "?"
      }, subtype=${envelope.subtype ?? "?"})`,
    );
  }
  return {
    attempt_count: attemptCount,
    text: envelope.result,
    total_cost_usd: envelope.total_cost_usd,
    session_id: envelope.session_id,
    stop_reason: envelope.stop_reason,
  };
}
