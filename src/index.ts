// Core API
export {
  createEnvelope,
  EnvelopeError,
  type CreateEnvelopeArgs,
} from "./envelope.js";

export {
  createClaudeCodeClient,
  createCodexClient,
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
