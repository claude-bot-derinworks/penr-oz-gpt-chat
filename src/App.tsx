import { useState, useRef, useEffect } from 'react'
import { tokenize, generate, decode } from './api'
import './App.css'

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState('model');
  const [maxTokens, setMaxTokens] = useState(200);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const tokens = await tokenize(userMessage);
      const generated = await generate({
        model_id: modelId,
        input: tokens,
        block_size: tokens.length,
        max_new_tokens: maxTokens,
      });
      const text = await decode(generated);
      setMessages((prev) => [...prev, { role: 'assistant', content: text }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
    } finally {
      setLoading(false);
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
            Max tokens:
            <input
              type="number"
              value={maxTokens}
              min={1}
              max={2048}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            />
          </label>
        </div>
      </header>

      <main className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Send a message to start generating text.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            <span className="chat-message-role">
              {msg.role === 'user' ? 'You' : 'GPT'}
            </span>
            <p className="chat-message-content">{msg.content}</p>
          </div>
        ))}
        {loading && (
          <div className="chat-message chat-message--assistant">
            <span className="chat-message-role">GPT</span>
            <p className="chat-message-content chat-loading">Generating...</p>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        <div ref={messagesEndRef} />
      </main>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={loading}
        />
        <button type="submit" className="chat-send" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export default App
