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
export {
  createEnvelope,
  EnvelopeError,
  type CreateEnvelopeArgs,
} from "./envelope.js";

export {
  createClaudeCodeClient,
  createCodexClient,
  createGeminiClient,
  jsonSchemaFromZod,
  type CliClient,
  type CliTool,
  type GenerateTextArgs,
  type GenerateStructuredArgs,
} from "./client.js";

// CLI-level API (for power users who need direct CLI access)
export {
  claudeCodeStructured,
  claudeCodeText,
  type ClaudeCodeOptions,
} from "./claude-code.js";

export {
  codexStructured,
  codexText,
  type CodexOptions,
} from "./codex-cli.js";

export {
  buildGeminiArgs,
  defaultGeminiOptions,
  geminiStructured,
  geminiText,
  type GeminiOptions,
} from "./gemini-cli.js";
