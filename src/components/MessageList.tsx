import { useEffect, useRef } from 'react';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
  error: string | null;
}

export function MessageList({ messages, streaming, error }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const isLastAssistantStreaming = (i: number) =>
    streaming && i === messages.length - 1 && messages[i].role === 'assistant';

  return (
    <main className="chat-messages">
      {messages.length === 0 && !streaming && (
        <div className="chat-empty">Send a message to start generating text.</div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`chat-message chat-message--${msg.role}`}>
          <span className="chat-message-role">{msg.role === 'user' ? 'You' : 'GPT'}</span>
          <p className="chat-message-content">
            {msg.content}
            {isLastAssistantStreaming(i) && (
              <span className="chat-cursor" aria-hidden="true">▌</span>
            )}
          </p>
        </div>
      ))}
{error && <div className="chat-error">{error}</div>}
      <div ref={messagesEndRef} />
    </main>
  );
}
