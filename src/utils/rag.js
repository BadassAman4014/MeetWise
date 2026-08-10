/**
 * Local Retrieval-Augmented Generation (RAG) engine for MeetWise.
 * Searches, scores, and formats meeting transcripts & notes on-device.
 */

export function formatDate(timestamp) {
    if (!timestamp) return 'Unspecified Date';
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }).format(new Date(timestamp));
}

// Synonym dictionary for meeting & scheduling context
const SYNONYM_MAP = {
    follwup: ['followup', 'follow-up', 'follow', 'up', 'appointment', 'visit', 'scheduled', 'checkup'],
    followup: ['followup', 'follow-up', 'follow', 'up', 'appointment', 'visit', 'scheduled', 'checkup'],
    'follow-up': ['followup', 'follow-up', 'follow', 'up', 'appointment', 'visit', 'scheduled', 'checkup'],
    appointment: ['appointment', 'consultation', 'visit', 'checkup', 'scheduled', 'doctor', 'meeting'],
    appointments: ['appointment', 'consultation', 'visit', 'checkup', 'scheduled', 'doctor', 'meeting'],
    doctor: ['doctor', 'physician', 'medical', 'consultation', 'clinic', 'hospital', 'patient'],
    doctors: ['doctor', 'physician', 'medical', 'consultation', 'clinic', 'hospital', 'patient'],
    meeting: ['meeting', 'sync', 'call', 'discussion', 'consultation', 'session'],
    meetings: ['meeting', 'sync', 'call', 'discussion', 'consultation', 'session'],
};

function expandTokens(query) {
    const rawTokens = query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
    const expanded = new Set(rawTokens);

    rawTokens.forEach(token => {
        if (SYNONYM_MAP[token]) {
            SYNONYM_MAP[token].forEach(syn => expanded.add(syn));
        }
        // Normalize typos like "follwup"
        if (token.includes('follw') || token.includes('folow')) {
            expanded.add('follow');
            expanded.add('followup');
            expanded.add('follow-up');
            expanded.add('appointment');
        }
    });

    return Array.from(expanded);
}

function getMeetingText(meeting) {
    if (!meeting) return '';
    const parts = [];
    if (meeting.title) parts.push(`Title: ${meeting.title}`);
    if (meeting.createdAt) parts.push(`Date: ${formatDate(meeting.createdAt)}`);

    if (meeting.summary) {
        const s = typeof meeting.summary === 'string' ? { overview: meeting.summary } : meeting.summary;
        if (s.overview) parts.push(`Summary Overview: ${s.overview}`);
        if (Array.isArray(s.decisions) && s.decisions.length) parts.push(`Key Decisions: ${s.decisions.join('; ')}`);
        if (Array.isArray(s.actionItems) && s.actionItems.length) parts.push(`Action Items: ${s.actionItems.join('; ')}`);
        if (Array.isArray(s.openQuestions) && s.openQuestions.length) parts.push(`Open Questions: ${s.openQuestions.join('; ')}`);
        
        if (Array.isArray(s.scheduledEvents) && s.scheduledEvents.length) {
            const formattedEvts = s.scheduledEvents.map(e => `${e.title} (${e.date}${e.time ? ' @ ' + e.time : ''}): ${e.description || ''}`).join(' | ');
            parts.push(`Scheduled Events & Follow-ups: ${formattedEvts}`);
        }
    }

    if (meeting.refinedTranscript) {
        parts.push(`Refined Transcript: ${meeting.refinedTranscript}`);
    } else if (meeting.transcript) {
        const raw = typeof meeting.transcript === 'string'
            ? meeting.transcript
            : Array.isArray(meeting.transcript?.chunks)
                ? meeting.transcript.chunks.map(c => c.text).join(' ')
                : String(meeting.transcript.text || '');
        if (raw) parts.push(`Transcript: ${raw}`);
    }

    return parts.join('\n');
}

/**
 * Ranks meetings based on title match, date matching, and expanded keyword frequency.
 */
export function rankMeetings(query, meetings = []) {
    if (!query || !meetings.length) return meetings;

    const lowerQuery = query.toLowerCase().trim();
    const expandedTokens = expandTokens(query);

    return meetings
        .map(meeting => {
            let score = 0;
            const fullText = getMeetingText(meeting).toLowerCase();
            const titleLower = (meeting.title || '').toLowerCase();
            const dateStr = formatDate(meeting.createdAt).toLowerCase();

            // 1. Title or date string matches
            if (titleLower && lowerQuery.includes(titleLower)) score += 100;
            expandedTokens.forEach(token => {
                if (titleLower.includes(token)) score += 25;
                if (dateStr.includes(token)) score += 30;
            });

            // 2. Keyword frequency across notes & transcripts
            expandedTokens.forEach(token => {
                const count = (fullText.split(token).length - 1);
                score += count * 5;
            });

            return { meeting, score, fullText };
        })
        .sort((a, b) => b.score - a.score);
}

/**
 * Builds a structured, complete context payload containing ALL user meetings up to token budget.
 */
export function buildRagPayload(query, meetings = [], maxMeetings = 15) {
    if (!meetings.length) return [];

    // Sort meetings by relevance to query first
    const ranked = rankMeetings(query, meetings);
    const selected = ranked.slice(0, maxMeetings).map(r => r.meeting);

    return selected.map(meeting => {
        const fullText = getMeetingText(meeting);
        // Truncate individual transcript if exceptionally huge (>5000 chars) while preserving summary
        const excerpt = fullText.length > 5000 ? `${fullText.slice(0, 5000)}...\n[Transcript truncated]` : fullText;
        return {
            id: meeting.id,
            title: meeting.title || 'Untitled Meeting',
            date: formatDate(meeting.createdAt),
            excerpt,
        };
    });
}
