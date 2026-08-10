/* eslint-disable react/prop-types */
import { useState, useRef, useEffect, useCallback } from 'react';
import { buildRagPayload } from '../utils/rag';

const STORAGE_KEY = 'meetwise-chat-sessions-v1';
const ACTIVE_SESSION_KEY = 'meetwise-active-session-v1';

const WELCOME_MSG = {
    id: 'welcome',
    sender: 'ai',
    text: 'Hello! I am your MeetWise Co-Pilot. Ask me anything about your past meetings, decisions, or co-founder discussions.',
    sources: [],
};

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createNewSession() {
    return {
        id: generateId(),
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [WELCOME_MSG],
    };
}

function loadSessions() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch { /* ignore */ }
    return [createNewSession()];
}

function saveSessions(sessions) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch { /* quota exceeded — silent fail */ }
}

function loadActiveSessionId() {
    return localStorage.getItem(ACTIVE_SESSION_KEY) || null;
}

function saveActiveSessionId(id) {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

/** Derive a short title from the first user message */
function deriveTitle(messages) {
    const firstUser = messages.find(m => m.sender === 'user');
    if (!firstUser) return 'New Chat';
    const text = firstUser.text.trim();
    return text.length > 42 ? text.slice(0, 42) + '…' : text;
}

function formatSessionDate(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ChatDrawer({ isOpen, onClose, meetings, onSelectMeeting }) {
    const [sessions, setSessions] = useState(loadSessions);
    const [activeId, setActiveId] = useState(() => {
        const savedId = loadActiveSessionId();
        const sess = loadSessions();
        const found = sess.find(s => s.id === savedId);
        return found ? found.id : sess[0].id;
    });
    const [showHistory, setShowHistory] = useState(false);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [chatModel, setChatModel] = useState('gemini');
    const messagesEndRef = useRef(null);

    const activeSession = sessions.find(s => s.id === activeId) || sessions[0];
    const messages = activeSession?.messages || [WELCOME_MSG];

    // Persist sessions & active ID whenever they change
    useEffect(() => {
        saveSessions(sessions);
    }, [sessions]);

    useEffect(() => {
        saveActiveSessionId(activeId);
    }, [activeId]);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        if (isOpen) scrollToBottom();
    }, [messages, isOpen, scrollToBottom]);

    if (!isOpen) return null;

    const updateActiveSession = (updater) => {
        setSessions(prev => prev.map(s => {
            if (s.id !== activeId) return s;
            const updated = typeof updater === 'function' ? updater(s) : { ...s, ...updater };
            updated.updatedAt = Date.now();
            // Auto-derive title from first user message if still 'New Chat'
            if (updated.title === 'New Chat') {
                updated.title = deriveTitle(updated.messages);
            }
            return updated;
        }));
    };

    const handleNewChat = () => {
        const newSession = createNewSession();
        setSessions(prev => [newSession, ...prev]);
        setActiveId(newSession.id);
        setShowHistory(false);
        setInput('');
    };

    const handleSelectSession = (id) => {
        setActiveId(id);
        setShowHistory(false);
        setInput('');
    };

    const handleDeleteSession = (e, id) => {
        e.stopPropagation();
        setSessions(prev => {
            const remaining = prev.filter(s => s.id !== id);
            if (remaining.length === 0) {
                const fresh = createNewSession();
                setActiveId(fresh.id);
                return [fresh];
            }
            if (activeId === id) {
                setActiveId(remaining[0].id);
            }
            return remaining;
        });
    };

    const handleSend = async (queryText) => {
        const text = (queryText || input).trim();
        if (!text || loading) return;

        const userMsg = { id: generateId(), sender: 'user', text };
        updateActiveSession(s => ({ ...s, messages: [...s.messages, userMsg] }));
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
                throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
            }

            if (!response.ok) throw new Error(data.error || `AI Co-Pilot service failed (HTTP ${response.status}).`);

            const aiMsg = {
                id: generateId(),
                sender: 'ai',
                text: data.answer || 'I could not generate an answer.',
                sources: Array.isArray(data.sources) ? data.sources : [],
            };
            updateActiveSession(s => ({ ...s, messages: [...s.messages, aiMsg] }));
        } catch (err) {
            updateActiveSession(s => ({
                ...s,
                messages: [...s.messages, {
                    id: generateId(),
                    sender: 'ai',
                    text: `⚠️ Error: ${err.message}`,
                    sources: [],
                }],
            }));
        } finally {
            setLoading(false);
        }
    };

    const suggestions = [
        'What features did the co-founder discuss?',
        'Summarize key decisions across all meetings',
        'What follow-ups and action items are pending?',
    ];

    // Group sessions by date category
    const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

    return (
        <div className="chat-backdrop" onClick={onClose}>
            <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="chat-header">
                    <div className="chat-title-group">
                        <div className="chat-header-top-row">
                            <button
                                className="chat-history-toggle"
                                onClick={() => setShowHistory(prev => !prev)}
                                title="Chat History"
                            >
                                {showHistory ? '✕' : '☰'}
                            </button>
                            <div>
                                <span className="chat-badge">AI RAG CO-PILOT</span>
                                <h3>{showHistory ? 'Chat History' : 'Ask MeetWise'}</h3>
                            </div>
                        </div>
                    </div>
                    <div className="chat-header-actions">
                        {!showHistory && (
                            <>
                                <button className="new-chat-header-btn" onClick={handleNewChat} title="New Chat">
                                    ✚
                                </button>
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
                            </>
                        )}
                        <button className="close-btn" onClick={onClose}>✕</button>
                    </div>
                </div>

                {/* History Sidebar Panel */}
                {showHistory ? (
                    <div className="chat-history-panel">
                        <button className="new-chat-full-btn" onClick={handleNewChat}>
                            <span>✚</span> New Chat
                        </button>
                        <div className="history-sessions-list">
                            {sortedSessions.map(session => (
                                <div
                                    key={session.id}
                                    className={`history-session-item ${session.id === activeId ? 'active' : ''}`}
                                    onClick={() => handleSelectSession(session.id)}
                                >
                                    <div className="history-session-info">
                                        <span className="history-session-title">{session.title}</span>
                                        <span className="history-session-meta">
                                            {formatSessionDate(session.updatedAt)} · {session.messages.filter(m => m.sender === 'user').length} messages
                                        </span>
                                    </div>
                                    <button
                                        className="history-delete-btn"
                                        title="Delete chat"
                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                    >
                                        🗑
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Chat Messages */}
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

                        {/* Suggestion Chips */}
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

                        {/* Input */}
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleSend();
                            }}
                            className="chat-input-form"
                        >
                            <textarea
                                className="chat-textarea"
                                placeholder="Ask about meetings, features, decisions..."
                                value={input}
                                onChange={(e) => {
                                    setInput(e.target.value);
                                    // Auto-grow
                                    e.target.style.height = 'auto';
                                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                disabled={loading}
                                rows={1}
                                autoFocus
                            />
                            <button type="submit" className="chat-send-btn" disabled={!input.trim() || loading}>
                                Send ➔
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
