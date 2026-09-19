# Envelope

`@howells/envelope`, a published MIT package. A strict Zod IO wrapper around local CLI LLMs - `claude` (Claude Code), `codex`, `gemini` - plus an AI SDK provider adapter. Validate the input with Zod, ask the CLI for structured JSON through `--json-schema` or `--output-schema`, then validate the output with Zod again.

## Layout

`src/` is the package, one file per client (`claude-code.ts`, `codex-cli.ts`, `gemini-cli.ts`, plus `envelope.ts`, `client.ts`, `ai-sdk.ts`), each with a colocated `.test.ts`. `playground/` is a Vite client and an Express server for driving it by hand, and isn't published.

## Commands

- `pnpm check` - typecheck, lint, test.
- `pnpm dev` - the playground.
- `pnpm knip` - dead exports.

## Rules

- Only `dist` is published, and `prepack` builds it. The subpath exports are `.` and `./ai-sdk`; a third one has to be added to both `exports` and `files`.
- `zod` is a peer dependency. Never import it as a runtime dependency of the package.
- Each client shells out to a CLI the user has to have installed and authenticated. Tests fake the subprocess, and there are no live model calls.

Linear: team ENV (Howells).
