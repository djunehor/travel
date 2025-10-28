import Redis from 'ioredis';
// --- Redis Setup ---
let redis = null;


export function getRedisClient() {

    if (!redis && process.env.REDIS_URL) {
        try {
            redis = new Redis(process.env.REDIS_URL, {
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    if (times > 3) return null;
                    return Math.min(times * 200, 1000);
                }
            });

            redis.on('error', (err) => {
                console.warn('⚠️ Redis connection error:', err.message);
                redis = null;
            });

            console.log(new Date().toLocaleString(), '✅ Redis client initialized');
        } catch (err) {
            console.warn('⚠️ Failed to initialize Redis:', err.message);
            redis = null;
        }
    }
    return redis;
}

function getDurationDays(duration) {
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