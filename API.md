# API Contract

This document defines the request/response contracts for the two communication layers in the penr-oz-gpt-chat system.

```
React Client  ──►  Express Proxy (port 3001)  ──►  Neural Network Service (port 8000)
```

---

## Layer 1: React Client ↔ Express Proxy

Base URL: `http://localhost:3001`

All endpoints use `Content-Type: application/json` for requests. `/api/chat` responds with `Content-Type: text/event-stream` (SSE).

---

### POST /api/chat

Orchestrated streaming endpoint. Tokenizes the message, runs generation using the upstream's native `stream: true` mode (one token integer per line), decodes each token individually, and forwards them to the client as **Server-Sent Events (SSE)**. Tokens are emitted progressively as they are decoded, allowing the UI to render text in real time via `res.body.getReader()`.

**Request**

```json
{
  "message": "Once upon a time",
  "model_id": "gpt-example",
  "encoding": "gpt2",
  "block_size": 1024,
  "max_new_tokens": 50,
  "temperature": 1.0,
  "top_k": 40,
  "top_p": 0.95,
  "eot_token": "<|endoftext|>",
  "device": "cpu"
}
```

| Field            | Type     | Required | Description                                           |
|------------------|----------|----------|-------------------------------------------------------|
| `message`        | `string` | Yes      | The user's input text                                 |
| `model_id`       | `string` | Yes      | Identifier of the model to use for generation         |
| `encoding`       | `string` | Yes      | Tokenizer name (e.g. `"gpt2"`)                        |
| `block_size`     | `number` | Yes      | Context window size (any positive integer)            |
| `max_new_tokens` | `number` | Yes      | Maximum number of tokens to generate (1–2048)         |
| `temperature`    | `number` | Yes      | Sampling temperature; higher = more random (e.g. 1.0) |
| `top_k`          | `number` | No       | Top-k sampling cutoff; omit to disable                |
| `top_p`          | `number` | No       | Top-p (nucleus) sampling threshold; omit to disable   |
| `eot_token`      | `string` | No       | End-of-text token. When provided, its token id is passed to generation as `stop_token` and output is truncated at the token. Omit (or send empty) for base models — no `stop_token` is sent upstream. |
| `device`         | `string` | Yes      | Compute device: `"cpu"`, `"mps"`, or `"cuda"`         |

**Response** — `Content-Type: text/event-stream`

Each decoded token fragment is sent as an SSE `data` event:

```
data: {"token":" there"}

data: {"token":" was"}

data: [DONE]
```

| Event                 | Description                                       |
|-----------------------|---------------------------------------------------|
| `data: {"token":"…"}` | A decoded token fragment to append to the output  |
| `data: [DONE]`        | Generation is complete; close the stream          |
| `event: error`        | An error occurred; `data` contains `{"error":"…"}`|

**Error Responses**

| HTTP Status | Condition                                                                    |
|-------------|------------------------------------------------------------------------------|
| `400`       | Missing `message` or `model_id`                                              |
| `502`/`504` | Upstream error (sent as SSE `event: error` after headers are already flushed)|

---

### POST /api/tokenize

Proxy pass-through to the neural network service's `/tokenize/` endpoint.

**Request**

```json
{
  "encoding": "gpt2",
  "text": "Hello world"
}
```

| Field      | Type     | Required | Description                              |
|------------|----------|----------|------------------------------------------|
| `encoding` | `string` | Yes      | Tokenizer name (e.g. `"gpt2"`)           |
| `text`     | `string` | Yes      | Text to tokenize                         |

**Response (200)**

```json
{
  "encoding": "gpt2",
  "tokens": [15496, 995]
}
```

| Field      | Type       | Description                        |
|------------|------------|------------------------------------|
| `encoding` | `string`   | Tokenizer used                     |
| `tokens`   | `number[]` | Array of integer token IDs         |

---

### POST /api/generate

Proxy pass-through to the neural network service's `/generate/` endpoint.

**Request**

```json
{
  "model_id": "gpt-example",
  "input": [[15496, 995]],
  "block_size": 1024,
  "max_new_tokens": 50,
  "temperature": 1.0,
  "top_k": 40,
  "top_p": 0.95
}
```

| Field            | Type         | Required | Description                                         |
|------------------|--------------|----------|-----------------------------------------------------|
| `model_id`       | `string`     | Yes      | Identifier of the model to use                      |
| `input`          | `number[][]` | Yes      | Batch of token ID sequences (outer array = batch)   |
| `block_size`     | `number`     | Yes      | Context window size (any positive integer)          |
| `max_new_tokens` | `number`     | Yes      | Maximum number of new tokens to generate (1–2048)   |
| `temperature`    | `number`     | Yes      | Sampling temperature                                |
| `top_k`          | `number`     | No       | Top-k sampling cutoff; omit to disable              |
| `top_p`          | `number`     | No       | Top-p (nucleus) sampling threshold; omit to disable |

**Response (200)**

```json
{
  "tokens": [15496, 995, 612, 373, 257]
}
```

| Field    | Type       | Description                                              |
|----------|------------|----------------------------------------------------------|
| `tokens` | `number[]` | Full token sequence (input tokens + newly generated tokens) |

---

### POST /api/decode

Proxy pass-through to the neural network service's `/decode/` endpoint.

**Request**

```json
{
  "encoding": "gpt2",
  "tokens": [612, 373, 257]
}
```

| Field      | Type       | Required | Description                        |
|------------|------------|----------|------------------------------------|
| `encoding` | `string`   | Yes      | Tokenizer name (e.g. `"gpt2"`)     |
| `tokens`   | `number[]` | Yes      | Array of token IDs to decode       |

**Response (200)**

