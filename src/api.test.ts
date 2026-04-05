import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tokenize, decode, generate, chatStream, type ChatRequest } from './api.js'

// ---------------------------------------------------------------------------
// Mock fetch globally before module-level code runs
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Build a streaming SSE response from a list of raw string chunks. */
function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, statusText: 'OK' })
}

// ---------------------------------------------------------------------------
// tokenize()
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns tokenized response on success', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ encoding: 'gpt2', tokens: [15496, 995] }))
    const result = await tokenize('Hello world')
    expect(result).toEqual({ encoding: 'gpt2', tokens: [15496, 995] })
  })

  it('calls fetch with correct method and body', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ encoding: 'gpt2', tokens: [1] }))
    await tokenize('test')
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/tokenize')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({ encoding: 'gpt2', text: 'test' })
  })

  it('uses the provided encoding argument', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ encoding: 'r50k', tokens: [1] }))
    await tokenize('hi', 'r50k')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.encoding).toBe('r50k')
  })

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Internal Server Error' }))
    await expect(tokenize('Hello')).rejects.toThrow('Tokenize failed')
  })
})

// ---------------------------------------------------------------------------
// decode()
// ---------------------------------------------------------------------------

describe('decode', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns decoded response on success', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ encoding: 'gpt2', text: 'Hello world' }))
    const result = await decode([15496, 995])
    expect(result).toEqual({ encoding: 'gpt2', text: 'Hello world' })
  })

  it('calls fetch with correct method and body', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ encoding: 'gpt2', text: 'hi' }))
    await decode([1, 2])
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/decode')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({ encoding: 'gpt2', tokens: [1, 2] })
  })

  it('uses the provided encoding argument', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ encoding: 'r50k', text: 'hi' }))
    await decode([1], 'r50k')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.encoding).toBe('r50k')
  })

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 400, statusText: 'Bad Request' }))
    await expect(decode([1])).rejects.toThrow('Decode failed')
  })
})

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

describe('generate', () => {
  beforeEach(() => mockFetch.mockReset())

  const req = {
    model_id: 'gpt2',
    input: [[1, 2, 3]],
    block_size: 128,
    max_new_tokens: 50,
    temperature: 1.0,
  }

  it('returns generation response on success', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ tokens: [4, 5, 6] }))
    const result = await generate(req)
    expect(result).toEqual({ tokens: [4, 5, 6] })
  })

  it('calls fetch with correct method and full request body', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ tokens: [4] }))
    await generate(req)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/generate')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual(req)
  })

  it('includes optional top_k when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ tokens: [4] }))
    await generate({ ...req, top_k: 10 })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.top_k).toBe(10)
  })

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 503, statusText: 'Service Unavailable' }))
    await expect(generate(req)).rejects.toThrow('Generate failed')
  })
})

// ---------------------------------------------------------------------------
// chatStream()
// ---------------------------------------------------------------------------

describe('chatStream', () => {
  beforeEach(() => mockFetch.mockReset())

  const req: ChatRequest = {
    message: 'Hello',
    model_id: 'gpt2',
    encoding: 'gpt2',
    block_size: 64,
    max_new_tokens: 20,
    temperature: 1.0,
    eot_token: '<|endoftext|>',
  }

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Server Error' }))
    await expect(chatStream(req, vi.fn())).rejects.toThrow('Chat failed')
  })

  it('throws when response body is null', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200, statusText: 'OK' }))
    await expect(chatStream(req, vi.fn())).rejects.toThrow('No response body')
  })

  it('calls onUpdate with each text piece from the SSE stream', async () => {
    const sse = 'data: {"text":"Hello"}\n\ndata: {"text":" world"}\n\ndata: [DONE]\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([sse]))
    const updates: string[] = []
    await chatStream(req, (text) => updates.push(text))
    expect(updates).toEqual(['Hello', ' world'])
  })

  it('stops processing after [DONE] and ignores subsequent events', async () => {
    const sse = 'data: [DONE]\n\ndata: {"text":"ignored"}\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([sse]))
    const updates: string[] = []
    await chatStream(req, (text) => updates.push(text))
    expect(updates).toEqual([])
  })

  it('throws on SSE error event type', async () => {
    const sse = 'event: error\ndata: {"error":"upstream failure"}\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([sse]))
    await expect(chatStream(req, vi.fn())).rejects.toThrow('upstream failure')
  })

  it('throws when data payload has an error field', async () => {
    const sse = 'data: {"error":"something went wrong"}\n\ndata: [DONE]\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([sse]))
    await expect(chatStream(req, vi.fn())).rejects.toThrow('something went wrong')
  })

  it('throws with generic message when error event has no error field', async () => {
    const sse = 'event: error\ndata: {}\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([sse]))
    await expect(chatStream(req, vi.fn())).rejects.toThrow('Stream error')
  })

  it('skips non-JSON data lines without throwing (SyntaxError tolerance)', async () => {
    const sse = 'data: not-valid-json\ndata: {"text":"valid"}\n\ndata: [DONE]\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([sse]))
    const updates: string[] = []
    await chatStream(req, (text) => updates.push(text))
    expect(updates).toEqual(['valid'])
  })

  it('ignores data events without a text field', async () => {
    const sse = 'data: {"other":"value"}\n\ndata: [DONE]\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([sse]))
    const updates: string[] = []
    await chatStream(req, (text) => updates.push(text))
    expect(updates).toEqual([])
  })

  it('handles SSE data split across multiple chunks', async () => {
    // Simulate the stream arriving in two chunks, mid-line
    const chunk1 = 'data: {"tex'
    const chunk2 = 't":"split"}\n\ndata: [DONE]\n\n'
    mockFetch.mockResolvedValueOnce(makeSseResponse([chunk1, chunk2]))
    const updates: string[] = []
    await chatStream(req, (text) => updates.push(text))
    expect(updates).toEqual(['split'])
  })

  it('forwards the abort signal to fetch', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse(['data: [DONE]\n\n']))
    const controller = new AbortController()
    await chatStream(req, vi.fn(), controller.signal)
    expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('calls fetch with correct endpoint and body', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse(['data: [DONE]\n\n']))
    await chatStream(req, vi.fn())
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/chat')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject(req)
  })
})
