export function getDurationDays(duration) {
    if (!duration || typeof duration !== 'string') return 7; // default 7 days

    duration = duration.toLowerCase();

    // Match "3-5-days" or "5-7-days"
    let dayMatch = duration.match(/(\d+)-(\d+)-days/);
    if (dayMatch) {
        const min = parseInt(dayMatch[1], 10);
        const max = parseInt(dayMatch[2], 10);
        return Math.round((min + max) / 2); // average
    }

    // Match "1-2-weeks" or "2-plus-weeks"
    let weekMatch = duration.match(/(\d+)(?:-(\d+)|\+)?-weeks/);
    if (weekMatch) {
        const minWeeks = parseInt(weekMatch[1], 10);
        const maxWeeks = weekMatch[2] ? parseInt(weekMatch[2], 10) : minWeeks + 1; // "plus" -> add 1 week
        return Math.round(((minWeeks + maxWeeks) / 2) * 7); // convert weeks → days
    }

    // If it's a single number with "d" suffix
    let singleDayMatch = duration.match(/(\d+)d/);
    if (singleDayMatch) return parseInt(singleDayMatch[1], 10);

    // fallback
    return 7;
}

// --- Helper Functions ---
export function getDateRange(timeframe) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight

    // helper: clone + add days
    const addDays = (date, days) => {
        const d = new Date(date.getTime());
        d.setDate(d.getDate() + days);
        return d;
    };

    let target;

    if (typeof timeframe === 'number') {
        target = addDays(today, timeframe);
    } else {
        switch (timeframe) {
            case '1-month':        // within 1 month -> choose ~30 days from today
                target = addDays(today, 15);
                break;
            case '1-3-months':     // start of range -> ~30 days
                target = addDays(today, 45);
                break;
            case '3-6-months':     // start of range -> ~90 days
                target = addDays(today, 90);
                break;
            case '6-plus-months':  // start -> ~180 days
                target = addDays(today, 100);
                break;
            case 'next_week':
                target = addDays(today, 7);
                break;
            case 'tomorrow':
                target = addDays(today, 1);
                break;
            default:
                // fallback: tomorrow
                target = addDays(today, 1);
        }
    }

    // safety: if computed date is not in the future (edge cases), use tomorrow
    if (target <= today) {
        console.warn('⚠️ Calculated date is not in the future; using tomorrow instead');
        target = addDays(today, 1);
    }

    return target;
}

export function formatDate(date) {
    return date.toISOString().split('T')[0];
}

export function calculateBookingDeadline(timeframe) {
    const map = {
        '1-month': '1 week before departure',
        '1-3-months': '2-3 weeks before departure',
        '3-6-months': '4-6 weeks before departure',
        '6-plus-months': '2-3 months before departure'
    };
    return map[timeframe] || '2 weeks before departure';
}