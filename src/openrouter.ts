import type { JSONSchema7 } from "@ai-sdk/provider";

import type {
  CliClient,
  CliResultMeta,
  GenerateStructuredArgs,
  GenerateTextArgs,
} from "./client.js";

/**
 * Hosted models over OpenRouter, wearing the same {@link CliClient} interface as
 * the local CLIs.
 *
 * Every other client in this package shells out to a binary the user has already
 * authenticated. That is the right default — it spends a subscription rather
 * than metered credits — but it leaves a caller stranded when the local CLIs are
 * exhausted or unavailable, which is exactly when a second opinion matters most.
 * Wearing the same interface means the receipted envelope, the profile identity
 * and the failure classification all work unchanged.
 *
 * The API key is a parameter rather than an environment read: this is a library,
 * and reaching into `process.env` from inside one hides where a credential came
 * from. The caller owns its own env boundary.
 */
export interface OpenRouterOptions {
  /** Sent as `HTTP-Referer`, which OpenRouter uses for attribution. */
  appUrl?: string;
  /** Sent as `X-Title`, which labels the call in OpenRouter's dashboard. */
  appTitle?: string;
  /** Overrides the API base, for a proxy or a compatible gateway. */
  baseUrl?: string;
  /** Caps sampling randomness. Left unset, the provider default applies. */
  temperature?: number;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  error?: { code?: number | string; message?: string };
  model?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

/** Strict mode rejects a schema that would let a model invent extra keys, and
 *  Zod's JSON Schema output does not always close the object. Closing it here
 *  keeps `strict: true` usable instead of silently failing at the provider. */
function closeSchema(schema: JSONSchema7): JSONSchema7 {
  if (schema.type !== "object") {
    return schema;
  }
  return { additionalProperties: false, ...schema };
}

function extractMeta(payload: ChatCompletionResponse): CliResultMeta {
  return {
    attemptCount: 1,
    ...(payload.model ? { resolvedModel: payload.model } : {}),
    ...(payload.choices?.[0]?.finish_reason !== undefined
      ? { stopReason: payload.choices[0]?.finish_reason ?? null }
      : {}),
    ...(payload.usage
      ? {
          tokenUsage: {
            ...(payload.usage.prompt_tokens !== undefined
              ? { input: payload.usage.prompt_tokens }
              : {}),
            ...(payload.usage.completion_tokens !== undefined
              ? { output: payload.usage.completion_tokens }
              : {}),
            ...(payload.usage.total_tokens !== undefined
              ? { total: payload.usage.total_tokens }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Creates a hosted OpenRouter client.
 *
 * @param args.apiKey - OpenRouter key. Required, and never read from the environment.
 * @param args.model - OpenRouter model id, e.g. `"z-ai/glm-4.7"`.
 */
export function createOpenRouterClient(args: {
  apiKey: string;
  model: string;
  options?: OpenRouterOptions;
  profileId?: string;
  timeoutMs?: number;
}): CliClient {
  const { apiKey, model } = args;
  const timeoutMs = args.timeoutMs ?? 180_000;
  const baseUrl = args.options?.baseUrl ?? DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error(
      "openrouter client requires an apiKey; pass it explicitly from the caller's env boundary",
    );
  }

  async function call(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        body: JSON.stringify({ model, ...body }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(args.options?.appUrl
            ? { "HTTP-Referer": args.options.appUrl }
            : {}),
          ...(args.options?.appTitle
            ? { "X-Title": args.options.appTitle }
            : {}),
        },
        method: "POST",
        signal: controller.signal,
      });

      const payload = (await response.json()) as ChatCompletionResponse;

      if (!response.ok || payload.error) {
        // 429 and the provider's own wording both reach classifyInvocationFailure,
        // which is what lets a caller route to another provider rather than retry.
        throw new Error(
          `openrouter request failed (status=${response.status}): ${
            payload.error?.message ?? response.statusText
          }`,
        );
      }
      return payload;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new Error(`openrouter request timedOut after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    model,
    ...(args.profileId ? { profileId: args.profileId } : {}),
    tool: "openrouter",
    async structured<T>(input: GenerateStructuredArgs) {
      const payload = await call(
        {
          messages: [{ content: input.prompt, role: "user" }],
          response_format: {
            json_schema: {
              name: "structured_output",
              schema: closeSchema(input.jsonSchema),
              strict: true,
            },
            type: "json_schema",
          },
          ...(args.options?.temperature !== undefined
            ? { temperature: args.options.temperature }
            : {}),
        },
        input.signal,
      );

      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(
          "openrouter returned no content for a structured request",
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        throw new Error(
          "openrouter returned a structured response that is not JSON",
          {
            cause: error,
          },
        );
      }
      return { meta: extractMeta(payload), structured: parsed as T };
    },
    async text(input: GenerateTextArgs) {
      const payload = await call(
        { messages: [{ content: input.prompt, role: "user" }] },
        input.signal,
      );
      const content = payload.choices?.[0]?.message?.content;
      if (content == null) {
        throw new Error("openrouter returned no content");
      }
      return { meta: extractMeta(payload), text: content };
    },
  };
}

/**
 * Stateless hosted profile for processing untrusted evidence.
 *
 * A hosted chat completion has no tools, no filesystem and no session unless the
 * caller adds them, so the safety properties the local safe profiles have to
 * configure are the default here. The profile exists so a receipt can still name
 * what ran, and so callers can choose it by intent rather than by remembering
 * which options to pass.
 */
export function createSafeOpenRouterClient(args: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): CliClient {
  return createOpenRouterClient({
    apiKey: args.apiKey,
    model: args.model,
    options: { temperature: 0 },
    profileId: "openrouter-stateless-v1",
    timeoutMs: args.timeoutMs,
  });
}
