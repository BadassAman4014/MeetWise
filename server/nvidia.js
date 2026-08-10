/* eslint-disable no-undef */
import { promptFor, extractJson, normalizeResult, readJson } from './gemini.js';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';

export async function handleNvidiaSummarize(request, response) {
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    try {
        const { task = 'summary', transcript } = await readJson(request);
        if (!transcript?.trim()) throw new Error('A transcript is required.');
        if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not configured on the server. Add it to .env and restart the app.');

        const prompt = promptFor({ task, transcript: transcript.slice(0, 500000) });

        const upstream = await fetch(NVIDIA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                model: NVIDIA_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 65536,
                temperature: 0.2,
                top_p: 0.95,
                stream: false,
                chat_template_kwargs: { enable_thinking: false },
            }),
        });

        const payload = await upstream.json();
        if (!upstream.ok) {
            const msg = payload?.error?.message || payload?.detail || 'NVIDIA NIM returned an error.';
            throw new Error(msg);
        }

        const raw = payload.choices?.[0]?.message?.content?.trim();
        if (!raw) throw new Error('NVIDIA NIM returned an empty response.');

        const parsed = extractJson(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Could not parse NVIDIA NIM response as JSON. Please try again.');

        const result = normalizeResult(parsed);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ result }));
    } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message || 'Unable to summarize this meeting with NVIDIA NIM.' }));
    }
}
