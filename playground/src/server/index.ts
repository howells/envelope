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

  const tool = cli === "codex" ? "codex" : "claude-code";
  const model =
    tool === "codex"
      ? codex("gpt-5.3-codex", { timeoutMs: 60_000 })
      : claudeCode("sonnet", { maxBudgetUsd: 1, timeoutMs: 60_000 });

  try {
    if (outputType === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(schema ?? "{}");
      } catch {
        res.status(400).json({ error: "Invalid JSON schema" });
        return;
      }

      const result = await generateText({
        model,
        prompt,
        output: Output.object({ schema: jsonSchema(parsed as any) }),
      });

      res.json({ text: JSON.stringify(await result.output, null, 2), cli: tool });
    } else {
      const result = await generateText({ model, prompt });
      res.json({ text: result.text, cli: tool });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[envelope] ${tool} error:`, message);
    res.status(500).json({ error: message, cli: tool });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Envelope playground server listening on http://localhost:${PORT}`);
});
