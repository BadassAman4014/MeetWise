/* eslint-disable no-undef */
import { promptFor, extractJson, normalizeResult, readJson } from './gemini.js';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
const FALLBACK_MODEL = 'google/gemma-4-31b-it';
const PRIMARY_TIMEOUT_MS = 90_000; // 1 min 30 sec

/** Fire a chat-completion request against the NVIDIA NIM endpoint. */
async function callNvidiaModel(model, prompt, signal) {
    const res = await fetch(NVIDIA_URL, {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 65536,
            temperature: 0.2,
            top_p: 0.95,
            stream: false,
            ...(model === NVIDIA_MODEL ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
    });

    const payload = await res.json();
    if (!res.ok) {
        const msg = payload?.error?.message || payload?.detail || 'NVIDIA NIM returned an error.';
        throw new Error(msg);
    }

    const raw = payload.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('NVIDIA NIM returned an empty response.');

    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('Could not parse NVIDIA NIM response as JSON. Please try again.');

    return normalizeResult(parsed);
}

export async function handleNvidiaSummarize(request, response) {
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    try {
        const { task = 'summary', transcript } = await readJson(request);
        if (!transcript?.trim()) throw new Error('A transcript is required.');
        if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not configured on the server. Add it to .env and restart the app.');

        const prompt = promptFor({ task, transcript: transcript.slice(0, 500000) });

        let result;
        let usedModel = NVIDIA_MODEL;

        try {
            // Attempt the primary model with a 90-second timeout
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), PRIMARY_TIMEOUT_MS);
            try {
                result = await callNvidiaModel(NVIDIA_MODEL, prompt, controller.signal);
            } finally {
                clearTimeout(timer);
            }
        } catch (primaryErr) {
            // If the primary model timed out, fall back to Gemma
            if (primaryErr.name === 'AbortError') {
                console.warn(`[NVIDIA] Primary model timed out after ${PRIMARY_TIMEOUT_MS / 1000}s — falling back to ${FALLBACK_MODEL}`);
                usedModel = FALLBACK_MODEL;
                result = await callNvidiaModel(FALLBACK_MODEL, prompt);
            } else {
                throw primaryErr; // non-timeout errors bubble up normally
            }
        }

        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ result, model: usedModel }));
    } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message || 'Unable to summarize this meeting with NVIDIA NIM.' }));
    }
}

export async function handleNvidiaChat(request, response) {
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    try {
        const { question, contextMeetings } = await readJson(request);
        if (!question?.trim()) throw new Error('A question is required.');
        if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not configured on the server.');

        const formattedContext = Array.isArray(contextMeetings) && contextMeetings.length > 0
            ? contextMeetings.map((m, idx) => `--- MEETING ${idx + 1} ---\nID: ${m.id}\nTitle: ${m.title}\nDate: ${m.date || 'Unspecified'}\nExcerpt / Transcript:\n${m.excerpt}`).join('\n\n')
            : 'No relevant meeting transcripts found.';

        const prompt = `You are MeetWise AI Co-Pilot, an intelligent assistant helping the user recall information from their recorded meetings.\n\nUser Question: "${question}"\n\nProvided Meeting Contexts:\n${formattedContext}\n\nInstructions:\n1. Thoroughly review ALL provided meeting titles, dates, summary overviews, key decisions, action items, scheduled events, and transcripts.\n2. Answer the user's question accurately, concisely, and completely. Treat terms like "follow-up", "appointment", "consultation", "visit", and "meeting" as equivalent when searching for scheduled plans or visits.\n3. Match the language of the user's question or transcript (e.g. Hindi/Hinglish if asked in Hindi or if transcript is in Hindi).\n4. Populate the 'sources' array with the ID and Title of any meetings you referenced.\n\nRespond ONLY with a JSON object: { "answer": "...", "sources": [{ "meetingId": "...", "title": "..." }] }`;

        const res = await fetch(NVIDIA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                model: NVIDIA_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 4096,
                temperature: 0.2,
                chat_template_kwargs: { enable_thinking: false }
            }),
        });

        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error?.message || 'NVIDIA NIM returned an error.');

        const raw = payload.choices?.[0]?.message?.content?.trim();
        if (!raw) throw new Error('NVIDIA NIM returned an empty response.');

        const parsed = extractJson(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Could not parse NVIDIA NIM chat response.');

        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
            answer: parsed.answer || raw,
            sources: Array.isArray(parsed.sources) ? parsed.sources : []
        }));
    } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message || 'Unable to answer chat query with NVIDIA NIM.' }));
    }
}
