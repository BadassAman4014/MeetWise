/* eslint-disable no-undef */
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

const responseSchema = {
    type: 'object',
    properties: {
        title: { type: 'string', description: 'A short, specific meeting title of 3 to 8 words. Never use file names.' },
        overview: { type: 'string', description: 'A concise plain-language meeting summary.' },
        decisions: { type: 'array', items: { type: 'string' } },
        actionItems: { type: 'array', items: { type: 'string' } },
        openQuestions: { type: 'array', items: { type: 'string' } },
        scheduledEvents: {
            type: 'array',
            description: 'Events, weekend plans, or follow-ups explicitly scheduled or discussed with a timeframe.',
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Event title or summary of what is scheduled.' },
                    description: { type: 'string', description: 'Brief context or details about the event.' },
                    date: { type: 'string', description: 'Mentioned date or relative day (e.g. "Next Saturday", "This weekend", "Tomorrow").' },
                    time: { type: 'string', description: 'Mentioned time (e.g. "10:00 AM", "2:30 PM") or empty string if unspecified.' }
                },
                required: ['title', 'description', 'date']
            }
        },
        refinedTranscript: { type: 'string', description: 'A clean, readable plain-text transcript. Do not use Markdown, headings, title labels, separators, or commentary.' },
    },
    required: ['title', 'overview', 'decisions', 'actionItems', 'openQuestions', 'scheduledEvents', 'refinedTranscript'],
};

export function promptFor({ task, transcript }) {
    const taskInstruction = task === 'refine'
        ? 'Prioritize the refinedTranscript field, retaining every meaningful detail. Still provide concise structured meeting fields and scheduled events when possible.'
        : 'Prioritize an accurate overview, decisions, action items, open questions, and any scheduled events/weekend plans/follow-up commitments mentioned with timeframes.';
    return `Analyze this meeting transcript. ${taskInstruction} Do not invent facts, people, dates, owners, or decisions.\n\nRespond ONLY with a JSON object containing these fields: title (string), overview (string), decisions (array of strings), actionItems (array of strings), openQuestions (array of strings), scheduledEvents (array of objects with title, description, date, time), refinedTranscript (string).\n\nTranscript:\n${transcript}`;
}

/** Try multiple strategies to extract a JSON object from a string. */
export function extractJson(raw) {
    if (!raw) return null;

    // Strategy 1: direct parse
    try { return JSON.parse(raw); } catch { /* continue */ }

    // Strategy 2: strip markdown code fences (```json ... ``` or ``` ... ```)
    const fenceStripped = raw.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/, '').trim();
    if (fenceStripped) {
        try { return JSON.parse(fenceStripped); } catch { /* continue */ }
    }

    // Strategy 3: find the first { ... } block via bracket matching
    const start = raw.indexOf('{');
    if (start !== -1) {
        let depth = 0;
        for (let i = start; i < raw.length; i++) {
            if (raw[i] === '{') depth++;
            else if (raw[i] === '}') depth--;
            if (depth === 0) {
                try { return JSON.parse(raw.slice(start, i + 1)); } catch { break; }
            }
        }
    }

    return null;
}

/** Ensure all expected fields exist with sensible defaults. */
export function normalizeResult(obj) {
    return {
        title: obj.title || 'Untitled meeting',
        overview: obj.overview || obj.summary || '',
        decisions: Array.isArray(obj.decisions) ? obj.decisions : [],
        actionItems: Array.isArray(obj.actionItems) ? obj.actionItems : (Array.isArray(obj.action_items) ? obj.action_items : []),
        openQuestions: Array.isArray(obj.openQuestions) ? obj.openQuestions : (Array.isArray(obj.open_questions) ? obj.open_questions : []),
        scheduledEvents: Array.isArray(obj.scheduledEvents) ? obj.scheduledEvents : (Array.isArray(obj.scheduled_events) ? obj.scheduled_events : []),
        refinedTranscript: obj.refinedTranscript || obj.refined_transcript || '',
    };
}

export async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export async function handleSummarize(request, response) {
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    try {
        const { task = 'summary', transcript } = await readJson(request);
        if (!transcript?.trim()) throw new Error('A transcript is required.');
        if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured on the server. Add it to .env and restart the app.');

        const upstream = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: promptFor({ task, transcript: transcript.slice(0, 500000) }) }] }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    responseSchema,
                },
            }),
        });
        const payload = await upstream.json();
        if (!upstream.ok) throw new Error(payload?.error?.message || 'Gemini returned an error.');

        const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
        if (!raw) throw new Error('Gemini returned an empty response.');

        const parsed = extractJson(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Could not parse Gemini response as JSON. Please try again.');

        const result = normalizeResult(parsed);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ result }));
    } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message || 'Unable to summarize this meeting.' }));
    }
}
