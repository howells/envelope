import { execFile } from "node:child_process";

export type ClaudeCodeModel = string;

export interface ClaudeCodeOptions {
  claudePath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  model?: ClaudeCodeModel;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  permissionMode?: "dontAsk" | "default" | "bypassPermissions";
  tools?: string; // pass "" to disable tools
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

function execFileAsync(
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        maxBuffer: 128 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            `claude CLI failed (code=${(err as any).code ?? "?"}): ${stderr || stdout}`
          );
          (e as any).cause = err;
          reject(e);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function buildBaseArgs(opts: Required<Pick<ClaudeCodeOptions, "model" | "permissionMode" | "tools">>) {
  return ["--model", opts.model, "-p", "--permission-mode", opts.permissionMode, "--tools", opts.tools];
}

export async function claudeCodeStructured<TStructured>(args: {
  prompt: string;
  jsonSchema: string;
  options?: ClaudeCodeOptions;
}) {
  const options: Required<ClaudeCodeOptions> = {
    claudePath: args.options?.claudePath ?? "claude",
    cwd: args.options?.cwd ?? process.cwd(),
    env: args.options?.env ?? process.env,
    model: args.options?.model ?? "opus",
    maxBudgetUsd: args.options?.maxBudgetUsd ?? 5,
    timeoutMs: args.options?.timeoutMs ?? 120_000,
    permissionMode: args.options?.permissionMode ?? "dontAsk",
    tools: args.options?.tools ?? "",
  };

  const { stdout } = await execFileAsync(
    options.claudePath,
    [
      ...buildBaseArgs(options),
      "--max-budget-usd",
      String(options.maxBudgetUsd),
      "--output-format",
      "json",
      "--json-schema",
      args.jsonSchema,
      args.prompt,
    ],
    { cwd: options.cwd, env: options.env, timeoutMs: options.timeoutMs }
  );

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
  const options: Required<ClaudeCodeOptions> = {
    claudePath: args.options?.claudePath ?? "claude",
    cwd: args.options?.cwd ?? process.cwd(),
    env: args.options?.env ?? process.env,
    model: args.options?.model ?? "opus",
    maxBudgetUsd: args.options?.maxBudgetUsd ?? 5,
    timeoutMs: args.options?.timeoutMs ?? 120_000,
    permissionMode: args.options?.permissionMode ?? "dontAsk",
    tools: args.options?.tools ?? "",
  };

  const { stdout } = await execFileAsync(
    options.claudePath,
    [
      ...buildBaseArgs(options),
      "--max-budget-usd",
      String(options.maxBudgetUsd),
      "--output-format",
      "json",
      args.prompt,
    ],
    { cwd: options.cwd, env: options.env, timeoutMs: options.timeoutMs }
  );

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

