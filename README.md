# envelope

Thin wrapper around the `claude` (Claude Code) and `codex` (Codex CLI) for **strict** Zod-validated input/output.

This is designed for local Node apps where you want "model calls" to look like a normal API:
- validate inputs with Zod
- request structured JSON output via `--json-schema` / `--output-schema`
- validate outputs with Zod again (defense in depth)

## Install

```bash
npm install @howells/envelope
```

## Requirements

- Node 20+
- `claude` CLI installed and authenticated (Claude Code), or
- `codex` CLI installed and authenticated (Codex)

## Claude Code Options

### `createClaudeCodeClient()`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"opus"` | Model name passed to `--model` |
| `maxBudgetUsd` | `number` | `5` | Spend cap per call via `--max-budget-usd` |
| `timeoutMs` | `number` | `120_000` | Kill the process after this many ms |
| `options.claudePath` | `string` | `"claude"` | Path to the `claude` binary |
| `options.cwd` | `string` | `process.cwd()` | Working directory for the subprocess |
| `options.env` | `NodeJS.ProcessEnv` | `process.env` | Environment variables for the subprocess |
| `options.permissionMode` | `string` | `"dontAsk"` | One of `"default"`, `"plan"`, `"dontAsk"`, `"acceptEdits"`, `"bypassPermissions"`, `"delegate"` |
| `options.tools` | `string` | `""` | Tools flag; `""` disables all, `"default"` enables built-ins |
| `options.systemPrompt` | `string` | — | Full system prompt via `--system-prompt` |
| `options.appendSystemPrompt` | `string` | — | Appended system prompt via `--append-system-prompt` |
| `options.allowedTools` | `string[]` | `[]` | Repeated `--allowedTools` per entry |
| `options.disallowedTools` | `string[]` | `[]` | Repeated `--disallowedTools` per entry |
| `options.fallbackModel` | `string` | — | Fallback model via `--fallback-model` |
| `options.betas` | `string[]` | `[]` | Repeated `--betas` per entry |
| `options.agent` | `string` | — | Agent name via `--agent` |
| `options.agents` | `string` | — | Agents directory via `--agents` |
| `options.retries` | `number` | `1` | Retries after timeout kill (total attempts = 1 + retries) |
| `options.retryDelayMs` | `number` | `800` | Base delay between retries (linear backoff) |

Note: `total_cost_usd` is reported by the Claude Code CLI. If you're using a subscription plan, this may be an estimate and not necessarily an incremental billed amount.

## Codex Options

### `createCodexClient()`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"gpt-5.3-codex"` | Model name passed to `--model` |
| `timeoutMs` | `number` | `180_000` | Kill the process after this many ms |
| `options.codexPath` | `string` | `"codex"` | Path to the `codex` binary |
| `options.cwd` | `string` | `process.cwd()` | Working directory for the subprocess |
| `options.env` | `NodeJS.ProcessEnv` | `process.env` | Environment variables for the subprocess |
| `options.skipGitRepoCheck` | `boolean` | `true` | Skip git repo validation via `--skip-git-repo-check` |
| `options.sandbox` | `string` | `"danger-full-access"` | One of `"read-only"`, `"workspace-write"`, `"danger-full-access"` |
| `options.profile` | `string` | — | Profile name via `--profile` |
| `options.config` | `string[]` | `[]` | Repeated `--config key=value` per entry |
| `options.jsonlEvents` | `boolean` | `false` | Enable JSONL event output via `--json` |
| `options.image` | `string[]` | `[]` | Repeated `--image path` per entry |

## Usage (Zod envelope)

```ts
import { z } from "zod";
import {
  createEnvelope,
  createClaudeCodeClient,
  createCodexClient,
} from "@howells/envelope";

const summarizeClaude = createEnvelope({
  client: createClaudeCodeClient({ model: "opus", maxBudgetUsd: 2 }),
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ summary: z.string().min(1) }),
  prompt: ({ text }) =>
    `Summarize this in 1 sentence. Return JSON only: ${JSON.stringify({ text })}`,
});

const summarizeCodex = createEnvelope({
  client: createCodexClient({ model: "gpt-5.3-codex" }),
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ summary: z.string().min(1) }),
  prompt: ({ text }) =>
    `Summarize this in 1 sentence. Return JSON only: ${JSON.stringify({ text })}`,
});

const out = await summarizeClaude({ text: "..." });
console.log(out.summary);
```

## Usage (AI SDK 6)

```ts
import { generateText } from "ai";
import { claudeCode, codex } from "@howells/envelope/ai-sdk";

const { text } = await generateText({
  model: claudeCode("opus"),
  prompt: "Write a haiku about camellias.",
});

const r2 = await generateText({
  model: codex("gpt-5.3-codex"),
  prompt: "Write a haiku about camellias.",
});
```

Structured JSON output is also supported via `Output.object()`:

```ts
import { generateText, Output, jsonSchema } from "ai";
import { claudeCode } from "@howells/envelope/ai-sdk";

const { output } = await generateText({
  model: claudeCode("sonnet"),
  prompt: "List three colours and their hex codes.",
  output: Output.object({
    schema: jsonSchema({
      type: "object",
      properties: {
        colours: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              hex: { type: "string" },
            },
            required: ["name", "hex"],
          },
        },
      },
      required: ["colours"],
    }),
  }),
});
```

Notes:
- The adapter uses single-shot calls under the hood (streaming is simulated).
- If we want true streaming, we can extend it to use `claude --output-format stream-json`.
