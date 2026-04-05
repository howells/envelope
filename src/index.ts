/**
 * Public entry point for the `@howells/envelope` package.
 *
 * The package exposes three layers:
 *
 * - the high-level envelope API for validated input/output model calls,
 * - normalized Claude Code, Codex, and Gemini client factories, and
 * - low-level CLI wrappers for callers that need direct access to the subprocess semantics.
 */
// Core API

// CLI-level API (for power users who need direct CLI access)
export {
  type ClaudeCodeOptions,
  claudeCodeStructured,
  claudeCodeText,
} from "./claude-code.js";

export {
  type CliClient,
  type CliResultMeta,
  type CliTool,
  createClaudeCodeClient,
  createCodexClient,
  createGeminiClient,
  type GenerateStructuredArgs,
  type GenerateTextArgs,
  jsonSchemaFromZod,
} from "./client.js";
export {
  type CodexOptions,
  codexStructured,
  codexText,
} from "./codex-cli.js";
export {
  type CreateEnvelopeArgs,
  createEnvelope,
  EnvelopeError,
} from "./envelope.js";

export {
  buildGeminiArgs,
  defaultGeminiOptions,
  type GeminiOptions,
  geminiStructured,
  geminiText,
} from "./gemini-cli.js";
