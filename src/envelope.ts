import type { z } from "zod";
import type { CliClient } from "./client.js";
import { createClaudeCodeClient, jsonSchemaFromZod } from "./client.js";

/**
 * Error thrown by {@link createEnvelope} when either:
 *
 * - the caller supplies invalid input for the declared input schema, or
 * - the underlying model returns data that fails the declared output schema.
 *
 * This keeps validation failures distinct from lower-level transport failures such as
 * missing CLIs, subprocess timeouts, or CLI-specific error envelopes.
 */
export class EnvelopeError extends Error {
  override name = "EnvelopeError";
}

/**
 * Configuration object for {@link createEnvelope}.
 *
 * The envelope pattern wraps a prompt-producing function with a pair of Zod schemas:
 * one schema validates caller input before the model is invoked, and the other validates
 * the model's structured response before it is returned to the caller.
 *
 * @typeParam TIn - Zod schema describing the accepted caller input.
 * @typeParam TOut - Zod schema describing the validated model output.
 */
export interface CreateEnvelopeArgs<
  TIn extends z.ZodTypeAny,
  TOut extends z.ZodTypeAny,
> {
  /**
   * Schema used to validate the value passed into the generated function.
   *
   * The parsed result of this schema is passed to {@link prompt}.
   */
  input: TIn;
  /**
   * Schema used to validate the model's structured response before returning it.
   *
   * The schema is converted to JSON Schema once at envelope creation time.
   */
  output: TOut;
  /**
   * Prompt factory that receives the already-validated input and returns the prompt
   * string that should be sent to the underlying CLI client.
   */
  prompt: (input: z.infer<TIn>) => string;
  /**
   * Optional client implementation used to execute the prompt.
   *
   * When omitted, the envelope uses {@link createClaudeCodeClient}, making Claude Code
   * the default backend for the high-level API.
   */
  client?: CliClient;
}

/**
 * Creates a validated model call that behaves like a normal async function.
 *
 * The returned function:
 *
 * 1. validates the raw caller input against {@link CreateEnvelopeArgs.input},
 * 2. builds a prompt from the parsed input,
 * 3. requests structured output from the configured CLI client, and
 * 4. validates the structured output against {@link CreateEnvelopeArgs.output}.
 *
 * This is the highest-level API in the package and is intended for application code
 * that wants a strongly-typed "function call" abstraction over local LLM CLIs.
 *
 * @typeParam TIn - Zod schema describing the accepted caller input.
 * @typeParam TOut - Zod schema describing the validated model output.
 * @param args - Envelope configuration containing schemas, prompt factory, and optional client.
 * @returns An async function that accepts unknown input and resolves with validated output.
 *
 * @throws {EnvelopeError}
 * Thrown when the raw input fails validation or when the model returns structured output
 * that does not satisfy the declared output schema.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createEnvelope } from "@howells/envelope";
 *
 * const summarize = createEnvelope({
 *   input: z.object({ text: z.string().min(1) }),
 *   output: z.object({ summary: z.string().min(1) }),
 *   prompt: ({ text }) => `Summarize this text: ${text}`,
 * });
 *
 * const result = await summarize({ text: "Envelope wraps CLI models safely." });
 * console.log(result.summary);
 * ```
 */
export function createEnvelope<
  TIn extends z.ZodTypeAny,
  TOut extends z.ZodTypeAny,
>(args: CreateEnvelopeArgs<TIn, TOut>) {
  const jsonSchema = jsonSchemaFromZod(args.output);
  const client = args.client ?? createClaudeCodeClient();

  return async (inputRaw: unknown): Promise<z.infer<TOut>> => {
    const input = args.input.safeParse(inputRaw);
    if (!input.success) {
      throw new EnvelopeError(input.error.message);
    }

    const prompt = args.prompt(input.data);
    const res = await client.structured<unknown>({ prompt, jsonSchema });
    const output = args.output.safeParse(res.structured);
    if (!output.success) {
      throw new EnvelopeError(
        `Model returned invalid structured output:\n${output.error.message}`
      );
    }
    return output.data;
  };
}
