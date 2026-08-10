/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from 'react';
import CalendarEventModal from './components/CalendarEventModal';
import ChatDrawer from './components/ChatDrawer';
import { isSchedulableText, extractDateAndTime } from './utils/calendar';
import LanguageSelector from './components/LanguageSelector';
import Progress from './components/Progress';
import Transcript from './components/Transcript';

const STORAGE_KEY = 'meetwise-meetings-v1';
const newId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const formatDate = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const formatDuration = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function getTranscriptText(input) {
    if (!input) return '';
    const t = input.transcript ?? input;
    if (typeof t === 'string') return t.trim();
    if (Array.isArray(t?.chunks) && t.chunks.length > 0) {
        return t.chunks.map(({ text }) => text).join('').trim();
    }
    if (typeof t?.text === 'string') return t.text.trim();
    return '';
}

function MeetingCard({ meeting, active, onClick }) {
    const title = meeting.title || 'Untitled meeting';
    return <button className={`meeting-card ${active ? 'active' : ''}`} onClick={onClick}><span>{title}</span><small>{formatDate(meeting.createdAt)} · {formatDuration(meeting.duration)}</small><b>›</b></button>;
}

export default function App() {
    const worker = useRef(null);
    const mediaRecorder = useRef(null);
    const mediaStream = useRef(null);
    const recordingStart = useRef(0);
    const loadReady = useRef(null);
    const [meetings, setMeetings] = useState(() => JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
    const [selectedId, setSelectedId] = useState(() => JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')[0]?.id || null);
    const [status, setStatus] = useState('idle');
    const [progressItems, setProgressItems] = useState([]);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [recording, setRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [devices, setDevices] = useState([]);
    const [deviceId, setDeviceId] = useState('default');
    const [language, setLanguage] = useState('en');
    const [tab, setTab] = useState('notes');
    const [error, setError] = useState('');
    const [audioUrl, setAudioUrl] = useState('');
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [summaryModel, setSummaryModel] = useState('gemini');
    const [chatOpen, setChatOpen] = useState(false);

    const selectedMeeting = meetings.find((meeting) => meeting.id === selectedId) || null;
    const updateMeeting = useCallback((id, changes) => setMeetings((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item)), []);

    useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings)); }, [meetings]);
    useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
    useEffect(() => {
        const timer = setInterval(() => { if (recording) setRecordingSeconds((Date.now() - recordingStart.current) / 1000); }, 300);
        return () => clearInterval(timer);
    }, [recording]);

    const refreshDevices = useCallback(async () => {
        const available = await navigator.mediaDevices.enumerateDevices();
        setDevices(available.filter((device) => device.kind === 'audioinput'));
    }, []);
    useEffect(() => { navigator.mediaDevices?.addEventListener('devicechange', refreshDevices); return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices); }, [refreshDevices]);

    useEffect(() => {
        worker.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        const onMessage = ({ data }) => {
            if (data.status === 'loading') { setStatus('loading'); setLoadingMessage(data.data); }
            if (data.status === 'initiate') setProgressItems((items) => [...items, data]);
            if (data.status === 'progress') setProgressItems((items) => items.map((item) => item.file === data.file ? { ...item, ...data } : item));
            if (data.status === 'done') setProgressItems((items) => items.filter((item) => item.file !== data.file));
            if (data.status === 'loaded') { setStatus('ready'); loadReady.current?.resolve(); loadReady.current = null; }
            if (data.status === 'complete') { updateMeeting(data.meetingId, { ...data.result, state: 'complete', processingTime: data.time }); setStatus('ready'); setTab('notes'); autoSummarize.current?.(data.meetingId, data.result.transcript); }
            if (data.status === 'error') { setError(data.error || 'The audio could not be processed.'); setStatus('ready'); loadReady.current?.reject(new Error(data.error)); loadReady.current = null; }
        };
        worker.current.addEventListener('message', onMessage);
        return () => { worker.current.removeEventListener('message', onMessage); worker.current.terminate(); };
    }, [updateMeeting]);

    const ensureModels = useCallback(async () => {
        if (status === 'ready' || status === 'running') return;
        if (status === 'loading') return loadReady.current?.promise;
        setError('');
        let resolveLoad;
        let rejectLoad;
        const promise = new Promise((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject; });
        loadReady.current = { resolve: resolveLoad, reject: rejectLoad, promise };
        worker.current.postMessage({ type: 'load', data: { device: navigator.gpu ? 'webgpu' : 'wasm' } });
        return promise;
    }, [status]);

    const getAudioStream = async (targetDeviceId) => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Microphone access is not supported by this browser. If you are using an in-app browser (like Instagram, LinkedIn, or Slack), please open the link in Safari or Chrome.');
        }
        try {
            const audioConstraints = targetDeviceId && targetDeviceId !== 'default'
                ? { deviceId: { ideal: targetDeviceId }, echoCancellation: true, noiseSuppression: true }
                : { echoCancellation: true, noiseSuppression: true };
            return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } catch {
            return await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    };

    const decodeAndTranscribe = (audioSource, targetMeeting) => {
        setStatus('running');
        updateMeeting(targetMeeting.id, { state: 'transcribing' });
        worker.current.postMessage({ type: 'run', data: { audio: audioSource, language, meetingId: targetMeeting.id } });
    };

    const createMeeting = () => {
        const meeting = { id: newId(), title: 'Untitled meeting', createdAt: Date.now(), duration: 0, state: 'new' };
        setMeetings((items) => [meeting, ...items]); setSelectedId(meeting.id); setTab('notes'); setAudioUrl('');
    };

    const startRecording = async () => {
        let stream;
        try {
            await ensureModels();
            stream = await getAudioStream(deviceId);
            mediaStream.current = stream;
            const chunks = [];
            const recorder = new MediaRecorder(stream);
            mediaRecorder.current = recorder;
            let meeting = selectedMeeting;
            if (!meeting || hasRecording) {
                meeting = { id: newId(), title: 'Untitled meeting', createdAt: Date.now(), duration: 0, state: 'queued' };
                setMeetings((items) => [meeting, ...items]); setSelectedId(meeting.id);
            }
            setTab('notes');
            recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                setAudioUrl((oldUrl) => { if (oldUrl) URL.revokeObjectURL(oldUrl); return URL.createObjectURL(blob); });
                const duration = (Date.now() - recordingStart.current) / 1000;
                updateMeeting(meeting.id, { duration, state: 'queued' });
                stream.getTracks().forEach((track) => track.stop());
                
                const processRecording = async () => {
                    const context = new AudioContext({ sampleRate: 16_000 });
                    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
                    const audio = new Float32Array(decoded.length);
                    for (let index = 0; index < decoded.length; index += 1) {
                        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) audio[index] += decoded.getChannelData(channel)[index] / decoded.numberOfChannels;
                    }
                    await context.close();
                    decodeAndTranscribe(audio, meeting);
                };
                processRecording().catch(reason => { updateMeeting(meeting.id, { state: 'error' }); setError(`Could not decode the recording: ${reason.message}`); });
            };
            recordingStart.current = Date.now(); setRecordingSeconds(0); setRecording(true); recorder.start(1000);
        } catch (reason) {
            if (stream) stream.getTracks().forEach((track) => track.stop());
            setError(`Model loading error: ${reason.message}`);
        }
    };
    const stopRecording = () => { if (mediaRecorder.current?.state === 'recording') { mediaRecorder.current.stop(); setRecording(false); } };

    const importFile = async (file) => {
        if (!file) return;
        await ensureModels();
        const meeting = { id: newId(), title: 'Untitled meeting', createdAt: Date.now(), duration: 0, state: 'queued' };
        setMeetings((items) => [meeting, ...items]); setSelectedId(meeting.id); setTab('transcript');
        setAudioUrl((oldUrl) => { if (oldUrl) URL.revokeObjectURL(oldUrl); return URL.createObjectURL(file); });
        
        const context = new AudioContext({ sampleRate: 16_000 });
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        const audio = new Float32Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
            for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) audio[index] += decoded.getChannelData(channel)[index] / decoded.numberOfChannels;
        }
        await context.close();
        decodeAndTranscribe(audio, meeting);
    };

    const modelLabel = summaryModel === 'nvidia' ? 'NVIDIA Nemotron' : 'Gemini';

    const summarize = useCallback(async (task, meetingId, overrideTranscript) => {
        const targetId = meetingId || selectedId;
        const target = meetings.find((m) => m.id === targetId);
        const text = getTranscriptText(overrideTranscript || target);
        if (!text) return setError('Finish transcription before summarizing.');
        updateMeeting(targetId, { summaryState: task });
        const endpoint = summaryModel === 'nvidia' ? '/api/summarize/nvidia' : '/api/summarize';
        try {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, transcript: text, title: target?.title || 'Meeting' }) });
            const rawResponse = await response.text();
            let payload;
            try { payload = rawResponse ? JSON.parse(rawResponse) : {}; } catch { throw new Error(`Summary service returned an invalid response (HTTP ${response.status}). Run the app with npm run dev or npm start, not npm run preview.`); }
            if (!response.ok) throw new Error(payload.error || `${modelLabel} summary service failed (HTTP ${response.status}).`);
            if (!payload.result) throw new Error(`${modelLabel} returned no structured meeting data.`);
            const sharedChanges = { title: payload.result.title || target?.title, summaryState: null, summaryProvider: summaryModel };
            updateMeeting(targetId, task === 'summary'
                ? { ...sharedChanges, summary: { overview: payload.result.overview, decisions: payload.result.decisions, actionItems: payload.result.actionItems, openQuestions: payload.result.openQuestions }, refinedTranscript: payload.result.refinedTranscript }
                : { ...sharedChanges, refinedTranscript: payload.result.refinedTranscript });
        } catch (reason) { updateMeeting(targetId, { summaryState: null }); setError(reason.message); }
    }, [meetings, selectedId, updateMeeting, summaryModel, modelLabel]);

    const autoSummarize = useRef(null);
    useEffect(() => { autoSummarize.current = (id, transcript) => summarize('summary', id, transcript); }, [summarize]);

    const renameSelected = () => { const title = prompt('Meeting title', selectedMeeting?.title); if (title?.trim()) updateMeeting(selectedMeeting.id, { title: title.trim() }); };
    const removeSelected = () => { if (selectedMeeting && confirm(`Delete “${selectedMeeting.title}”?`)) { setMeetings((items) => items.filter((item) => item.id !== selectedMeeting.id)); setSelectedId(meetings.find((item) => item.id !== selectedMeeting.id)?.id || null); } };

    const hasRecording = selectedMeeting && selectedMeeting.state !== 'new';

    return <main className="meeting-app">
        {status === 'loading' && <div className="model-overlay"><div className="progress-panel"><p>{loadingMessage}</p>{progressItems.map(({ file, progress, total }) => <Progress key={file} text={file} percentage={progress} total={total} />)}</div></div>}
        <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
            <div className="sidebar-header">
                <div className="brand-group">
                    <button 
                        className="mobile-menu-toggle" 
                        onClick={() => setMobileMenuOpen((open) => !open)}
                        aria-label="Toggle meeting history menu"
                    >
                        {mobileMenuOpen ? '✕' : '☰'}
                    </button>
                    <div className="brand"><i>◒</i><span>meetwise</span></div>
                </div>
                <div className="sidebar-actions">
                    <button className="new-meeting" onClick={() => { createMeeting(); setMobileMenuOpen(false); }} disabled={recording || status === 'running'}>+ New meeting</button>
                </div>
            </div>
            <div className="sidebar-body">
                <div className="sidebar-body-header">
                    <h3>Meeting History</h3>
                    <button className="close-menu-btn" onClick={() => setMobileMenuOpen(false)}>✕</button>
                </div>
                <div className="meeting-list">{meetings.length ? meetings.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} active={meeting.id === selectedId} onClick={() => { setSelectedId(meeting.id); setMobileMenuOpen(false); }} />) : <p className="empty-list">Your recorded meetings will appear here.</p>}</div>
                <div className="privacy-note">TRANSCRIPTION STAYS ON THIS DEVICE<br />Only transcript text is sent to the AI model when you ask for notes or chat.</div>
            </div>
        </aside>
        {mobileMenuOpen && <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />}
        <section className="main-panel"><header className="topbar"><div><p className="eyebrow">MEETING WORKSPACE</p><h1>{selectedMeeting?.title || 'Your meeting co-pilot'}</h1></div><div className="header-actions">{selectedMeeting && <><button onClick={renameSelected}>Rename</button><button onClick={removeSelected}>Delete</button></>}</div></header>
            <div className="recording-console"><div className={`record-indicator ${recording ? 'live' : ''}`}><span></span><div><b>{recording ? 'Recording now' : status === 'running' || selectedMeeting?.state === 'transcribing' || selectedMeeting?.state === 'queued' ? 'Transcribing recording' : hasRecording ? 'Recording completed' : 'Ready for your next meeting'}</b><small>{recording ? formatDuration(recordingSeconds) : 'Select your mic and press record'}</small></div></div><div className="console-controls"><label className="device-select"><span>Microphone</span><select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} onClick={refreshDevices}><option value="default">System default microphone</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label><label className="device-select language-select"><span>Language</span><LanguageSelector language={language} setLanguage={setLanguage} /></label><label className="upload-button">Import<input type="file" accept="audio/*,video/*" hidden onChange={(event) => importFile(event.target.files[0])} /></label><button className={`record-button ${recording ? 'stop' : ''}`} onClick={recording ? stopRecording : startRecording} disabled={recording ? false : (status === 'running' || hasRecording)} title={hasRecording && !recording ? 'This meeting already has a recording. Click "+ New meeting" to record again.' : ''}>{recording ? '■ Stop' : hasRecording ? '● Submitted' : '● Start recording'}</button></div></div>
            {error && <p className="error-message">{error}<button onClick={() => setError('')}>×</button></p>}
            {selectedMeeting ? <><nav className="tabs"><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notes</button><button className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>Full transcription</button></nav>{tab === 'notes' ? <Notes meeting={selectedMeeting} summarize={summarize} summaryModel={summaryModel} setSummaryModel={setSummaryModel} modelLabel={modelLabel} updateMeeting={updateMeeting} /> : <TranscriptView meeting={selectedMeeting} audioUrl={audioUrl} summarize={summarize} language={language} summaryModel={summaryModel} modelLabel={modelLabel} />}</> : <section className="welcome"><div className="orb">◌</div><h2>Capture the conversation.</h2><p>Start a recording, then get searchable speaker-aware transcription and focused meeting notes.</p><button className="record-button" onClick={startRecording}>● Start recording</button></section>}
        </section>

        {!chatOpen && (
            <button className="copilot-fab" onClick={() => setChatOpen(true)} title="Ask MeetWise Co-Pilot">
                <span className="fab-icon">💬</span>
                <span className="fab-label">Co-Pilot</span>
            </button>
        )}

        <ChatDrawer
            isOpen={chatOpen}
            onClose={() => setChatOpen(false)}
            meetings={meetings}
            onSelectMeeting={setSelectedId}
        />
    </main>;
}

