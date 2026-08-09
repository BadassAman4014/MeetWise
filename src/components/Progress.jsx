/* eslint-disable react/prop-types */

function formatBytes(size) {
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return `${(size / 1024 ** i).toFixed(2)} ${['B', 'kB', 'MB', 'GB'][i]}`;
}

export default function Progress({ text, percentage = 0, total }) {
    return <div className="progress-item"><div className="progress-bar" style={{ width: `${percentage}%` }}>{text} ({percentage.toFixed(1)}%{Number.isNaN(total) ? '' : ` of ${formatBytes(total)}`})</div></div>;
}
