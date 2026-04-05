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

async function forwardPost(targetPath: string, body: unknown, signal?: AbortSignal): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());

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

const PROXY_PATHS = ['/api/tokenize', '/api/generate', '/api/decode'] as const;

for (const proxyPath of PROXY_PATHS) {
  const upstream = proxyPath.replace(/^\/api/, '') + '/'; // e.g. /tokenize/
  app.post(proxyPath, async (req: Request, res: Response) => {
    try {
      const upstream_res = await forwardPost(upstream, req.body);
      const data = await upstream_res.json();
      if (!upstream_res.ok) {
        console.error(`API error ${upstream_res.status} from ${upstream}:`, JSON.stringify(data));
      }
      res.status(upstream_res.status).json(data);
    } catch (err) {
      handleProxyError(err, res);
    }
  });
}

// ---------------------------------------------------------------------------
// /api/chat  --  streaming orchestrated endpoint (SSE)
// ---------------------------------------------------------------------------

interface ChatRequest {
  message: string;
  model_id: string;
  block_size: number;
  max_new_tokens: number;
  temperature: number;
  top_k?: number;
  eot_token?: string;
}

// GPT-2 special token ids for known end-of-text tokens
const GPT2_TOKEN_IDS: Record<string, number> = {
  '<|endoftext|>': 50256,
};

app.post('/api/chat', async (req: Request, res: Response) => {
  const { message, model_id, block_size, max_new_tokens, temperature, top_k, eot_token } =
    req.body as ChatRequest;
  const stopToken = eot_token ?? '<|endoftext|>';
  const stopTokenId = GPT2_TOKEN_IDS[stopToken] ?? GPT2_TOKEN_IDS['<|endoftext|>'];

  if (!message || !model_id) {
    res.status(400).json({ error: 'message and model_id are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const sendDone = () => res.write('data: [DONE]\n\n');
  const sendError = (error: string) => res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);

  // Abort when the client disconnects so we stop the upstream stream too
  const clientAbort = new AbortController();
  res.on('close', () => clientAbort.abort());

  try {
    // 1. Tokenize
    const tokenizeRes = await forwardPost('/tokenize/', { encoding: 'gpt2', text: message }, clientAbort.signal);
    if (!tokenizeRes.ok) {
      const errBody = await tokenizeRes.json().catch(() => null);
      console.error(`API error ${tokenizeRes.status} from /tokenize/:`, JSON.stringify(errBody));
      sendError('Tokenization failed');
      res.end();
      return;
    }
    const tokenized = (await tokenizeRes.json()) as { tokens: number[] };

    // 2. Generate with stream: true — upstream yields one token integer per line
    const generateRes = await forwardPost('/generate/', {
      model_id,
      input: [tokenized.tokens],
      block_size,
      max_new_tokens,
      temperature,
      stream: true,
      stop_token: stopTokenId,  // prediction server expects an integer token id
      ...(top_k != null && { top_k }),
    }, clientAbort.signal);

    if (!generateRes.ok) {
      const errBody = await generateRes.json().catch(() => null);
      console.error(`API error ${generateRes.status} from /generate/:`, JSON.stringify(errBody));
      sendError('Generation failed');
      res.end();
      return;
    }
    if (!generateRes.body) {
      sendError('No response body from generation');
      res.end();
      return;
    }

    // 3. Read token integers line-by-line, buffer them, and flush every ~500ms
    const reader = generateRes.body.getReader();
    const textDecoder = new TextDecoder();
    let lineBuffer = '';
    let stopped = false;
    const tokenBuffer: number[] = [];
    const cumulativeTokens: number[] = [];
    const TOKEN_FLUSH_INTERVAL_MS = 500;

    const flushTokenBuffer = async (): Promise<boolean> => {
      const batch = tokenBuffer.splice(0);
      if (batch.length === 0) return false;
      cumulativeTokens.push(...batch);

      const decodeRes = await forwardPost('/decode/', { encoding: 'gpt2', tokens: cumulativeTokens }, clientAbort.signal);
      if (!decodeRes.ok) {
        sendError('Failed to decode token batch');
        return true;
      }
      const decoded: unknown = await decodeRes.json();
      if (!decoded || typeof decoded !== 'object' || !('text' in decoded) || typeof decoded.text !== 'string') {
        sendError('Unexpected response from decode endpoint');
        return true;
      }
      const text = decoded.text;
      const endIdx = text.indexOf(stopToken);
      const piece = endIdx < 0 ? text : text.slice(0, endIdx);
      if (piece) sendEvent({ text: piece });
      return endIdx >= 0;
    };

    // Periodic flush timer — fires every 500ms regardless of stream data arrival.
    // isFlushing prevents concurrent executions when flush takes longer than the interval.
    // timerFlushPromise tracks any in-flight flush so the end-of-stream path can await it.
    let timerFlushPromise: Promise<void> | null = null;
    const flushTimer = (() => {
      let isFlushing = false;
      return setInterval(() => {
        if (stopped || isFlushing) return;
        isFlushing = true;
        timerFlushPromise = (async () => {
          try {
            const shouldStop = await flushTokenBuffer();
            if (shouldStop) stopped = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error during flush';
            console.error('Error during periodic token flush:', msg);
            sendError('An error occurred while decoding tokens.');
            stopped = true;
          } finally {
            isFlushing = false;
          }
        })();
      }, TOKEN_FLUSH_INTERVAL_MS);
    })();

    try {
      while (!stopped) {
        const { value, done } = await reader.read();

        if (value) {
          lineBuffer += textDecoder.decode(value, { stream: !done });
        } else if (done) {
          lineBuffer += textDecoder.decode();
        }

        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const tokenId = parseInt(trimmed, 10);
          if (isNaN(tokenId)) continue;

          tokenBuffer.push(tokenId);
        }
        if (done) break;
      }
    } finally {
      clearInterval(flushTimer);
      if (timerFlushPromise) await timerFlushPromise;
    }

    // Collect any remaining partial line and flush all buffered tokens
    if (!stopped && lineBuffer.trim()) {
      const tokenId = parseInt(lineBuffer.trim(), 10);
      if (!isNaN(tokenId)) tokenBuffer.push(tokenId);
    }
    if (!stopped) {
      await flushTokenBuffer();
    }

    sendDone();
    res.end();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Client disconnected — no response needed
    } else {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Chat error:', msg);
      sendError(msg);
    }
    res.end();
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

export { app };

// Only start listening when this file is the main entry point
const isMain = process.argv[1] && (await import('url')).fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  app.listen(PORT, () => {
    console.log(`Proxy server listening on port ${PORT}`);
    console.log(`Forwarding to prediction server at ${PREDICTION_SERVER_URL}`);
  });
}
