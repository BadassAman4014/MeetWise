/* eslint-disable react/prop-types */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

const MediaInput = forwardRef(({ onInputChange, onTimeUpdate, ...props }, ref) => {
    const [dragging, setDragging] = useState(false);
    const [mediaUrl, setMediaUrl] = useState('');
    const [mediaType, setMediaType] = useState('');
    const fileInputRef = useRef(null);
    const mediaRef = useRef(null);

    useImperativeHandle(ref, () => ({ setMediaTime: (time) => { if (mediaRef.current) mediaRef.current.currentTime = time; } }));
    useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);

    const readFile = useCallback(async (file) => {
        if (!file || (!file.type.startsWith('audio/') && !file.type.startsWith('video/'))) return;
        try {
            const buffer = await file.arrayBuffer();
            const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16_000 });
            const decoded = await context.decodeAudioData(buffer.slice(0));
            const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
            const samples = new Float32Array(decoded.length);
            for (let i = 0; i < decoded.length; i += 1) samples[i] = channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length;
            await context.close();
            setMediaUrl((oldUrl) => { if (oldUrl) URL.revokeObjectURL(oldUrl); return URL.createObjectURL(file); });
            setMediaType(file.type);
            onInputChange(samples);
        } catch (error) { alert(`Could not decode this media file: ${error.message}`); }
    }, [onInputChange]);

    const onDrop = (event) => { event.preventDefault(); setDragging(false); readFile(event.dataTransfer.files[0]); };
    const onClick = (event) => { if (event.target === mediaRef.current) return; fileInputRef.current.click(); };
    const Media = mediaType.startsWith('video/') ? 'video' : 'audio';
    return <div {...props} onClick={onClick} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)}>
        <input type="file" accept="audio/*,video/*" onChange={(event) => readFile(event.target.files[0])} ref={fileInputRef} hidden />
        {mediaUrl ? <Media ref={mediaRef} src={mediaUrl} controls onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)} /> : <div className="dropzone" data-dragging={dragging}><span>Drop a media file here</span><small>or click to browse · audio and video supported</small></div>}
    </div>;
});
MediaInput.displayName = 'MediaInput';
export default MediaInput;
