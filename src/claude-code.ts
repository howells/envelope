import { spawn } from "node:child_process";

export type ClaudeCodeModel = string;

export interface ClaudeCodeOptions {
  claudePath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  model?: ClaudeCodeModel;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  /**
   * Number of retries after a timeout (SIGTERM kill) or transient failure.
   * Total attempts = 1 + retries.
   */
  retries?: number;
  /**
   * Base delay between retries (ms). Uses simple linear backoff by attempt.
   */
  retryDelayMs?: number;
  permissionMode?:
    | "default"
    | "plan"
    | "dontAsk"
    | "acceptEdits"
    | "bypassPermissions"
    | "delegate";
  tools?: string; // pass "" to disable tools
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  fallbackModel?: string;
  betas?: string[];
  agent?: string;
  agents?: string;
}

export interface ClaudeCodeEnvelope<TStructured> {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: TStructured;
  total_cost_usd?: number;
  stop_reason?: string | null;
  session_id?: string;
  permission_denials?: unknown[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

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
    const child = spawn(
      file,
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const maxBufferBytes = opts.maxBufferBytes ?? 128 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
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
        const e = new Error("claude CLI output exceeded maxBufferBytes");
        (e as any).code = "MAXBUFFER";
        reject(e);
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

    child.on("error", (err) => {
      cleanup();
      const e = new Error(`claude CLI spawn error: ${String(err)}`);
      (e as any).cause = err;
      reject(e);
    });

    child.on("close", (code, signal) => {
      cleanup();
      if (code !== 0) {
        const e = new Error(
          `claude CLI failed (code=${code ?? "?"}, signal=${
            signal ?? "?"
          }, killed=${killedByTimeout}): ${stderr || stdout}`
        );
        (e as any).code = code;
        (e as any).signal = signal;
        (e as any).killed = killedByTimeout;
        reject(e);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function defaultClaudeOptions(opts?: ClaudeCodeOptions): Required<ClaudeCodeOptions> {
  return {
    claudePath: opts?.claudePath ?? "claude",
    cwd: opts?.cwd ?? process.cwd(),
    env: opts?.env ?? process.env,
    model: opts?.model ?? "opus",
    maxBudgetUsd: opts?.maxBudgetUsd ?? 5,
    timeoutMs: opts?.timeoutMs ?? 120_000,
    retries: opts?.retries ?? 1,
    retryDelayMs: opts?.retryDelayMs ?? 800,
    permissionMode: opts?.permissionMode ?? "dontAsk",
    tools: opts?.tools ?? "",
    systemPrompt: opts?.systemPrompt ?? "",
    appendSystemPrompt: opts?.appendSystemPrompt ?? "",
    allowedTools: opts?.allowedTools ?? [],
    disallowedTools: opts?.disallowedTools ?? [],
    fallbackModel: opts?.fallbackModel ?? "",
    betas: opts?.betas ?? [],
    agent: opts?.agent ?? "",
    agents: opts?.agents ?? "",
  };
}

export function buildBaseArgs(opts: Required<ClaudeCodeOptions>) {
  const args = [
    "--model", opts.model,
    "-p",
    "--permission-mode", opts.permissionMode,
    "--tools", opts.tools,
  ];
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

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function isTimeoutKill(err: unknown) {
  const e = err as any;
  return Boolean(e && e.killed === true && e.signal === "SIGTERM");
}

export async function claudeCodeStructured<TStructured>(args: {
  prompt: string;
  jsonSchema: string;
  options?: ClaudeCodeOptions;
}) {
  const options = defaultClaudeOptions(args.options);

  const cliArgs = [
    ...buildBaseArgs(options),
    "--max-budget-usd",
    String(options.maxBudgetUsd),
    "--output-format",
    "json",
    "--json-schema",
    args.jsonSchema,
    args.prompt,
  ];

  let stdout: string | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      ({ stdout } = await spawnAsync(options.claudePath, cliArgs, {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs,
      }));
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      // Retry only if it's likely transient (timeout kill). Other errors should
      // generally be surfaced immediately to avoid masking real failures.
      if (!isTimeoutKill((e as any)?.cause ?? e) || attempt >= options.retries) {
        throw e;
      }
      const delay = options.retryDelayMs * (attempt + 1);
      await sleep(delay);
    }
  }

  if (stdout == null) {
    throw lastErr instanceof Error ? lastErr : new Error("claude CLI failed");
  }

  let envelopeUnknown: unknown;
  try {
    envelopeUnknown = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`claude CLI returned non-JSON output. First 200 chars:\n${stdout.slice(0, 200)}`);
  }

  if (!isRecord(envelopeUnknown)) {
    throw new Error("claude CLI returned non-object JSON envelope");
  }

  const envelope = envelopeUnknown as ClaudeCodeEnvelope<TStructured>;
  if (envelope.is_error) {
    throw new Error(`claude CLI error envelope: ${envelope.subtype ?? "unknown"}`);
  }

  return envelope;
}

export async function claudeCodeText(args: {
  prompt: string;
  options?: ClaudeCodeOptions;
}) {
  const options = defaultClaudeOptions(args.options);

  const cliArgs = [
    ...buildBaseArgs(options),
    "--max-budget-usd",
    String(options.maxBudgetUsd),
    "--output-format",
    "json",
    args.prompt,
  ];

  let stdout: string | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      ({ stdout } = await spawnAsync(options.claudePath, cliArgs, {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs,
      }));
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (!isTimeoutKill((e as any)?.cause ?? e) || attempt >= options.retries) {
        throw e;
      }
      const delay = options.retryDelayMs * (attempt + 1);
      await sleep(delay);
    }
  }

  if (stdout == null) {
    throw lastErr instanceof Error ? lastErr : new Error("claude CLI failed");
  }

  let envelopeUnknown: unknown;
  try {
    envelopeUnknown = JSON.parse(stdout) as unknown;
  } catch {
    // fallback: if the user configured output-format defaults, just return the raw stdout
    return { text: stdout };
  }

  if (!isRecord(envelopeUnknown)) {
    return { text: stdout };
  }

  const envelope = envelopeUnknown as ClaudeCodeEnvelope<unknown>;
  return { text: envelope.result ?? "" };
}