```json
{
  "encoding": "gpt2",
  "text": " there was a"
}
```

| Field      | Type     | Description                  |
|------------|----------|------------------------------|
| `encoding` | `string` | Tokenizer used               |
| `text`     | `string` | Decoded plain text           |

---

### Error Responses (Layer 1)

The proxy generates errors in the following shape for `/api/chat`. Pass-through endpoints (`/api/tokenize`, `/api/generate`, `/api/decode`) relay the upstream response body unchanged.

```json
{
  "error": "Human-readable error message"
}
```

| HTTP Status | Condition                                               |
|-------------|---------------------------------------------------------|
| `502`       | Could not reach the neural network service              |
| `504`       | Request to the neural network service timed out (>30 s) |
| `500`       | Unexpected internal server error                        |

For pass-through endpoints, upstream errors from the neural network service are forwarded as-is. For the `/api/chat` endpoint, the original HTTP status is forwarded, but the error field is set to a generic stage description (e.g. `"Tokenization failed"`).

---

## Layer 2: Express Proxy ↔ Neural Network Service

Base URL: `http://localhost:8000` (configurable via `PREDICTION_SERVER_URL`)

All endpoints accept and return `Content-Type: application/json`.

---

### POST /tokenize/

Converts plain text into a sequence of integer token IDs using the specified tokenizer.

**Request**

```json
{
  "encoding": "gpt2",
  "text": "Hello world"
}
```

| Field      | Type     | Required | Description                         |
|------------|----------|----------|-------------------------------------|
| `encoding` | `string` | Yes      | Tokenizer name (e.g. `"gpt2"`)      |
| `text`     | `string` | Yes      | Text to tokenize                    |

**Response (200)**

```json
{
  "encoding": "gpt2",
  "tokens": [15496, 995]
}
```

| Field      | Type       | Description                |
|------------|------------|----------------------------|
| `encoding` | `string`   | Tokenizer used             |
| `tokens`   | `number[]` | Array of integer token IDs |

---

### POST /generate/

Runs autoregressive token generation using the specified model.

**Request**

```json
{
  "model_id": "gpt-example",
  "input": [[15496, 995]],
  "block_size": 1024,
  "max_new_tokens": 50,
  "temperature": 1.0,
  "top_k": 40,
  "top_p": 0.95
}
```

| Field            | Type         | Required | Description                                        |
|------------------|--------------|----------|----------------------------------------------------|
| `model_id`       | `string`     | Yes      | Identifier of the model to use                     |
| `input`          | `number[][]` | Yes      | Batch of token ID sequences (outer array = batch)  |
| `block_size`     | `number`     | Yes      | Context window size (any positive integer)         |
| `max_new_tokens` | `number`     | Yes      | Maximum number of new tokens to generate (1–2048)  |
| `temperature`    | `number`     | Yes      | Sampling temperature                               |
| `top_k`          | `number`     | No       | Top-k sampling cutoff; omit to disable             |
| `top_p`          | `number`     | No       | Top-p (nucleus) sampling threshold; omit to disable|
| `stop_token`     | `number`     | No       | Token id that halts generation when produced; omitted when no `eot_token` is configured |

**Response (200)**

```json
{
  "tokens": [15496, 995, 612, 373, 257]
}
```

| Field    | Type       | Description                                               |
|----------|------------|-----------------------------------------------------------|
| `tokens` | `number[]` | Full token sequence (input tokens + newly generated tokens)|

---

### POST /decode/

Converts a sequence of integer token IDs back into plain text.

**Request**

```json
{
  "encoding": "gpt2",
  "tokens": [612, 373, 257]
}
```

| Field      | Type       | Required | Description                     |
|------------|------------|----------|---------------------------------|
| `encoding` | `string`   | Yes      | Tokenizer name (e.g. `"gpt2"`) |
| `tokens`   | `number[]` | Yes      | Array of token IDs to decode    |

**Response (200)**

```json
{
  "encoding": "gpt2",
  "text": " there was a"
}
```

| Field      | Type     | Description        |
|------------|----------|--------------------|
| `encoding` | `string` | Tokenizer used     |
| `text`     | `string` | Decoded plain text |

---

### Error Responses (Layer 2)

Error responses from the neural network service are forwarded as-is by the proxy. The expected shape is:

```json
{
  "error": "Human-readable error message"
}
```

---

## Full `/api/chat` Flow

`/api/chat` orchestrates three upstream calls and streams decoded tokens back to the client as SSE. Generation uses the upstream's native `stream: true` mode, so each new token integer arrives line-by-line and is decoded individually before being forwarded.

When `eot_token` is provided, it is appended to the message before tokenization so its token id can be passed to `/generate/` as `stop_token`, and decoded output is truncated at the first occurrence of the token. When `eot_token` is omitted (base models), only the message is tokenized and no `stop_token` is sent.

```
Client                  Proxy                     Neural Network Service
  │                       │                                │
  │── POST /api/chat ────►│                                │
  │  (SSE response ←)     │── POST /tokenize/ ────────────►│
  │                       │◄── { tokens: [...] } ──────────│
  │                       │── POST /generate/             ►│
  │                       │      { stream: true }          │
  │                       │◄── 42\n (token int, streaming)─│
  │                       │── POST /decode/ [42] ─────────►│
  │                       │◄── { text: " there" } ─────────│
  │◄─ data: {"token":" there"}\n\n                         │
  │                       │◄── 373\n ──────────────────────│
  │                       │── POST /decode/ [373] ────────►│
  │                       │◄── { text: " was" } ───────────│
  │◄─ data: {"token":" was"}\n\n                           │
  │         ...            │         (repeats per token)    │
  │◄─ data: [DONE]\n\n     │                                │
```
