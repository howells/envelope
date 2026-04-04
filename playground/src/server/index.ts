import express from "express";
import { generateText, Output, jsonSchema } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { claudeCode, codex, gemini } from "@howells/envelope/ai-sdk";

const app = express();
app.use(express.json());

function makeModel(cli: string | undefined) {
  if (cli === "codex") {
    return codex("gpt-5.3-codex", {
      timeoutMs: 60_000,
      sandbox: "read-only",
    });
  }

  if (cli === "gemini") {
    return gemini("gemini-3-flash-preview", {
      timeoutMs: 60_000,
      approvalMode: "plan",
    });
  }

  return claudeCode("sonnet", { maxBudgetUsd: 1, timeoutMs: 60_000 });
}

function sendCliError(
  res: express.Response,
  cli: string | undefined,
  err: unknown
) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[envelope] ${cli} error:`, message);
  res.status(500).json({
    error: "CLI request failed",
    code: "CLI_REQUEST_FAILED",
    cli,
  });
}

app.post("/api/prompt", async (req, res) => {
  const { prompt, cli, outputType, schema } = req.body as {
    prompt?: string;
    cli?: string;
    outputType?: string;
    schema?: string;
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const model = makeModel(cli);

  if (outputType === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(schema ?? "{}");
    } catch {
      res.status(400).json({ error: "Invalid JSON schema" });
      return;
    }

    try {
      const result = await generateText({
        model,
        prompt,
        output: Output.object({ schema: jsonSchema(parsed as JSONSchema7) }),
      });

      res.json({ text: JSON.stringify(await result.output, null, 2), cli });
    } catch (err) {
      sendCliError(res, cli, err);
    }
    return;
  }

  try {
    const result = await generateText({ model, prompt });
    res.json({ text: result.text, cli });
  } catch (err) {
    sendCliError(res, cli, err);
  }
});

const HOST = "127.0.0.1";
const PORT = 3001;
app.listen(PORT, HOST, () => {
  console.log(`Envelope playground server listening on http://${HOST}:${PORT}`);
});