function Notes({ meeting, summarize, summaryModel, setSummaryModel, modelLabel, updateMeeting }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState(null);
    const [activeCalendarEvent, setActiveCalendarEvent] = useState(null);

    const isTranscribing = meeting.state === 'queued' || meeting.state === 'transcribing';
    if (isTranscribing) return (
        <section className="notes-card">
            <div className="transcription-loading-card">
                <div className="pulse-rings">
                    <span className="ring ring-1"></span>
                    <span className="ring ring-2"></span>
                    <span className="ring ring-3"></span>
                    <i className="audio-wave-icon">🎙️</i>
                </div>
                <h3>{meeting.state === 'queued' ? 'Preparing audio...' : 'Transcribing audio & identifying speakers...'}</h3>
                <p className="loading-subtext">Whisper is analyzing word-level timestamps and speaker diarization. Meeting notes will generate automatically as soon as it finishes.</p>
                <div className="dots-loader">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </section>
    );

    if (meeting.summaryState === 'summary') return (
        <section className="notes-card">
            <div className="transcription-loading-card">
                <div className="dots-loader" style={{ marginBottom: '16px' }}>
                    <span></span><span></span><span></span>
                </div>
                <h3>{modelLabel} is turning this meeting into notes...</h3>
                <p className="loading-subtext">Extracting overview, key decisions, action items, and open questions.</p>
            </div>
        </section>
    );

    if (!meeting.summary) return (
        <section className="notes-card empty-notes">
            <p className="note-kicker">AI MEETING NOTES</p>
            <h2>{meeting.state === 'complete' ? 'Generating notes…' : 'Turn this conversation into clarity.'}</h2>
            <p>{meeting.state === 'complete' ? `${modelLabel} is automatically analysing the transcript. This usually takes a few seconds.` : 'Notes will be generated automatically once transcription completes.'}</p>
            {meeting.state === 'complete' && <button className="gemini-button" onClick={() => summarize('summary')}>✦ Retry generating notes</button>}
        </section>
    );

    const rawSummary = typeof meeting.summary === 'string'
        ? { overview: meeting.summary, decisions: [], actionItems: [], openQuestions: [], scheduledEvents: [] }
        : meeting.summary;

    const summary = {
        overview: rawSummary.overview || '',
        decisions: Array.isArray(rawSummary.decisions) ? rawSummary.decisions : [],
        actionItems: Array.isArray(rawSummary.actionItems) ? rawSummary.actionItems : [],
        openQuestions: Array.isArray(rawSummary.openQuestions) ? rawSummary.openQuestions : [],
        scheduledEvents: Array.isArray(rawSummary.scheduledEvents) ? rawSummary.scheduledEvents : [],
    };

    const providerLabel = meeting.summaryProvider === 'nvidia' ? 'NVIDIA NEMOTRON' : 'GEMINI';

    const startEditing = () => {
        setEditData(JSON.parse(JSON.stringify(summary)));
        setIsEditing(true);
    };

    const saveEdits = () => {
        updateMeeting(meeting.id, { summary: editData });
        setIsEditing(false);
        setEditData(null);
    };

    const cancelEdits = () => {
        setIsEditing(false);
        setEditData(null);
    };

    const updateArrayItem = (key, index, value) => {
        const next = [...(editData[key] || [])];
        next[index] = value;
        setEditData({ ...editData, [key]: next });
    };

    const removeArrayItem = (key, index) => {
        const next = (editData[key] || []).filter((_, i) => i !== index);
        setEditData({ ...editData, [key]: next });
    };

    const addArrayItem = (key, defaultVal = '') => {
        setEditData({ ...editData, [key]: [...(editData[key] || []), defaultVal] });
    };

    const updateEventField = (index, field, value) => {
        const events = [...(editData.scheduledEvents || [])];
        events[index] = { ...events[index], [field]: value };
        setEditData({ ...editData, scheduledEvents: events });
    };

    const removeEvent = (index) => {
        const events = (editData.scheduledEvents || []).filter((_, i) => i !== index);
        setEditData({ ...editData, scheduledEvents: events });
    };

    const addEvent = () => {
        const newEvt = { title: 'New Event / Plan', description: '', date: 'Tomorrow', time: '10:00 AM' };
        setEditData({ ...editData, scheduledEvents: [...(editData.scheduledEvents || []), newEvt] });
    };

    return (
        <section className="notes-card">
            {activeCalendarEvent && (
                <CalendarEventModal
                    initialEvent={activeCalendarEvent}
                    onClose={() => setActiveCalendarEvent(null)}
                />
            )}
            <div className="notes-header">
                <div>
                    <p className="note-kicker">{providerLabel} NOTES</p>
                    <h2>{meeting.title}</h2>
                </div>
                <div className="notes-header-actions">
                    {!isEditing ? (
                        <>
                            <button className="subtle-button edit-notes-btn" onClick={startEditing}>
                                ✎ Edit Notes
                            </button>
                            <div className="model-selector">
                                <button className={`model-option ${summaryModel === 'gemini' ? 'active' : ''}`} onClick={() => setSummaryModel('gemini')}>
                                    <span className="model-dot gemini-dot"></span>Gemini
                                </button>
                                <button className={`model-option ${summaryModel === 'nvidia' ? 'active' : ''}`} onClick={() => setSummaryModel('nvidia')}>
                                    <span className="model-dot nvidia-dot"></span>NVIDIA
                                </button>
                            </div>
                            <button className="subtle-button" onClick={() => summarize('summary')}>Regenerate</button>
                        </>
                    ) : (
                        <div className="edit-actions">
                            <button className="subtle-button" onClick={cancelEdits}>Cancel</button>
                            <button className="save-notes-btn" onClick={saveEdits}>✓ Save Edits</button>
                        </div>
                    )}
                </div>
            </div>

            {isEditing ? (
                <div className="notes-edit-form">
                    <section className="edit-section">
                        <label className="edit-label">Summary Overview</label>
                        <textarea
                            className="edit-textarea"
                            rows={4}
                            value={editData.overview}
                            onChange={(e) => setEditData({ ...editData, overview: e.target.value })}
                        />
                    </section>

                    <section className="edit-section">
                        <div className="section-title-row">
                            <label className="edit-label">Key Decisions</label>
                            <button type="button" className="add-item-btn" onClick={() => addArrayItem('decisions', 'New decision')}>+ Add Decision</button>
                        </div>
                        {editData.decisions.map((item, idx) => (
                            <div key={idx} className="edit-item-row">
                                <input
                                    type="text"
                                    className="edit-input"
                                    value={item}
                                    onChange={(e) => updateArrayItem('decisions', idx, e.target.value)}
                                />
                                <button type="button" className="remove-item-btn" onClick={() => removeArrayItem('decisions', idx)}>✕</button>
                            </div>
                        ))}
                    </section>

                    <section className="edit-section">
                        <div className="section-title-row">
                            <label className="edit-label">Action Items</label>
                            <button type="button" className="add-item-btn" onClick={() => addArrayItem('actionItems', 'New action item')}>+ Add Action Item</button>
                        </div>
                        {editData.actionItems.map((item, idx) => (
                            <div key={idx} className="edit-item-row">
                                <input
                                    type="text"
                                    className="edit-input"
                                    value={item}
                                    onChange={(e) => updateArrayItem('actionItems', idx, e.target.value)}
                                />
                                <button type="button" className="remove-item-btn" onClick={() => removeArrayItem('actionItems', idx)}>✕</button>
                            </div>
                        ))}
                    </section>

                    <section className="edit-section">
                        <div className="section-title-row">
                            <label className="edit-label">Scheduled Events & Weekend Plans</label>
                            <button type="button" className="add-item-btn" onClick={addEvent}>+ Add Event</button>
                        </div>
                        {editData.scheduledEvents.map((evt, idx) => (
                            <div key={idx} className="edit-event-card">
                                <div className="edit-event-grid">
                                    <input
                                        type="text"
                                        className="edit-input"
                                        placeholder="Event Title"
                                        value={evt.title || ''}
                                        onChange={(e) => updateEventField(idx, 'title', e.target.value)}
                                    />
                                    <input
                                        type="text"
                                        className="edit-input"
                                        placeholder="Date / Day (e.g. Next Saturday)"
                                        value={evt.date || ''}
                                        onChange={(e) => updateEventField(idx, 'date', e.target.value)}
                                    />
                                    <input
                                        type="text"
                                        className="edit-input"
                                        placeholder="Time (e.g. 10:00 AM)"
                                        value={evt.time || ''}
                                        onChange={(e) => updateEventField(idx, 'time', e.target.value)}
                                    />
                                </div>
                                <input
                                    type="text"
                                    className="edit-input"
                                    placeholder="Details / Context"
                                    value={evt.description || ''}
                                    onChange={(e) => updateEventField(idx, 'description', e.target.value)}
                                />
                                <button type="button" className="remove-item-btn" onClick={() => removeEvent(idx)}>✕ Remove Event</button>
                            </div>
                        ))}
                    </section>

                    <section className="edit-section">
                        <div className="section-title-row">
                            <label className="edit-label">Open Questions</label>
                            <button type="button" className="add-item-btn" onClick={() => addArrayItem('openQuestions', 'New question')}>+ Add Question</button>
                        </div>
                        {editData.openQuestions.map((item, idx) => (
                            <div key={idx} className="edit-item-row">
                                <input
                                    type="text"
                                    className="edit-input"
                                    value={item}
                                    onChange={(e) => updateArrayItem('openQuestions', idx, e.target.value)}
                                />
                                <button type="button" className="remove-item-btn" onClick={() => removeArrayItem('openQuestions', idx)}>✕</button>
                            </div>
                        ))}
                    </section>
                </div>
            ) : (
                <article className="notes-content">
                    {summary.scheduledEvents.length > 0 && (
                        <section className="notes-section events-section">
                            <h3>📅 Scheduled Events & Weekend Plans</h3>
                            <div className="events-cards-container">
                                {summary.scheduledEvents.map((evt, index) => (
                                    <div key={index} className="event-card">
                                        <div className="event-card-header">
                                            <h4>{evt.title}</h4>
                                            <span className="event-time-badge">
                                                {evt.date}{evt.time ? ` @ ${evt.time}` : ''}
                                            </span>
                                        </div>
                                        {evt.description && <p className="event-card-desc">{evt.description}</p>}
                                        <button
                                            className="gcal-card-btn"
                                            onClick={() => {
                                                const fallback = extractDateAndTime(`${evt.title} ${evt.description || ''}`);
                                                setActiveCalendarEvent({
                                                    title: evt.title,
                                                    description: evt.description || `Discussed during ${meeting.title}`,
                                                    date: evt.date || fallback.date,
                                                    time: evt.time || fallback.time
                                                });
                                            }}
                                        >
                                            ✦ Add to Google Calendar
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className="notes-section">
                        <h3>Summary</h3>
                        <p>{summary.overview}</p>
                    </section>

                    {summary.decisions.length > 0 && (
                        <section className="notes-section">
                            <h3>Key decisions</h3>
                            <ul>
                                {summary.decisions.map((item, index) => (
                                    <li key={index}>{item}</li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {summary.actionItems.length > 0 && (
                        <section className="notes-section">
                            <h3>Action items</h3>
                            <ul className="action-items-list">
                                {summary.actionItems.map((item, index) => {
                                    const canSchedule = isSchedulableText(item);
                                    if (!canSchedule) {
                                        return <li key={index}>{item}</li>;
                                    }
                                    return (
                                        <li key={index} className="action-item-row">
                                            <span>{item}</span>
                                            <button
                                                className="schedule-badge-btn"
                                                title="Schedule this action item in Google Calendar"
                                                onClick={() => {
                                                    const extracted = extractDateAndTime(item);
                                                    setActiveCalendarEvent({
                                                        title: item,
                                                        description: `Action item from meeting: ${meeting.title}`,
                                                        date: extracted.date,
                                                        time: extracted.time
                                                    });
                                                }}
                                            >
                                                📅 Schedule
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}

                    {summary.openQuestions.length > 0 && (
                        <section className="notes-section">
                            <h3>Open questions</h3>
                            <ul>
                                {summary.openQuestions.map((item, index) => (
                                    <li key={index}>{item}</li>
                                ))}
                            </ul>
                        </section>
                    )}
                </article>
            )}
        </section>
    );
}

function TranscriptView({ meeting, audioUrl, summarize, language, summaryModel, modelLabel }) {
    const audioRef = useRef(null);
    const [currentTime, setCurrentTime] = useState(0);
    const isBusy = meeting.state === 'queued' || meeting.state === 'transcribing';

    const seekTo = (time) => {
        setCurrentTime(time);
        if (audioRef.current) { audioRef.current.currentTime = time; audioRef.current.play(); }
    };

    if (isBusy) return <section className="transcript-panel"><div className="shimmer">{meeting.state === 'queued' ? 'Preparing your audio…' : 'Whisper is transcribing and identifying speakers…'}</div></section>;
    if (!meeting.transcript) return <section className="transcript-panel">No transcript is available yet.</section>;
    const refineProvider = meeting.summaryProvider === 'nvidia' ? 'NVIDIA NEMOTRON' : 'GEMINI';
    return <section className="transcript-panel">{audioUrl && <audio ref={audioRef} style={{ display: 'none' }} src={audioUrl} onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)} onLoadedMetadata={() => setCurrentTime(0)} />}<Transcript className="transcript-body" transcript={meeting.transcript} segments={meeting.segments || []} currentTime={currentTime} setCurrentTime={seekTo} audioRef={audioRef} language={language} />{meeting.refinedTranscript && <div className="refined-copy"><p className="note-kicker">{refineProvider}-REFINED COPY</p><p>{meeting.refinedTranscript}</p></div>}<button className="gemini-button refine-button" onClick={() => summarize('refine')} disabled={meeting.summaryState === 'refine'}>{meeting.summaryState === 'refine' ? `✦ Refining with ${modelLabel}…` : `✦ Refine with ${modelLabel}`}</button></section>;
}


