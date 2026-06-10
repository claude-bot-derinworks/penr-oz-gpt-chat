import { useRef, useState } from 'react'
import { chatStream, type Device } from './api'
import { MessageList, type Message } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import { useLocalStorage } from './hooks/useLocalStorage'
import './App.css'

function normalizePositiveInteger(value: string, fallback: number): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? Math.max(1, n) : fallback
}

// Empty string means "not set"; invalid or out-of-range values normalize to not set.
function normalizeTopK(value: string): number | null {
  if (value.trim() === '') return null
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeTopP(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : null
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Settings below are persisted to localStorage and restored on next visit.
  const [modelId, setModelId] = useLocalStorage('chat.modelId', 'gpt-example');
  const [encoding, setEncoding] = useLocalStorage('chat.encoding', 'gpt2');
  const [eotToken, setEotToken] = useLocalStorage('chat.eotToken', '<|endoftext|>');
  const [blockSizeInput, setBlockSizeInput] = useLocalStorage('chat.blockSizeInput', '1024');
  const [maxTokens, setMaxTokens] = useLocalStorage('chat.maxTokens', 50);
  const [temperature, setTemperature] = useLocalStorage('chat.temperature', 0.0);
  // top_k / top_p are optional; empty string means "not set" and is omitted from requests
  const [topKInput, setTopKInput] = useLocalStorage('chat.topK', '');
  const [topPInput, setTopPInput] = useLocalStorage('chat.topP', '');
  const [device, setDevice] = useLocalStorage<Device>('chat.device', 'cpu');
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userMessage = input.trim();
    const blockSize = normalizePositiveInteger(blockSizeInput, 1024);
    const topK = normalizeTopK(topKInput);
    const topP = normalizeTopP(topPInput);
    const eotTokenTrimmed = eotToken.trim();
    setInput('');
    setError(null);
    setBlockSizeInput(String(blockSize));
    setTopKInput(topK != null ? String(topK) : '');
    setTopPInput(topP != null ? String(topP) : '');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: '' },
    ]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await chatStream(
        {
          message: userMessage,
          model_id: modelId,
          encoding: encoding.trim() || 'gpt2',
          block_size: blockSize,
          max_new_tokens: maxTokens,
          temperature,
          ...(topK != null && { top_k: topK }),
          ...(topP != null && { top_p: topP }),
          ...(eotTokenTrimmed !== '' && { eot_token: eotTokenTrimmed }),
          device,
        },
        (fullText) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: fullText };
            return updated;
          });
        },
        controller.signal,
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
      // Remove the partial assistant message on error
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>GPT Chat</h1>
        <div className="chat-settings">
          <label>
            Model ID:
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
          </label>
          <label>
            Encoding:
            <input
              type="text"
              value={encoding}
              onChange={(e) => setEncoding(e.target.value)}
            />
          </label>
          <label title="End-of-text token; leave empty for base models (no stop token is sent)">
            EOT:
            <input
              type="text"
              value={eotToken}
              onChange={(e) => setEotToken(e.target.value)}
            />
          </label>
          <label>
            Block size:
            <input
              type="number"
              value={blockSizeInput}
              min={1}
              onChange={(e) => setBlockSizeInput(e.target.value)}
              onBlur={(e) => setBlockSizeInput(String(normalizePositiveInteger(e.target.value, 1024)))}
            />
          </label>
          <label>
            Max tokens:
            <input
              type="number"
              value={maxTokens}
              min={1}
              max={2048}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value));
                setMaxTokens(Number.isFinite(n) ? Math.max(1, Math.min(2048, n)) : 1);
              }}
            />
          </label>
          <label title="Controls randomness: 0.0 = deterministic, 1.0 = most random">
            Temperature:
            <input
              type="number"
              value={temperature}
              min={0}
              max={1}
              step={0.1}
              onChange={(e) => {
                const n = Number(e.target.value);
                setTemperature(Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
              }}
            />
          </label>
          <label title="Top-k sampling cutoff; leave empty to disable">
            Top k:
            <input
              type="number"
              value={topKInput}
              min={1}
              step={1}
              placeholder="off"
              onChange={(e) => setTopKInput(e.target.value)}
              onBlur={(e) => {
                const n = normalizeTopK(e.target.value);
                setTopKInput(n != null ? String(n) : '');
              }}
            />
          </label>
          <label title="Top-p (nucleus) sampling threshold; leave empty to disable">
            Top p:
            <input
              type="number"
              value={topPInput}
              min={0}
              max={1}
              step={0.05}
              placeholder="off"
              onChange={(e) => setTopPInput(e.target.value)}
              onBlur={(e) => {
                const n = normalizeTopP(e.target.value);
                setTopPInput(n != null ? String(n) : '');
              }}
            />
          </label>
          <label>
            Device:
            <select value={device} onChange={(e) => setDevice(e.target.value as Device)}>
              <option value="cpu">cpu</option>
              <option value="mps">mps</option>
              <option value="cuda">cuda</option>
            </select>
          </label>
        </div>
      </header>

      <MessageList messages={messages} streaming={streaming} error={error} />

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={streaming}
      />
    </div>
  );
}

export default App
