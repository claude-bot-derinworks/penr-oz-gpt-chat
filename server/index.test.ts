import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Mock fetch before importing the app so forwardPost uses the mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { app } = await import('./index.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake streaming Response that emits lines of token integers. */
function makeStreamResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

/** Build a non-streaming JSON Response. */
function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Read a supertest SSE response (text/event-stream) to completion and return
 * all collected text pieces from `data:` events.
 * When using a custom `.parse()` callback the raw body is stored in `res.body`.
 */
async function collectSseText(res: request.Response): Promise<string[]> {
  const body = (typeof res.body === 'string' ? res.body : res.text) ?? ''
  const pieces: string[] = []
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6)
    if (payload === '[DONE]') break
    try {
      const parsed = JSON.parse(payload) as { text?: string }
      if (parsed.text !== undefined) pieces.push(parsed.text)
    } catch {
      // ignore non-JSON lines
    }
  }
  return pieces
}

/** Perform a chat POST and collect the raw SSE response body. */
async function doChat(body: object): Promise<request.Response> {
  return request(app)
    .post('/api/chat')
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => cb(null, data))
    })
}

/** Find a mock fetch call whose URL contains the given substring. */
function findMockCallByUrl(urlSubstring: string): [string, RequestInit] {
  const call = mockFetch.mock.calls.find(([u]) => String(u).includes(urlSubstring))
  if (!call) throw new Error(`No mock fetch call found for URL containing "${urlSubstring}"`)
  return call as [string, RequestInit]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/api/chat – EOT token behaviour', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('passes stop_token as integer token id defaulting to 50256 (<|endoftext|>) when eot_token is not provided', async () => {
    // Arrange
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1, 2] }))          // tokenize
      .mockResolvedValueOnce(makeStreamResponse(['3', '4']))                 // generate
      .mockResolvedValueOnce(makeJsonResponse({ text: 'Hello world' }))     // decode

    // Act
    await request(app)
      .post('/api/chat')
      .send({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })
      .buffer(true)
      .parse((res, cb) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => cb(null, data))
      })

    // Assert – stop_token must be the integer GPT-2 token id for <|endoftext|>
    const generateBody = JSON.parse(findMockCallByUrl('/generate/')[1].body as string)
    expect(generateBody.stop_token).toBe(50256)
  })

  it('passes the provided eot_token as integer stop_token id to the upstream generate endpoint', async () => {
    // Arrange – <|endoftext|> is the only known GPT-2 special token; unknown tokens fall back to it
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1, 2] }))          // tokenize
      .mockResolvedValueOnce(makeStreamResponse(['3']))                      // generate
      .mockResolvedValueOnce(makeJsonResponse({ text: 'Hi' }))              // decode

    // Act
    await request(app)
      .post('/api/chat')
      .send({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0, eot_token: '<|endoftext|>' })
      .buffer(true)
      .parse((res, cb) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => cb(null, data))
      })

    // Assert
    const generateBody = JSON.parse(findMockCallByUrl('/generate/')[1].body as string)
    expect(generateBody.stop_token).toBe(50256)
  })

  it('stops streaming and strips output at the default <|endoftext|> token', async () => {
    // Arrange – decoded text contains the EOT token mid-way
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))                           // tokenize
      .mockResolvedValueOnce(makeStreamResponse(['2', '3']))                              // generate
      .mockResolvedValueOnce(makeJsonResponse({ text: 'Hello<|endoftext|>ignored' }))    // decode

    // Act
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })
      .buffer(true)
      .parse((res, cb) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => cb(null, data))
      })

    // Assert – only "Hello" should be emitted, not "ignored"
    const pieces = await collectSseText(res)
    expect(pieces).toEqual(['Hello'])
  })

  it('stops streaming and strips output at a custom eot_token', async () => {
    // Arrange
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))                     // tokenize
      .mockResolvedValueOnce(makeStreamResponse(['2']))                             // generate
      .mockResolvedValueOnce(makeJsonResponse({ text: 'Done<|stop|>extra' }))      // decode

    // Act
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 5, temperature: 1.0, eot_token: '<|stop|>' })
      .buffer(true)
      .parse((res, cb) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => cb(null, data))
      })

    // Assert
    const pieces = await collectSseText(res)
    expect(pieces).toEqual(['Done'])
  })

  it('returns 400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })

    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Proxy pass-through endpoints
// ---------------------------------------------------------------------------

describe('/api/tokenize, /api/generate, /api/decode – proxy pass-through', () => {
  beforeEach(() => mockFetch.mockReset())

  it.each([
    ['/api/tokenize', { encoding: 'gpt2', text: 'hi' }, { encoding: 'gpt2', tokens: [1, 2] }],
    ['/api/generate', { model_id: 'm1', input: [[1]], block_size: 64, max_new_tokens: 5, temperature: 1.0 }, { tokens: [3, 4] }],
    ['/api/decode', { encoding: 'gpt2', tokens: [1, 2] }, { encoding: 'gpt2', text: 'hello' }],
  ] as const)('%s forwards request and returns upstream response', async (path, reqBody, resBody) => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(resBody))
    const res = await request(app).post(path).send(reqBody)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(resBody)
  })

  it('returns 502 when upstream is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'))
    const res = await request(app).post('/api/tokenize').send({ encoding: 'gpt2', text: 'hi' })
    expect(res.status).toBe(502)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 504 on upstream timeout (AbortError)', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValueOnce(abortError)
    const res = await request(app).post('/api/generate').send({ model_id: 'm1' })
    expect(res.status).toBe(504)
    expect(res.body.error).toMatch(/timed out/i)
  })

  it('forwards non-200 upstream status unchanged', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ detail: 'not found' }, 404))
    const res = await request(app).post('/api/tokenize').send({ encoding: 'gpt2', text: 'hi' })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ detail: 'not found' })
  })
})

