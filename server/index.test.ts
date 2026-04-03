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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/api/chat – EOT token behaviour', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('passes stop_token defaulting to <|endoftext|> when eot_token is not provided', async () => {
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

    // Assert – second call is the generate call
    const generateCall = mockFetch.mock.calls[1]
    const generateBody = JSON.parse(generateCall[1].body as string)
    expect(generateBody.stop_token).toBe('<|endoftext|>')
  })

  it('passes the provided eot_token as stop_token to the upstream generate endpoint', async () => {
    // Arrange
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ tokens: [1, 2] }))          // tokenize
      .mockResolvedValueOnce(makeStreamResponse(['3']))                      // generate
      .mockResolvedValueOnce(makeJsonResponse({ text: 'Hi' }))              // decode

    // Act
    await request(app)
      .post('/api/chat')
      .send({ message: 'Hi', model_id: 'm1', block_size: 64, max_new_tokens: 10, temperature: 1.0, eot_token: '<|custom_eot|>' })
      .buffer(true)
      .parse((res, cb) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => cb(null, data))
      })

    // Assert
    const generateCall = mockFetch.mock.calls[1]
    const generateBody = JSON.parse(generateCall[1].body as string)
    expect(generateBody.stop_token).toBe('<|custom_eot|>')
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
