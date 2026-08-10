/**
 * Converts date and time inputs into Google Calendar formatted UTC strings (YYYYMMDDTHHmmssZ).
 * Correctly parses all days of the week (Sunday through Saturday), relative terms, and month/date formats.
 */
export function formatGoogleCalendarDates(dateStr, timeStr, durationMinutes = 60) {
    let start = new Date();
    
    if (dateStr) {
        const lower = dateStr.toLowerCase().trim();
        const now = new Date();
        const currentDayOfWeek = now.getDay(); // 0 is Sunday, 6 is Saturday

        const DAY_MAP = {
            sunday: 0, sun: 0,
            monday: 1, mon: 1,
            tuesday: 2, tue: 2, tues: 2,
            wednesday: 3, wed: 3,
            thursday: 4, thu: 4, thur: 4, thurs: 4,
            friday: 5, fri: 5,
            saturday: 6, sat: 6,
        };

        if (lower.includes('day after tomorrow')) {
            start.setDate(now.getDate() + 2);
        } else if (lower.includes('tomorrow')) {
            start.setDate(now.getDate() + 1);
        } else if (lower.includes('today') || lower.includes('tonight')) {
            start.setDate(now.getDate());
        } else {
            let matchedDay = false;
            for (const [dayName, targetDayIndex] of Object.entries(DAY_MAP)) {
                if (lower.includes(dayName)) {
                    let daysUntil = (targetDayIndex - currentDayOfWeek + 7) % 7;
                    if (daysUntil === 0 || lower.includes('next')) {
                        daysUntil = daysUntil === 0 ? 7 : daysUntil + 7;
                    }
                    start.setDate(now.getDate() + daysUntil);
                    matchedDay = true;
                    break;
                }
            }

            if (!matchedDay) {
                // Strip ordinal suffixes (12th -> 12, 1st -> 1, 2nd -> 2, 3rd -> 3)
                const cleanedDateStr = dateStr.replace(/(\d+)(st|nd|rd|th)/i, '$1');
                const parsed = new Date(cleanedDateStr);
                if (!isNaN(parsed.getTime())) {
                    start = parsed;
                }
            }
        }
    }

    if (timeStr) {
        const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2] || '0', 10);
            const ampm = timeMatch[3]?.toLowerCase();

            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;

            start.setHours(hours, minutes, 0, 0);
        } else {
            start.setHours(10, 0, 0, 0); // default to 10:00 AM
        }
    } else {
        start.setHours(10, 0, 0, 0);
    }

    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const toGCalIso = (d) => d.toISOString().replace(/-|:|\.\d\d\d/g, '');

    return `${toGCalIso(start)}/${toGCalIso(end)}`;
}

/**
 * Builds a direct Google Calendar template web URL for seamless 1-click scheduling.
 */
export function createGoogleCalendarUrl({ title = 'Meeting Follow-up', details = '', location = '', date = '', time = '', durationMinutes = 60 }) {
    const dates = formatGoogleCalendarDates(date, time, durationMinutes);
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: title,
        details: details,
        location: location,
        dates: dates,
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Smart filter: Checks if a string contains explicit time, date, deadline, or appointment context
 * where Google Calendar scheduling is relevant.
 */
export function isSchedulableText(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();

    const keywords = [
        'tomorrow', 'today', 'tonight', 'weekend', 'saturday', 'sunday',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
        'next week', 'next month', 'this week', 'scheduled', 'appointment',
        'reminder for', 'deadline', 'due on', 'due by', 'due date', 'follow-up on',
        'followup on', 'call at', 'meet at', 'meeting at', 'sync at', 'discussion at',
        'schedule a', 'book a', 'set up a call', 'set up a meeting',
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december',
        'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
    ];

    const hasKeyword = keywords.some((kw) => lower.includes(kw));
    const hasTimePattern = /\b(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm))\b/i.test(text);
    const hasDatePattern = /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(text) || /\b\d{4}-\d{2}-\d{2}\b/.test(text);

    return hasKeyword || hasTimePattern || hasDatePattern;
}

/**
 * Smart extractor: Pulls date/day and time expressions directly from action items or transcription data.
 * Falls back to extracting from fullTranscript if primary text lacks explicit date/day.
 */
export function extractDateAndTime(text, fullTranscript = '') {
    const parseSingleText = (str) => {
        if (!str || typeof str !== 'string') return { date: '', time: '' };

        let extractedDate = '';
        let extractedTime = '';

        // 1. Explicit Date / Month formats
        const monthDateMatch = str.match(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/i) ||
                               str.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s*(?:,?\s*\d{4})?\b/i) ||
                               str.match(/\b\d{4}-\d{2}-\d{2}\b/) ||
                               str.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);

        if (monthDateMatch) {
            extractedDate = monthDateMatch[0].trim();
        } else {
            // 2. Relative days or day of week
            const relativeMatch = str.match(/\b(?:day after tomorrow)\b/i) ||
                                  str.match(/\b(?:next|this|coming)\s+(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|weekend|week|month)\b/i) ||
                                  str.match(/\b(?:tomorrow|today|tonight)\b/i) ||
                                  str.match(/\b(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/i);
            if (relativeMatch) {
                extractedDate = relativeMatch[0].trim();
            }
        }

        // 3. Time extraction
        const timeMatch = str.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i) ||
                          str.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?\b/i);
        if (timeMatch) {
            extractedTime = timeMatch[0].trim();
        }

        return { date: extractedDate, time: extractedTime };
    };

    const primary = parseSingleText(text);
    let fallback = { date: '', time: '' };

    if ((!primary.date || !primary.time) && fullTranscript) {
        fallback = parseSingleText(fullTranscript);
    }

    return {
        date: primary.date || fallback.date || 'Tomorrow',
        time: primary.time || fallback.time || '10:00 AM',
    };
}