// ---------------------------------------------------------------------------
// /api/chat – additional validation
// ---------------------------------------------------------------------------

describe('/api/chat – request validation', () => {
  it('returns 400 when model_id is missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hi', block_size: 64, max_new_tokens: 10, temperature: 1.0 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/i)
  })
})

// ---------------------------------------------------------------------------
// /api/chat – upstream failure handling
// ---------------------------------------------------------------------------

describe('/api/chat – upstream error handling', () => {
  beforeEach(() => mockFetch.mockReset())

  const validBody = { message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 }

  it('sends SSE error event when tokenization fails', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ error: 'bad input' }, 400))
    const res = await doChat(validBody)
    expect(res.body as string).toContain('event: error')
    expect(res.body as string).toContain('Tokenization failed')
  })

  it('sends SSE error event when generation fails', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))           // tokenize ok
      .mockResolvedValueOnce(makeJsonResponse({ error: 'oops' }, 500))   // generate fails
    const res = await doChat(validBody)
    expect(res.body as string).toContain('event: error')
    expect(res.body as string).toContain('Generation failed')
  })

  it('sends SSE error event when generate response has no body', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))          // tokenize ok
      .mockResolvedValueOnce(new Response(null, { status: 200 }))        // generate: ok status but null body
    const res = await doChat(validBody)
    expect(res.body as string).toContain('event: error')
    expect(res.body as string).toContain('No response body from generation')
  })

  it('sends SSE error event when decode response has unexpected format', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))            // tokenize
      .mockResolvedValueOnce(makeStreamResponse(['2']))                     // generate
      .mockResolvedValueOnce(makeJsonResponse({ unexpected: 'format' }))  // decode: bad shape
    const res = await doChat(validBody)
    expect(res.body as string).toContain('event: error')
    expect(res.body as string).toContain('Unexpected response from decode endpoint')
  })
})

// ---------------------------------------------------------------------------
// /api/chat – streaming behaviour and parameter forwarding
// ---------------------------------------------------------------------------

describe('/api/chat – streaming and parameter forwarding', () => {
  beforeEach(() => mockFetch.mockReset())

  it('forwards top_k to the upstream generate call when provided', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))
      .mockResolvedValueOnce(makeStreamResponse(['2']))
      .mockResolvedValueOnce(makeJsonResponse({ text: 'hi' }))

    await doChat({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0, top_k: 5 })

    const generateBody = JSON.parse(findMockCallByUrl('/generate/')[1].body as string)
    expect(generateBody.top_k).toBe(5)
  })

  it('omits top_k from generate call when not provided', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))
      .mockResolvedValueOnce(makeStreamResponse(['2']))
      .mockResolvedValueOnce(makeJsonResponse({ text: 'hi' }))

    await doChat({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })

    const generateBody = JSON.parse(findMockCallByUrl('/generate/')[1].body as string)
    expect(generateBody).not.toHaveProperty('top_k')
  })

  it('accumulates tokens cumulatively before decoding', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1, 2] }))             // tokenize
      .mockResolvedValueOnce(makeStreamResponse(['3', '4']))                    // generate two tokens
      .mockResolvedValueOnce(makeJsonResponse({ text: 'Hello world' }))        // decode with both tokens

    const res = await doChat({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })
    const pieces = await collectSseText(res)

    // Decode is called with only the generated tokens (cumulative, not including input)
    const decodeBody = JSON.parse(findMockCallByUrl('/decode/')[1].body as string)
    expect(decodeBody.tokens).toEqual([3, 4])
    expect(pieces).toEqual(['Hello world'])
  })

  it('sends [DONE] after successful stream completion', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))
      .mockResolvedValueOnce(makeStreamResponse(['2']))
      .mockResolvedValueOnce(makeJsonResponse({ text: 'hi' }))

    const res = await doChat({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })
    expect(res.body as string).toContain('data: [DONE]')
  })

  it('emits no SSE text events when generate stream is empty', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1] }))
      .mockResolvedValueOnce(makeStreamResponse([]))   // empty generate stream

    const res = await doChat({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })
    const pieces = await collectSseText(res)
    expect(pieces).toEqual([])
  })

  it('handles AbortError (client disconnect) silently without sending an error event', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValueOnce(abortError)

    const res = await doChat({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0 })
    // No error event should be emitted for client-side abort
    expect(res.body as string).not.toContain('event: error')
  })
})
