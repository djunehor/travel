const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { scrapeAccommodation, scrapeActivities, scrapeFlights } = require('./scrapers');
const airportCodes = require('./country_airports.json');
const countries = require('./countries.json');
require('dotenv').config();
const Redis = require('ioredis');
const budgetRanges = {
    'under-500': { min: 0, max: 500 },
    '500-1000': { min: 500, max: 1000 },
    '1000-2000': { min: 1000, max: 2000 },
    '2000-5000': { min: 2000, max: 5000 },
    'over-5000': { min: 5000, max: 50000 }
};

// --- Redis Setup ---
let redis = null;

function getRedisClient() {
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

            console.log('✅ Redis client initialized');
        } catch (err) {
            console.warn('⚠️ Failed to initialize Redis:', err.message);
            redis = null;
        }
    }
    return redis;
}


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Database
let db;
const dbPath = path.join(__dirname, 'vacation_planner.db');

async function initDatabase() {
    const SQL = await initSqlJs();

    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            request_data TEXT NOT NULL,
            result_data TEXT,
            error_message TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS task_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        )
    `);

    saveDatabase();
}

function saveDatabase() {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function generateTaskId() {
    return `TASK${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

function logTaskProgress(taskId, message) {
    const timestamp = Date.now();
    db.run(
        `INSERT INTO task_logs (task_id, message, timestamp) VALUES (?, ?, ?)`,
        [taskId, message, timestamp]
    );
    saveDatabase();
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

function calculateBookingDeadline(timeframe) {
    const map = {
        '1-month': '1 week before departure',
        '1-3-months': '2-3 weeks before departure',
        '3-6-months': '4-6 weeks before departure',
        '6-plus-months': '2-3 months before departure'
    };
    return map[timeframe] || '2 weeks before departure';
}

// API: Create task
app.post('/api/plan-vacation', async (req, res) => {
    try {
        const taskId = generateTaskId();
        const now = Date.now();

        db.run(
            `INSERT INTO tasks (id, status, request_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
            [taskId, 'pending', JSON.stringify(req.body), now, now]
        );
        saveDatabase();

        console.time(taskId)
        processTask(taskId, req.body).then(() => console.timeEnd(taskId)).catch(err => {
            console.error(`Error processing task ${taskId}:`, err);
            updateTaskStatus(taskId, 'failed', null, err.message);
        });

        res.json({ taskId, status: 'pending' });
    } catch (err) {
        console.error('Error creating task:', err);
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// API: Get task
app.get('/api/task/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const { timestamp } = req.query;

        const result = db.exec(`SELECT status, result_data, error_message FROM tasks WHERE id = ?`, [taskId]);

        if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Task not found' });

        const [status, resultData, errorMessage] = result[0].values[0];
        const response = { taskId, status };

        if (status === 'completed' && resultData) response.data = JSON.parse(resultData);
        if (status === 'failed' && errorMessage) response.error = errorMessage;

        // Fetch logs
        let logsQuery = `SELECT message, timestamp FROM task_logs WHERE task_id = ?`;
        let logsParams = [taskId];

        if (timestamp) {
            logsQuery += ` AND timestamp > ?`;
            logsParams.push(parseInt(timestamp, 10));
        }

        logsQuery += ` ORDER BY timestamp ASC`;

        const logsResult = db.exec(logsQuery, logsParams);
        const logs = logsResult.length && logsResult[0].values.length
            ? logsResult[0].values.map(([message, ts]) => ({ message, timestamp: ts }))
            : [];

        response.logs = logs;

        res.json(response);
    } catch (err) {
        console.error('Error fetching task:', err);
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

app.get('/api/airports', (_, res) => {
    res.json(airportCodes);
});

function updateTaskStatus(taskId, status, resultData = null, errorMessage = null) {
    const now = Date.now();
    db.run(
        `UPDATE tasks SET status = ?, result_data = ?, error_message = ?, updated_at = ? WHERE id = ?`,
        [status, resultData ? JSON.stringify(resultData) : null, errorMessage, now, taskId]
    );
    saveDatabase();
}

// Background processing
async function processTask(taskId, requestData, results = [], attempts = 0) {
    const maxAttempts = 3;

    try {
        logTaskProgress(taskId, `Processing task (attempt ${attempts + 1} of ${maxAttempts})`);

        // Step 1: Get destination suggestions from LLM
        logTaskProgress(taskId, 'Getting destination suggestions from LLM');
        let destinations = await getDestinationSuggestions(requestData, attempts > 0);
        destinations = destinations.filter(d => {
            // Exclude already processed destinations
            return results.map(r => r.name).indexOf(d.name) === -1;
        });

        if (!destinations?.length) throw new Error('No suitable destinations found');

        logTaskProgress(taskId, `Found ${destinations.length} potential destinations`);


        // Step 2: Scrape data for each destination and departure airport
        for (const destination of destinations) {
            if (results.filter((s) => s.estimatedCost.total <= destination.estimatedBudget).length >= 3) {
                logTaskProgress(taskId, 'Reached maximum of 3 valid destinations');
                break;
            }

            const departure = airportCodes.find((s) => s.iata === requestData.departureCountry);

            if(!departure.iata) {
                logTaskProgress(taskId, `Invalid departure airport code: ${requestData.departureCountry}`);
                continue;
            }

            try {
                logTaskProgress(taskId, `Sourcing flight data for ${destination.name}`);

                const adults = requestData.travelers.filter(t => t.type === 'adult').length;
                const children = requestData.travelers.length - adults;

                // Scrape flights
                const flightData = await scrapeFlights({
                    departureAirport: departure.iata,
                    destinationAirport: destination.airportCode,
                    timeframe: requestData.timeframe,
                    duration: requestData.duration,
                    adults,
                    children
                });
                if (!flightData?.price || Number(flightData.price) > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Flight price exceeds budget`);
                    continue;
                };
                logTaskProgress(taskId, `Flight found for ${destination.name} at $${flightData.price}`);

                // Scrape accommodation
                logTaskProgress(taskId, `Sourcing accommodation data for ${destination.name}`);
                const accommodationData = await scrapeAccommodation(
                    destination.name,
                    flightData.departureDate,
                    flightData.returnDate,
                    budgetRanges[requestData.budget].max - Number(flightData.price),
                    adults,
                    children
                );
                if (!accommodationData?.price || Number(accommodationData.price.replace(/\D/g, '')) > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Accommodation price exceeds budget`);
                    continue;
                }
                logTaskProgress(taskId, `Accommodation found for ${destination.name} at $${accommodationData.pricePerNight} per night`);

                if (Number(flightData.price) + Number(accommodationData.price.replace(/\D/g, '')) > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Flight + Accommodation exceeds budget`);
                    continue;
                }

                // Scrape activities
                logTaskProgress(taskId, `Sourcing activities data for ${destination.name}`);
                const activitiesData = await scrapeActivities(
                    destination.name,
                    flightData.departureDate,
                    flightData.returnDate,
                    budgetRanges[requestData.budget].max - Number(flightData.price) - (Number(accommodationData.price.replace(/\D/g, '')))
                );
                if (!activitiesData?.totalPrice || activitiesData.totalPrice > budgetRanges[requestData.budget].max) {
                    activitiesData = { activities: [], totalPrice: 0 };
                };
                logTaskProgress(taskId, `Activities found for ${destination.name} totaling $${activitiesData.totalPrice}`);

                // Combine results
                const totalCost = Number(flightData.price) +
                    Number(accommodationData.price.replace(/\D/g, '')) +
                    Number(activitiesData.totalPrice);

                if (totalCost > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Total cost exceeds budget`);
                    continue;
                }

                results.push({
                    name: destination.name,
                    visaStatus: destination.visaStatus,
                    visaProcessingTime: destination.visaProcessingTime,
                    visaRequirements: destination.visaRequirements,
                    estimatedCost: {
                        flights: flightData.price,
                        accommodation: Number(accommodationData.price.replace(/\D/g, '')),
                        activities: activitiesData.totalPrice,
                        total: totalCost
                    },
                    flightDetails: flightData,
                    accommodationSuggestion: `<a href="${accommodationData.url}" target="_blank">${accommodationData.name}</a><br>${accommodationData.address}<br>Rating: ${accommodationData.rating} (${accommodationData.reviews} reviews)<br>Price: ${accommodationData.price} (${accommodationData.pricePerNight} per night)<br>Perks: ${accommodationData.perks.join(', ')}<br><a href="${accommodationData.url}" target="_blank">View on Booking.com</a>`,
                    topActivities: activitiesData.activities,
                    timeline: {
                        visaApplication: destination.visaTimeline,
                        bookingDeadline: calculateBookingDeadline(requestData.timeframe),
                        departureDate: flightData.departureDate
                    }
                });

                logTaskProgress(taskId, `Successfully scraped ${destination.name} (total cost: $${totalCost})`);

            } catch (err) {
                logTaskProgress(taskId, `Error Sourcing flight data for ${destination.name}: ${err.message}`);
                continue;
            }

        }

        attempts++;

        if (results.length < 1) {
            if (attempts < maxAttempts) {
                logTaskProgress(taskId, `No complete data retrieved, retrying...`);
                return processTask(taskId, requestData, results, attempts);
            }
            if (results.length === 0) {
                throw new Error('Could not retrieve complete data for any destination');
            }
        }

        // Sort by total cost
        results.sort((a, b) => a.estimatedCost.total - b.estimatedCost.total);
        updateTaskStatus(taskId, 'completed', { destinations: results });
        logTaskProgress(taskId, `Task completed with ${results.length} destinations`);
    } catch (err) {
        logTaskProgress(taskId, `Task failed: ${err.message}`);
        updateTaskStatus(taskId, 'failed', null, err.message);
    }
}

// OpenAI helper
async function getDestinationSuggestions(requestData, noCache = false) {
    const redisClient = getRedisClient();
    const cacheKey = `destinations:${JSON.stringify(requestData)}`;

    if (redisClient && !noCache) {
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                console.log('✅ Returning cached destination data');
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('⚠️ Redis get error:', err.message);
        }
    }

    const prompt = buildDestinationPrompt(requestData);

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a travel expert providing destination suggestions for international travelers.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Cache the result for 24 hours
    if (redisClient && result?.destinations) {
        try {
            await redisClient.setex(cacheKey, 3600, JSON.stringify(result.destinations));
            // console.log('✅ Cached destination data for 1 hour');
        } catch (err) {
            console.warn('⚠️ Redis set error:', err.message);
        }
    }
    return result.destinations;
}

// Build prompt
function buildDestinationPrompt(requestData) {
    const { travelers, budget, timeframe, duration, visaPreference, travelStyles } = requestData;

    const budgetRange = budgetRanges[budget];

    const travelersInfo = travelers.map((t, i) =>
        `Traveler ${i + 1}: ${t.name}, nationality: ${countries.find((s) => s.code === t.nationality).name}, residence: ${countries.find((s) => s.code === t.residence).name}, existing visas/residence permit: ${t.visas.join(', ') || 'none'}`
    ).join('\n');

    const prompt = `Suggest 15 suitable vacation destinations for the following travelers:
    TRAVELERS:
    ${travelersInfo}
    
    REQUIREMENTS:
    - Budget: $${budgetRange.min} - $${budgetRange.max} (total for all travelers)
    - Travel timeframe: ${timeframe}
    - Trip duration: ${duration}
    - Visa preference: ${visaPreference}
    - Travel interests: ${travelStyles.join(', ')}
    - Departing from: ${countries.find((a) => a.code === airportCodes.find((s) => s.iata === requestData.departureCountry).country_code).name} (${requestData.departureCountry})
    
    IMPORTANT VISA REQUIREMENTS RULES:
    1. Consider each traveler's nationality and residence when determining visa requirements. For example, a resident/citizen of Germany doesn't need visa to visit any schengen country
    2. If any traveler who's not a citizen of these countries holds a valid US, UK, or Schengen visa, consider destinations that offer visa-on-arrival or e-visa for such visa holders
    3. Exclude any country with US travel advisory status level 3 or 4 for any traveler's nationality
    4. Based on visa preference:
        - "visa-free": Only suggest destinations where ALL travelers can enter without additional visa outside their passport/residence country
        - "visa-on-arrival": Include destinations with visa-on-arrival for ALL travelers based on their passport/residence country or existing valid visas
        - "short-processing": Include destinations with visa processing up to 4 weeks
        - "any-processing": Include any destination regardless of visa processing time For each destination, provide:
            1. name: Full destination name (city and country)
            2. countryCode: ISO 2-letter country code
            3. airportCode: IATA code of the main international airport
            4. visaStatus: "visa-free" | "visa-on-arrival" | "e-visa" | "standard-visa"
            5. visaProcessingTime: Estimated time (e.g., "No visa required", "15 minutes at airport", "3-5 business days", "2-3 weeks")
            6. visaRequirements: Array of requirements (e.g., ["Valid passport", "Return ticket", "Proof of accommodation"])
            7. visaTimeline: Brief explanation of entry requirement based on travelers' profiles, and visa processing if required. e.g holders of EU residence permit don't need visa to enter Spain OR 6-months bank statement showing balance of $100xnumber_of_days is required to apply for France Visa.
            8. estimatedBudget: Rough estimate of total cost for this destination
            9. reason: Why this destination is suitable based on the travelers' profiles and preferences
            Return ONLY valid JSON in this exact format:
            { "destinations": [ { "name": "Dubai, UAE", "countryCode": "AE", "airportCode": "DXB", "visaStatus": "visa-on-arrival", "visaProcessingTime": "15 minutes at airport", "visaRequirements": ["Valid passport with 6 months validity", "Return ticket", "Hotel booking"], "visaTimeline": "Get visa on arrival at Dubai airport. Present required documents at immigration.", "estimatedBudget": 1800, "reason": "Offers visa-on-arrival for Nigerian passport holders with valid US/UK/Schengen visa. Popular destination with excellent infrastructure." } ] } ;
             `;

    return prompt;
}

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

initDatabase().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});