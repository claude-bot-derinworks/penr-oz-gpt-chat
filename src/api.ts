const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_PREDICTION_SERVER_URL || 'http://localhost:8000');

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
  const res = await fetch(`${API_BASE}/tokenize/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encoding, text } satisfies TokenizeRequest),
  });
  if (!res.ok) throw new Error(`Tokenize failed: ${res.statusText}`);
  const data = await res.json();
  return data;
}

export async function decode(tokens: number[], encoding = 'gpt2'): Promise<DecodeResponse> {
  const res = await fetch(`${API_BASE}/decode/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encoding, tokens } satisfies DecodeRequest),
  });
  if (!res.ok) throw new Error(`Decode failed: ${res.statusText}`);
  const data = await res.json();
  return data;
}

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/generate/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Generate failed: ${res.statusText}`);
  const data = await res.json();
  return data;
}
