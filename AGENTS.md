# envelope

Strict Zod IO wrapper around local CLI LLMs (Claude Code, Codex, Gemini), plus an AI SDK adapter. Published to npm as `@howells/envelope`. Tracker: Linear (howells, ENV).

```sh
pnpm dev        # playground
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Release: push a `vX.Y.Z` tag matching package.json; `.github/workflows/release.yml` publishes via npm trusted publishing (don't rename that file).

Don't overwrite others' uncommitted work. Run the tests that cover what you changed.
