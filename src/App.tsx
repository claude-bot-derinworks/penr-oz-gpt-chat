import { useRef, useState } from 'react'
import { chatStream } from './api'
import { MessageList, type Message } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import './App.css'

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState('gpt-example');
  const [blockSize, setBlockSize] = useState(1024);
  const [maxTokens, setMaxTokens] = useState(50);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userMessage = input.trim();
    setInput('');
    setError(null);
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
          block_size: blockSize,
          max_new_tokens: maxTokens,
          temperature: 1.0,
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
            Block size:
            <input
              type="number"
              value={blockSize}
              min={1}
              max={2048}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value));
                setBlockSize(Number.isFinite(n) ? Math.max(1, Math.min(2048, n)) : 1)
              }}
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
