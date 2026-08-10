/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from 'react';

const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const formatTimestamp = (s = 0) => `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
const formatDurationShort = (s = 0) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return mins > 0 ? `${mins}m ${pad(secs)}s` : `${secs}s`;
};

/* Speaker colour palette – matches screenshot tones */
const SPEAKER_COLORS = [
    { bg: 'rgba(56, 120, 255, 0.12)', border: 'rgba(56, 120, 255, 0.28)', accent: '#5b9aff', avatarBg: 'linear-gradient(135deg, #3878ff, #6db3f2)' },
    { bg: 'rgba(46, 196, 134, 0.12)', border: 'rgba(46, 196, 134, 0.28)', accent: '#2ec486', avatarBg: 'linear-gradient(135deg, #2ec486, #78e0b4)' },
    { bg: 'rgba(196, 120, 255, 0.12)', border: 'rgba(196, 120, 255, 0.28)', accent: '#c478ff', avatarBg: 'linear-gradient(135deg, #c478ff, #e0a8ff)' },
    { bg: 'rgba(255, 180, 60, 0.12)', border: 'rgba(255, 180, 60, 0.28)', accent: '#ffb43c', avatarBg: 'linear-gradient(135deg, #ffb43c, #ffe08a)' },
    { bg: 'rgba(255, 100, 120, 0.12)', border: 'rgba(255, 100, 120, 0.28)', accent: '#ff6478', avatarBg: 'linear-gradient(135deg, #ff6478, #ffb0ba)' },
    { bg: 'rgba(80, 220, 230, 0.12)', border: 'rgba(80, 220, 230, 0.28)', accent: '#50dce6', avatarBg: 'linear-gradient(135deg, #50dce6, #a0f0f4)' },
];

/* Inline SVG icons */
const SpeakerGroupIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const PersonIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
);

const PlayIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
);

const PauseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
);

const DotsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
);

const DownloadIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

const ChevronDownIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

const GlobeIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);

/* Fake waveform bars for visual effect */
function WaveformBars({ playing }) {
    const bars = useRef(Array.from({ length: 28 }, () => 0.15 + Math.random() * 0.85));
    return (
        <div className="dt-waveform">
            {bars.current.map((h, i) => (
                <span key={i} className={`dt-waveform-bar ${playing ? 'dt-waveform-animate' : ''}`} style={{ height: `${h * 100}%`, animationDelay: `${i * 40}ms` }} />
            ))}
        </div>
    );
}

function Word({ chunk, currentTime, onClick }) {
    const ref = useRef(null);
    const [start, end] = chunk.timestamp;
    const active = start <= currentTime && currentTime < end;
    useEffect(() => { if (active) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [active]);
    return (
        <>
            {chunk.text.startsWith(' ') ? ' ' : ''}
            <button
                ref={ref}
                className={`dt-word ${active ? 'dt-word-active' : ''}`}
                onClick={onClick}
                title={`${formatTimestamp(start)} → ${formatTimestamp(end)}`}
            >
                {chunk.text.trim()}
            </button>
        </>
    );
}

export default function Transcript({ transcript, segments = [], currentTime, setCurrentTime, audioRef, language, ...props }) {
    const [playing, setPlaying] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);

    /* Sync play state with audio element */
    useEffect(() => {
        const audio = audioRef?.current;
        if (!audio) return;
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        return () => { audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause); };
    }, [audioRef]);

    const turns = useMemo(() => {
        const words = transcript?.chunks || [];
        const diarized = [...segments].filter((s) => s.label !== 'NO_SPEAKER').sort((a, b) => a.start - b.start);
        const source = diarized.length
            ? diarized
            : [{ id: 0, label: 'SPEAKER_00', start: words[0]?.timestamp?.[0] || 0, end: words.at(-1)?.timestamp?.[1] || 0 }];
        const speakerIds = [...new Set(source.map((s) => s.id ?? s.label))];
        return source.map((seg) => {
            const key = seg.id ?? seg.label;
            const chunks = words.filter((w) => w.timestamp?.[0] < seg.end && w.timestamp?.[1] >= seg.start);
            return { ...seg, chunks, speakerNumber: speakerIds.indexOf(key) + 1 };
        }).filter((s) => s.chunks.length);
    }, [segments, transcript]);

    const speakerCount = useMemo(() => new Set(turns.map((t) => t.speakerNumber)).size, [turns]);
    const totalDuration = useMemo(() => {
        if (!turns.length) return 0;
        return Math.max(...turns.map((t) => t.end)) - Math.min(...turns.map((t) => t.start));
    }, [turns]);

    const togglePlay = () => {
        const audio = audioRef?.current;
        if (!audio) return;
        if (audio.paused) audio.play();
        else audio.pause();
    };

    const downloadJSON = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ ...transcript, segments }, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = 'transcript.json'; a.click(); URL.revokeObjectURL(url);
    };

    const downloadTXT = () => {
        const text = turns.map((t) => `Speaker ${t.speakerNumber} [${formatTimestamp(t.start)} - ${formatTimestamp(t.end)}]\n${t.chunks.map((c) => c.text).join('').trim()}`).join('\n\n');
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = document.createElement('a'); a.href = url; a.download = 'transcript.txt'; a.click(); URL.revokeObjectURL(url);
    };

    return (
        <div {...props} className={`${props.className || ''} dt-container`}>
            {/* ── Header ── */}
            <div className="dt-header">
                <div className="dt-header-left">
                    <span className="dt-header-icon"><SpeakerGroupIcon /></span>
                    <div>
                        <span className="dt-header-title">Speaker Diarization</span>
                        <span className="dt-speaker-count">{speakerCount} Speaker{speakerCount !== 1 ? 's' : ''} Detected</span>
                    </div>
                </div>
                <div className="dt-header-right">
                    <WaveformBars playing={playing} />
                    <span className="dt-time-display">
                        {formatTimestamp(currentTime)} / {formatTimestamp(totalDuration)}
                    </span>
                    <button className="dt-play-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
                        {playing ? <PauseIcon /> : <PlayIcon />}
                    </button>
                </div>
            </div>

            {/* ── Speaker cards ── */}
            <div className="dt-cards">
                {turns.map(({ start, end, chunks, speakerNumber }, index) => {
                    const color = SPEAKER_COLORS[(speakerNumber - 1) % SPEAKER_COLORS.length];
                    const duration = end - start;
                    return (
                        <article
                            className="dt-speaker-card"
                            key={`${start}-${end}-${index}`}
                            style={{ background: color.bg, borderColor: color.border }}
                        >
                            <div className="dt-card-header">
                                <div className="dt-card-left">
                                    <span className="dt-avatar" style={{ background: color.avatarBg }}>
                                        <PersonIcon />
                                    </span>
                                    <div className="dt-card-meta">
                                        <strong style={{ color: color.accent }}>Speaker {speakerNumber}</strong>
                                        <small>{formatTimestamp(start)} - {formatTimestamp(end)}</small>
                                    </div>
                                </div>
                                <div className="dt-card-right">
                                    <span className="dt-duration" style={{ color: color.accent }}>{formatDurationShort(duration)}</span>
                                    <button className="dt-dots-btn" title="More options"><DotsIcon /></button>
                                </div>
                            </div>
                            <p className="dt-card-text">
                                {chunks.map((chunk, ci) => (
                                    <Word
                                        key={ci}
                                        chunk={chunk}
                                        currentTime={currentTime}
                                        onClick={() => setCurrentTime(chunk.timestamp[0])}
                                    />
                                ))}
                            </p>
                        </article>
                    );
                })}
            </div>

            {/* ── Footer ── */}
            <div className="dt-footer">
                <span className="dt-lang-badge"><GlobeIcon /> Language: {language ? language.toUpperCase() : 'EN'}</span>
                <div className="dt-export-group">
                    <button className="dt-export-btn" onClick={downloadJSON}>
                        <DownloadIcon /> Export Transcript
                    </button>
                    <button className="dt-export-chevron" onClick={() => setExportOpen(!exportOpen)}>
                        <ChevronDownIcon />
                    </button>
                    {exportOpen && (
                        <div className="dt-export-dropdown">
                            <button onClick={() => { downloadJSON(); setExportOpen(false); }}>Export as JSON</button>
                            <button onClick={() => { downloadTXT(); setExportOpen(false); }}>Export as TXT</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
