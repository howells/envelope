# envelope

Thin wrapper around the `claude` (Claude Code), `codex` (Codex CLI), and `gemini` (Gemini CLI) for **strict** Zod-validated input/output.

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
- `codex` CLI installed and authenticated (Codex), or
- `gemini` CLI installed and authenticated (Gemini CLI)

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
| `options.permissionMode` | `string` | `"dontAsk"` | One of `"default"`, `"plan"`, `"dontAsk"`, `"acceptEdits"`, `"bypassPermissions"`, `"auto"` |
| `options.tools` | `string` | `""` | Tools flag; `""` (default) omits the flag entirely, `"default"` enables built-ins |
| `options.systemPrompt` | `string` | — | Full system prompt via `--system-prompt` |
| `options.appendSystemPrompt` | `string` | — | Appended system prompt via `--append-system-prompt` |
| `options.allowedTools` | `string[]` | `[]` | Repeated `--allowedTools` per entry |
| `options.disallowedTools` | `string[]` | `[]` | Repeated `--disallowedTools` per entry |
| `options.fallbackModel` | `string` | — | Fallback model via `--fallback-model` |
| `options.betas` | `string[]` | `[]` | Repeated `--betas` per entry |
| `options.agent` | `string` | — | Agent name via `--agent` |
| `options.agents` | `string` | — | JSON object string for custom agents via `--agents` |
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
| `options.sandbox` | `string` | `"workspace-write"` | One of `"read-only"`, `"workspace-write"`, `"danger-full-access"` |
| `options.profile` | `string` | — | Profile name via `--profile` |
| `options.config` | `string[]` | `[]` | Repeated `--config key=value` per entry |
| `options.jsonlEvents` | `boolean` | `false` | Enable JSONL event output via `--json` |
| `options.image` | `string[]` | `[]` | Repeated `--image path` per entry |

## Gemini Options

### `createGeminiClient()`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"gemini-3-flash-preview"` | Model name passed to `--model` |
| `timeoutMs` | `number` | `180_000` | Kill the process after this many ms |
| `options.geminiPath` | `string` | `"gemini"` | Path to the `gemini` binary |
| `options.cwd` | `string` | `process.cwd()` | Working directory for the subprocess |
| `options.env` | `NodeJS.ProcessEnv` | `process.env` | Environment variables for the subprocess |
| `options.approvalMode` | `string` | `"plan"` | One of `"default"`, `"auto_edit"`, `"yolo"`, `"plan"` |
| `options.sandbox` | `boolean` | `false` | Enable Gemini sandbox mode |
| `options.debug` | `boolean` | `false` | Enable Gemini debug mode |
| `options.policy` | `string[]` | `[]` | Repeated `--policy path` per entry |
| `options.adminPolicy` | `string[]` | `[]` | Repeated `--admin-policy path` per entry |
| `options.extensions` | `string[]` | `[]` | Repeated `--extensions name` per entry |
| `options.includeDirectories` | `string[]` | `[]` | Repeated `--include-directories path` per entry |

Note: Gemini does not currently expose a native JSON-schema flag in its CLI. Envelope's Gemini structured mode embeds the JSON Schema into the prompt, parses the returned JSON strictly, and then validates it again with Zod.

Tracking native schema support upstream:
- https://github.com/google-gemini/gemini-cli/issues/13388
- https://github.com/google-gemini/gemini-cli/issues/5021

## Usage (Zod envelope)

```ts
import { z } from "zod";
import {
  createEnvelope,
  createClaudeCodeClient,
  createCodexClient,
  createGeminiClient,
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

const summarizeGemini = createEnvelope({
  client: createGeminiClient({ model: "gemini-3-flash-preview" }),
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
import { claudeCode, codex, gemini } from "@howells/envelope/ai-sdk";

const { text } = await generateText({
  model: claudeCode("opus"),
  prompt: "Write a haiku about camellias.",
});

const r2 = await generateText({
  model: codex("gpt-5.3-codex"),
  prompt: "Write a haiku about camellias.",
});

const r3 = await generateText({
  model: gemini("gemini-3-flash-preview"),
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
- Codex defaults to `workspace-write`; opt into `danger-full-access` explicitly when you really need it.
- Gemini defaults to `approvalMode: "plan"` so the CLI stays in a read-only posture unless you opt into a more permissive mode.
- Gemini structured output is prompt-guided rather than CLI-schema-native, so strict Zod validation after parsing matters even more there.
