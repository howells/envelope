import express from "express";
import { generateText, Output, jsonSchema } from "ai";
import { claudeCode, codex } from "@howells/envelope/ai-sdk";

const app = express();
app.use(express.json());

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

  const isCodex = cli === "codex";
  const model = isCodex
    ? codex("gpt-5.3-codex", { timeoutMs: 60_000 })
    : claudeCode("sonnet", { maxBudgetUsd: 1, timeoutMs: 60_000 });

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
        output: Output.object({ schema: jsonSchema(parsed as any) }),
      });

      res.json({ text: JSON.stringify(await result.output, null, 2), cli });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[envelope] ${cli} error:`, message);
      res.status(500).json({ error: message, cli });
    }
    return;
  }

  try {
    const result = await generateText({ model, prompt });
    res.json({ text: result.text, cli });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[envelope] ${cli} error:`, message);
    res.status(500).json({ error: message, cli });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Envelope playground server listening on http://localhost:${PORT}`);
});
