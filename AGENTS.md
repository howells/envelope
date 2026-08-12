# Envelope

`@howells/envelope`, a published MIT package. A strict Zod IO wrapper around local CLI LLMs - `claude` (Claude Code), `codex`, `gemini` - plus an AI SDK v3 provider adapter. Validate the input with Zod, ask the CLI for structured JSON via `--json-schema` / `--output-schema`, validate the output with Zod again.

- Turborepo + pnpm. `src/` is the package (one file per client: `claude-code.ts`, `codex-cli.ts`, `gemini-cli.ts`, plus `envelope.ts`, `client.ts`, `ai-sdk.ts`), each with a colocated `.test.ts`. `playground/` is a Vite client plus an Express/tsx server for driving it by hand, and is not published.
- `pnpm check` runs typecheck + lint + test; `pnpm dev` runs the playground; `pnpm knip` checks for dead exports. Lint and format come from `@howells/lint` (`howells-format`).
- Only `dist` is published, and `prepack` builds it. Subpath exports are `.` and `./ai-sdk` - adding a third means adding it to `exports` and to `files`.
- `zod@^4` is a peer dependency, so never import it as a runtime dependency of the package.
- Each client shells out to a CLI the user must have installed and authenticated. Tests fake the subprocess; there are no live model calls.
