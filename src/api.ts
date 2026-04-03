const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_PROXY_SERVER_URL || 'http://localhost:3001') + '/api';

export interface GenerateRequest {
  model_id: string;
  input: number[][];
  block_size: number;
  max_new_tokens: number;
  temperature: number;
  top_k?: number;
}

export interface GenerateResponse {
  tokens: number[];
}

export interface TokenizeRequest {
  encoding: string;
  text: string;
}

export interface TokenizeResponse {
  encoding: string;
  tokens: number[];
}

export interface DecodeRequest {
  encoding: string;
  tokens: number[];
}

export interface DecodeResponse {
  encoding: string;
  text: string;
}

export async function tokenize(text: string, encoding = 'gpt2'): Promise<TokenizeResponse> {
  const res = await fetch(`${API_BASE}/tokenize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encoding, text } satisfies TokenizeRequest),
  });
  if (!res.ok) throw new Error(`Tokenize failed: ${res.statusText}`);
  const data = await res.json();
  return data;
}

export async function decode(tokens: number[], encoding = 'gpt2'): Promise<DecodeResponse> {
  const res = await fetch(`${API_BASE}/decode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encoding, tokens } satisfies DecodeRequest),
  });
  if (!res.ok) throw new Error(`Decode failed: ${res.statusText}`);
  const data = await res.json();
  return data;
}

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Generate failed: ${res.statusText}`);
  const data = await res.json();
  return data;
}

export interface ChatRequest {
  message: string;
  model_id: string;
  block_size: number;
  max_new_tokens: number;
  temperature: number;
  top_k?: number;
  eot_token?: string;
}

export async function chatStream(
  req: ChatRequest,
  onUpdate: (fullText: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.statusText}`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    let eventType = '';
    while (true) {
      const { done, value } = await reader.read();
      
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      } else if (done) {
        buffer += decoder.decode(); // flush any remaining bytes
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          // Blank line resets the current event type
          eventType = '';
          continue;
        }
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as { text?: string; error?: string };
          if (eventType === 'error' || parsed.error) throw new Error(parsed.error ?? 'Stream error');
          if (parsed.text !== undefined) onUpdate(parsed.text);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
        if (done) break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
