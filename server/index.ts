import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const PREDICTION_SERVER_URL = process.env.PREDICTION_SERVER_URL || 'http://localhost:8000';
const TIMEOUT_MS = 30_000;

// CORS
app.use(cors());

// JSON body parsing
app.use(express.json());

// Request / response logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  console.log(`--> ${req.method} ${req.path}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`<-- ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function forwardPost(targetPath: string, body: unknown): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(`${PREDICTION_SERVER_URL}${targetPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function handleProxyError(err: unknown, res: Response) {
  if (err instanceof Error && err.name === 'AbortError') {
    res.status(504).json({ error: 'Request to prediction server timed out' });
  } else {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Proxy error:', message);
    res.status(502).json({ error: 'Failed to reach prediction server' });
  }
}

// ---------------------------------------------------------------------------
// Proxy pass-through endpoints
// ---------------------------------------------------------------------------

const PROXY_PATHS = ['/api/tokenize/', '/api/generate/', '/api/decode/'] as const;

for (const proxyPath of PROXY_PATHS) {
  const upstream = proxyPath.replace(/^\/api/, ''); // e.g. /tokenize/
  app.post(proxyPath, async (req: Request, res: Response) => {
    try {
      const upstream_res = await forwardPost(upstream, req.body);
      const data = await upstream_res.json();
      res.status(upstream_res.status).json(data);
    } catch (err) {
      handleProxyError(err, res);
    }
  });
}

// ---------------------------------------------------------------------------
// /api/chat  --  orchestrated endpoint
// ---------------------------------------------------------------------------

interface ChatRequest {
  message: string;
  model_id: string;
  block_size: number;
  max_new_tokens: number;
  temperature: number;
  top_k?: number;
}

app.post('/api/chat', async (req: Request, res: Response) => {
  const { message, model_id, block_size, max_new_tokens, temperature, top_k } =
    req.body as ChatRequest;

  if (!message || !model_id) {
    res.status(400).json({ error: 'message and model_id are required' });
    return;
  }

  try {
    // 1. Tokenize
    const tokenizeRes = await forwardPost('/tokenize/', {
      encoding: 'gpt2',
      text: message,
    });
    if (!tokenizeRes.ok) {
      res.status(tokenizeRes.status).json({ error: 'Tokenization failed' });
      return;
    }
    const tokenized = (await tokenizeRes.json()) as { tokens: number[] };

    // 2. Generate
    const generateRes = await forwardPost('/generate/', {
      model_id,
      input: [tokenized.tokens],
      block_size,
      max_new_tokens,
      temperature,
      ...(top_k != null && { top_k }),
    });
    if (!generateRes.ok) {
      res.status(generateRes.status).json({ error: 'Generation failed' });
      return;
    }
    const generated = (await generateRes.json()) as { tokens: number[] };

    // 3. Decode only newly generated tokens
    const newTokens = generated.tokens.slice(tokenized.tokens.length);
    const decodeRes = await forwardPost('/decode/', {
      encoding: 'gpt2',
      tokens: newTokens,
    });
    if (!decodeRes.ok) {
      res.status(decodeRes.status).json({ error: 'Decoding failed' });
      return;
    }
    const decoded = (await decodeRes.json()) as { text: string };

    // 4. Trim at first <|endoftext|>
    const endIdx = decoded.text.indexOf('<|endoftext|>');
    const response = endIdx < 0 ? decoded.text : decoded.text.slice(0, endIdx);

    res.json({ response });
  } catch (err) {
    handleProxyError(err, res);
  }
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
  console.log(`Forwarding to prediction server at ${PREDICTION_SERVER_URL}`);
});
