import { useState } from "react";

type CliOption = "claude-code" | "codex";
type OutputType = "text" | "json";

const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      answer: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["answer", "confidence"],
  },
  null,
  2,
);

export function App() {
  const [prompt, setPrompt] = useState("");
  const [cli, setCli] = useState<CliOption>("claude-code");
  const [outputType, setOutputType] = useState<OutputType>("text");
  const [schema, setSchema] = useState(DEFAULT_SCHEMA);
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setResponse("");
    setError("");

    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          cli,
          outputType,
          ...(outputType === "json" ? { schema } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResponse(data.text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1>Envelope Playground</h1>
      <p className="subtitle">
        AI SDK 6 + <code>@howells/envelope</code>
      </p>

      <form onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt..."
          rows={4}
          disabled={loading}
        />

        <div className="controls">
          <select
            value={cli}
            onChange={(e) => setCli(e.target.value as CliOption)}
            disabled={loading}
          >
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex</option>
          </select>

          <div className="toggle">
            <button
              type="button"
              className={outputType === "text" ? "active" : ""}
              onClick={() => setOutputType("text")}
              disabled={loading}
            >
              Text
            </button>
            <button
              type="button"
              className={outputType === "json" ? "active" : ""}
              onClick={() => setOutputType("json")}
              disabled={loading}
            >
              JSON
            </button>
          </div>

          <button type="submit" disabled={loading || !prompt.trim()}>
            {loading ? "Running..." : "Send"}
          </button>
        </div>

        {outputType === "json" && (
          <textarea
            className="schema"
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            placeholder="JSON Schema..."
            rows={6}
            disabled={loading}
            spellCheck={false}
          />
        )}
      </form>

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {response && (
        <div className="response">
          <pre>{response}</pre>
        </div>
      )}
    </div>
  );
}
