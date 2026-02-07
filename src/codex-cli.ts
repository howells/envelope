import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CodexModel = string;

export interface CodexOptions {
  codexPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  model?: CodexModel;
  timeoutMs?: number;
  skipGitRepoCheck?: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  profile?: string;
  config?: Array<string>; // ["key=value", ...]
  jsonlEvents?: boolean; // --json
  image?: string[];
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
            `codex CLI failed (code=${(err as any).code ?? "?"}): ${stderr || stdout}`
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

export function defaultOptions(opts?: CodexOptions): Required<CodexOptions> {
  return {
    codexPath: opts?.codexPath ?? "codex",
    cwd: opts?.cwd ?? process.cwd(),
    env: opts?.env ?? process.env,
    model: opts?.model ?? "gpt-5.3-codex",
    timeoutMs: opts?.timeoutMs ?? 180_000,
    skipGitRepoCheck: opts?.skipGitRepoCheck ?? true,
    sandbox: opts?.sandbox ?? "danger-full-access",
    profile: opts?.profile ?? "",
    config: opts?.config ?? [],
    jsonlEvents: opts?.jsonlEvents ?? false,
    image: opts?.image ?? [],
  };
}

export async function codexText(args: { prompt: string; options?: CodexOptions }) {
  const options = defaultOptions(args.options);

  const td = await mkdtemp(join(tmpdir(), "envelope-codex-"));
  try {
    const outPath = join(td, "last.txt");
    const cliArgs = [
      ...baseArgs(options),
      "--output-last-message",
      outPath,
      args.prompt,
    ];

    await execFileAsync(options.codexPath, cliArgs, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
    });

    const text = await readFile(outPath, "utf8");
    return { text };
  } finally {
    await rm(td, { recursive: true, force: true });
  }
}

export async function codexStructured<TStructured>(args: {
  prompt: string;
  jsonSchema: string;
  options?: CodexOptions;
}) {
  const options = defaultOptions(args.options);

  const td = await mkdtemp(join(tmpdir(), "envelope-codex-"));
  try {
    const schemaPath = join(td, "schema.json");
    const outPath = join(td, "last.txt");

    await writeFile(schemaPath, args.jsonSchema, "utf8");

    const cliArgs = [
      ...baseArgs(options),
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outPath,
      args.prompt,
    ];

    await execFileAsync(options.codexPath, cliArgs, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
    });

    const raw = await readFile(outPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`codex output was not JSON. First 200 chars:\n${raw.slice(0, 200)}`);
    }

    return { structured: parsed as TStructured, raw };
  } finally {
    await rm(td, { recursive: true, force: true });
  }
}
