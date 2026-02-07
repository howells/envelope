# envelope

Thin wrapper around the `claude` (Claude Code) CLI for **strict** Zod-validated input/output.

This is designed for local Node apps where you want "model calls" to look like a normal API:
- validate inputs with Zod
- request structured JSON output via `--json-schema`
- validate outputs with Zod again (defense in depth)

## Requirements

- Node 20+
- `claude` CLI installed and authenticated (Claude Code)

## Usage (Zod envelope)

```ts
import { z } from "zod";
import { createEnvelope, createClaudeCodeClient, createCodexClient } from "envelope";

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
import { claudeCode, codex } from "envelope/ai-sdk";

const { text } = await generateText({
  model: claudeCode("opus"),
  prompt: "Write a haiku about camellias.",
});

const r2 = await generateText({
  model: codex("gpt-5.3-codex"),
  prompt: "Write a haiku about camellias.",
});
```

Notes:
- Current adapter is text-only and uses a single-shot call under the hood.
- If we want true streaming, we can extend it to use `claude --output-format stream-json`.
