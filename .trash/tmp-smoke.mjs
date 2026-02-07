import { z } from 'zod';
import { createEnvelope, createCodexClient } from './dist/index.js';

const fn = createEnvelope({
  client: createCodexClient({
    model: 'gpt-5.3-codex',
    options: {
      cwd: '/Users/danielhowells/Sites/envelope',
      skipGitRepoCheck: true,
    },
  }),
  input: z.object({ x: z.number() }),
  output: z.object({ y: z.number() }),
  prompt: ({ x }) => `Return ONLY JSON: {"y": ${x + 1}}`,
});

const out = await fn({ x: 2 });
console.log(JSON.stringify(out));
