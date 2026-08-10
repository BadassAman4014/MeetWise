/* eslint-disable react/prop-types */
import { useState } from 'react';
import { createGoogleCalendarUrl } from '../utils/calendar';

export default function CalendarEventModal({ initialEvent, onClose }) {
    const [title, setTitle] = useState(initialEvent?.title || 'Meeting Follow-up');
    const [description, setDescription] = useState(initialEvent?.description || '');
    const [date, setDate] = useState(initialEvent?.date || 'Tomorrow');
    const [time, setTime] = useState(initialEvent?.time || '10:00 AM');
    const [durationMinutes, setDurationMinutes] = useState(60);

    const handleSchedule = (e) => {
        e.preventDefault();
        const url = createGoogleCalendarUrl({
            title,
            details: description,
            date,
            time,
            durationMinutes: Number(durationMinutes),
        });
        window.open(url, '_blank', 'noopener,noreferrer');
        onClose();
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="calendar-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>📅 Schedule to Google Calendar</h3>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
                <form onSubmit={handleSchedule} className="calendar-form">
                    <label>
                        <span>Event Title</span>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                        />
                    </label>
                    <label>
                        <span>Date / Day</span>
                        <input
                            type="text"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            placeholder="e.g. Next Saturday, 2026-08-15"
                            required
                        />
                    </label>
                    <div className="form-row">
                        <label>
                            <span>Time</span>
                            <input
                                type="text"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                                placeholder="e.g. 10:00 AM"
                            />
                        </label>
                        <label>
                            <span>Duration</span>
                            <select value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)}>
                                <option value={15}>15 minutes</option>
                                <option value={30}>30 minutes</option>
                                <option value={45}>45 minutes</option>
                                <option value={60}>1 hour</option>
                                <option value={90}>1.5 hours</option>
                                <option value={120}>2 hours</option>
                            </select>
                        </label>
                    </div>
                    <label>
                        <span>Description / Details</span>
                        <textarea
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add meeting notes or context..."
                        />
                    </label>
                    <div className="modal-actions">
                        <button type="button" className="subtle-button" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="gcal-submit-btn">
                            ✦ Add to Google Calendar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
