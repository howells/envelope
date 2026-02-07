import { z } from "zod";
import type { CliClient } from "./client.js";
import { createClaudeCodeClient, jsonSchemaFromZod } from "./client.js";

export class EnvelopeError extends Error {
  override name = "EnvelopeError";
}

export interface CreateEnvelopeArgs<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny> {
  input: TIn;
  output: TOut;
  prompt: (input: z.infer<TIn>) => string;
  client?: CliClient;
}

export function createEnvelope<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
  args: CreateEnvelopeArgs<TIn, TOut>
) {
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
