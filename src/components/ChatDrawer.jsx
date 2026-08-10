/* eslint-disable react/prop-types */
import { useState, useRef, useEffect } from 'react';
import { buildRagPayload } from '../utils/rag';

export default function ChatDrawer({ isOpen, onClose, meetings, onSelectMeeting }) {
    const [messages, setMessages] = useState([
        {
            id: 'welcome',
            sender: 'ai',
            text: 'Hello! I am your MeetWise Co-Pilot. Ask me anything about your past meetings, decisions, or co-founder discussions.',
            sources: [],
        },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [chatModel, setChatModel] = useState('gemini');
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isOpen) scrollToBottom();
    }, [messages, isOpen]);

    if (!isOpen) return null;

    const handleSend = async (queryText) => {
        const text = (queryText || input).trim();
        if (!text || loading) return;

        const userMsg = { id: Date.now().toString(), sender: 'user', text };
        setMessages((prev) => [...prev, userMsg]);
        if (!queryText) setInput('');
        setLoading(true);

        try {
            const contextMeetings = buildRagPayload(text, meetings);
            const endpoint = chatModel === 'nvidia' ? '/api/chat/nvidia' : '/api/chat';

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: text, contextMeetings }),
            });

            const rawText = await response.text();
            let data;
            try {
                data = rawText ? JSON.parse(rawText) : {};
            } catch {
                throw new Error(`Server returned an invalid response (HTTP ${response.status}). If using npm run dev, ensure dev server is restarted.`);
            }

            if (!response.ok) throw new Error(data.error || `AI Co-Pilot service failed (HTTP ${response.status}).`);

            const aiMsg = {
                id: (Date.now() + 1).toString(),
                sender: 'ai',
                text: data.answer || 'I could not generate an answer.',
                sources: Array.isArray(data.sources) ? data.sources : [],
            };
            setMessages((prev) => [...prev, aiMsg]);
        } catch (err) {
            setMessages((prev) => [
                ...prev,
                {
                    id: (Date.now() + 1).toString(),
                    sender: 'ai',
                    text: `⚠️ Error: ${err.message}`,
                    sources: [],
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const suggestions = [
        'What features did the co-founder discuss?',
        'Summarize key decisions across all meetings',
        'What follow-ups and action items are pending?',
    ];

    return (
        <div className="chat-backdrop" onClick={onClose}>
            <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="chat-header">
                    <div className="chat-title-group">
                        <span className="chat-badge">AI RAG CO-PILOT</span>
                        <h3>Ask MeetWise</h3>
                    </div>
                    <div className="chat-header-actions">
                        <div className="chat-model-toggle">
                            <button
                                className={`model-pill ${chatModel === 'gemini' ? 'active' : ''}`}
                                onClick={() => setChatModel('gemini')}
                            >
                                Gemini
                            </button>
                            <button
                                className={`model-pill ${chatModel === 'nvidia' ? 'active' : ''}`}
                                onClick={() => setChatModel('nvidia')}
                            >
                                Nemotron
                            </button>
                        </div>
                        <button className="close-btn" onClick={onClose}>✕</button>
                    </div>
                </div>

                <div className="chat-messages">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`chat-message ${msg.sender}`}>
                            <div className="message-content">
                                <p>{msg.text}</p>
                                {msg.sources?.length > 0 && (
                                    <div className="message-sources">
                                        <span className="sources-label">Referenced Meetings:</span>
                                        <div className="sources-badges">
                                            {msg.sources.map((src, idx) => (
                                                <button
                                                    key={idx}
                                                    className="source-badge"
                                                    title="Click to view this meeting"
                                                    onClick={() => {
                                                        onSelectMeeting(src.meetingId);
                                                        onClose();
                                                    }}
                                                >
                                                    📌 {src.title}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div className="chat-message ai loading-msg">
                            <div className="dots-loader">
                                <span></span><span></span><span></span>
                            </div>
                            <small>Searching meeting transcripts with {chatModel === 'nvidia' ? 'NVIDIA Nemotron' : 'Gemini'}...</small>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {messages.length <= 2 && (
                    <div className="chat-suggestions">
                        <span>Suggested Queries:</span>
                        <div className="suggestions-list">
                            {suggestions.map((text, i) => (
                                <button key={i} className="suggestion-chip" onClick={() => handleSend(text)}>
                                    💡 {text}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSend();
                    }}
                    className="chat-input-form"
                >
                    <input
                        type="text"
                        placeholder="Ask about meetings, features, decisions..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={loading}
                        autoFocus
                    />
                    <button type="submit" className="chat-send-btn" disabled={!input.trim() || loading}>
                        Send ➔
                    </button>
                </form>
            </div>
        </div>
    );
}
