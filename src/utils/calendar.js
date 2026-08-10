/**
 * Converts date and time inputs into Google Calendar formatted UTC strings (YYYYMMDDTHHmmssZ).
 */
export function formatGoogleCalendarDates(dateStr, timeStr, durationMinutes = 60) {
    let start = new Date();
    
    if (dateStr) {
        const lower = dateStr.toLowerCase().trim();
        const now = new Date();
        const currentDayOfWeek = now.getDay(); // 0 is Sunday, 6 is Saturday

        if (lower.includes('tomorrow')) {
            start.setDate(now.getDate() + 1);
        } else if (lower.includes('next saturday') || lower.includes('this saturday') || lower.includes('saturday')) {
            const daysUntilSaturday = (6 - currentDayOfWeek + 7) % 7 || 7;
            start.setDate(now.getDate() + daysUntilSaturday);
        } else if (lower.includes('next sunday') || lower.includes('this sunday') || lower.includes('sunday') || lower.includes('weekend')) {
            const daysUntilSunday = (0 - currentDayOfWeek + 7) % 7 || 7;
            start.setDate(now.getDate() + daysUntilSunday);
        } else if (lower.includes('next monday') || lower.includes('monday')) {
            const daysUntilMonday = (1 - currentDayOfWeek + 7) % 7 || 7;
            start.setDate(now.getDate() + daysUntilMonday);
        } else {
            // Strip ordinal suffixes (12th -> 12, 1st -> 1, 2nd -> 2, 3rd -> 3)
            const cleanedDateStr = dateStr.replace(/(\d+)(st|nd|rd|th)/i, '$1');
            const parsed = new Date(cleanedDateStr);
            if (!isNaN(parsed.getTime())) {
                start = parsed;
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
 * where Google Calendar scheduling is actually relevant and appropriate.
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
 * Smart extractor: Pulls date/day and time expressions directly from action item or meeting text.
 */
export function extractDateAndTime(text) {
    if (!text || typeof text !== 'string') return { date: 'Tomorrow', time: '10:00 AM' };

    let extractedDate = '';
    let extractedTime = '';

    // 1. Month Day Year (e.g. "August 12th, 2026", "August 12, 2026", "12th of August 2026", "Aug 12th")
    const monthDateMatch = text.match(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/i) ||
                           text.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s*(?:,?\s*\d{4})?\b/i) ||
                           text.match(/\b\d{4}-\d{2}-\d{2}\b/) ||
                           text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);

    if (monthDateMatch) {
        extractedDate = monthDateMatch[0].trim();
    } else {
        // 2. Relative days or day of week (e.g. "next Saturday", "this weekend", "tomorrow", "this Friday")
        const relativeMatch = text.match(/\b(?:next|this)\s+(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|weekend|week|month)\b/i) ||
                              text.match(/\b(?:tomorrow|today|tonight)\b/i) ||
                              text.match(/\b(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/i);
        if (relativeMatch) {
            extractedDate = relativeMatch[0].trim();
        }
    }

    // 3. Extract time (e.g. "10:00 AM", "5 PM", "2:30pm")
    const timeMatch = text.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i);
    if (timeMatch) {
        extractedTime = timeMatch[0].trim();
    }

    return {
        date: extractedDate || 'Tomorrow',
        time: extractedTime || '10:00 AM',
    };
}
