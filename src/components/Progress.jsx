/* eslint-disable react/prop-types */

function formatBytes(bytes) {
    if (!bytes || Number.isNaN(bytes) || bytes <= 0) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFriendlyName(path) {
    if (!path) return 'Model file';
    const lower = path.toLowerCase();
    if (lower.includes('decoder')) return 'Whisper Audio Decoder';
    if (lower.includes('encoder')) return 'Whisper Audio Encoder';
    if (lower.includes('pyannote') || lower.includes('segmentation')) return 'Pyannote Speaker Diarization';
    if (lower.includes('tokenizer')) return 'Tokenizer & Vocab';
    if (lower.includes('onnx')) return path.split('/').pop() || path;
    return path.split('/').pop() || path;
}

export default function Progress({ text, percentage = 0, total, loaded, status }) {
    const isDone = status === 'done' || percentage >= 100;
    const pct = isDone ? 100 : Math.min(100, Math.max(0, percentage));
    const friendlyName = getFriendlyName(text);
    const formattedLoaded = formatBytes(loaded);
    const formattedTotal = formatBytes(total);
    const sizeString = formattedTotal ? (formattedLoaded ? `${formattedLoaded} / ${formattedTotal}` : formattedTotal) : '';

    return (
        <div className={`progress-item ${isDone ? 'is-done' : ''}`}>
            <div className="progress-item-header">
                <div className="progress-item-title">
                    <span className="progress-file-icon">{isDone ? '✓' : '⚡'}</span>
                    <span className="progress-file-name">{friendlyName}</span>
                    {text && text !== friendlyName && <span className="progress-raw-path">{text}</span>}
                </div>
                <div className="progress-item-meta">
                    {sizeString && <span className="progress-size">{sizeString}</span>}
                    <span className="progress-percent-badge">{pct.toFixed(0)}%</span>
                </div>
            </div>
            <div className="progress-bar-track">
                <div
                    className={`progress-bar-fill ${isDone ? 'done-fill' : ''}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

