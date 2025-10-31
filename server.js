const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const airportCodes = require('./country_airports.json');
const countries = require('./countries.json');
const { getRedisClient } = require('./helpers');
require('dotenv').config({ quiet: true });

const { scrapeAccommodation, scrapeActivities, scrapeFlights } = require('./scrapers');
const budgetRanges = {
    'under-500': { min: 0, max: 500 },
    '500-1000': { min: 500, max: 1000 },
    '1000-2000': { min: 1000, max: 2000 },
    '2000-5000': { min: 2000, max: 5000 },
    'over-5000': { min: 5000, max: 50000 }
};

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

const redisClient = getRedisClient();

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

function calculateBookingDeadline(timeframe) {
    const map = {
        '1-month': '1 week before departure',
        '1-3-months': '2-3 weeks before departure',
        '3-6-months': '4-6 weeks before departure',
        '6-plus-months': '2-3 months before departure'
    };
    return map[timeframe] || '2 weeks before departure';
}

function updateTaskStatus(taskId, status, resultData = null, errorMessage = null) {
    const now = Date.now();
    db.run(
        `UPDATE tasks SET status = ?, result_data = ?, error_message = ?, updated_at = ? WHERE id = ?`,
        [status, resultData ? JSON.stringify(resultData) : null, errorMessage, now, taskId]
    );
    saveDatabase();
}

async function cancelTask(taskId) {
    const now = Date.now();
    db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?`, ['cancelled', now, taskId, 'pending']);
    saveDatabase();

    const redisClient = getRedisClient();
    if (redisClient) {
        await redisClient.set(`cancel:${taskId}`, '1', 'EX', 3600); // expire in 1 hour
    }
}

// Helper to check if task is cancelled
async function checkCancelled(taskId) {
    // Redis check
    if (redisClient) {
        const cancelled = await redisClient.get(`cancel:${taskId}`);
        if (cancelled) {
            logTaskProgress(taskId, 'Task aborted by user - soft');
            updateTaskStatus(taskId, 'cancelled');
            return true;
        }
    }
    // DB check fallback
    const statusCheck = db.exec(`SELECT status FROM tasks WHERE id = ?`, [taskId]);
    if (statusCheck.length && statusCheck[0].values.length && statusCheck[0].values[0][0] === 'cancelled') {
        logTaskProgress(taskId, 'Task aborted by user - hard');
        return true;
    }
    return false;
}

// Background processing
async function processTask(taskId, requestData) {
    const results = [];
    try {
        logTaskProgress(taskId, `Processing task ${taskId}`);

        // Step 1: Check for cancellation
        if (await checkCancelled(taskId)) return;

        // Step 2: Get destination suggestions from LLM
        logTaskProgress(taskId, 'Getting destination suggestions from LLM');
        let destinations = await getDestinationSuggestions(requestData);

        // Cancellation check after LLM call
        if (await checkCancelled(taskId)) return;

        destinations.sort((a, b) => a.estimatedBudget - b.estimatedBudget);

        if (!destinations?.length) throw new Error('No suitable destinations found');

        logTaskProgress(taskId, `Found ${destinations.length} potential destinations`);

        // Step 3: Scrape data for each destination and departure airport
        for (const i in destinations) {
            const destination = destinations[i];
            if (await checkCancelled(taskId)) return;

            if (results.filter((s) => s.estimatedCost.total <= destination.estimatedBudget).length >= 3) {
                logTaskProgress(taskId, 'Reached maximum of 3 valid destinations');
                break;
            }

            const departure = airportCodes.find((s) => s.iata === requestData.departureCountry);
            if (!departure?.iata) {
                logTaskProgress(taskId, `Invalid departure airport code: ${requestData.departureCountry}`);
                continue;
            }
            console.log(new Date().toLocaleString(), `✈️ [${Number(i) + 1}/${destinations.length}] Processing destination: ${destination.name} (${destination.airportCode})`);

            try {
                if (await checkCancelled(taskId)) return;

                logTaskProgress(taskId, `[${Number(i) + 1}/${destinations.length}] Sourcing flight data for ${destination.name}`);
                const adults = requestData.travelers.filter(t => t.type === 'adult').length;
                const children = requestData.travelers.length - adults;

                const flightData = await scrapeFlights({
                    departureAirport: departure.iata,
                    destinationAirport: destination.airportCode,
                    timeframe: requestData.timeframe,
                    duration: requestData.duration,
                    adults,
                    children
                });

                if (await checkCancelled(taskId)) return;

                if (!flightData?.price || Number(flightData.price) > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Flight price exceeds budget`);
                    continue;
                }
                logTaskProgress(taskId, `Flight found for ${destination.name} at $${flightData.price}`);

                // Accommodation
                if (await checkCancelled(taskId)) return;
                logTaskProgress(taskId, `Sourcing accommodation data for ${destination.name}`);
                const accommodationData = await scrapeAccommodation(
                    destination.name,
                    flightData.departureDate,
                    flightData.returnDate,
                    budgetRanges[requestData.budget].max - Number(flightData.price),
                    adults,
                    children
                );

                if (await checkCancelled(taskId)) return;

                if (!accommodationData?.price || Number(accommodationData.price.replace(/\D/g, '')) > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Accommodation price exceeds budget`);
                    continue;
                }
                logTaskProgress(taskId, `Accommodation found for ${destination.name} at $${accommodationData.pricePerNight} per night`);

                if (Number(flightData.price) + Number(accommodationData.price.replace(/\D/g, '')) > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Flight + Accommodation exceeds budget`);
                    continue;
                }

                // Activities
                if (await checkCancelled(taskId)) return;
                logTaskProgress(taskId, `Sourcing activities data for ${destination.name}`);
                let activitiesData = await scrapeActivities(
                    destination.name,
                    flightData.departureDate,
                    flightData.returnDate,
                    budgetRanges[requestData.budget].max - Number(flightData.price) - Number(accommodationData.price.replace(/\D/g, ''))
                );

                if (await checkCancelled(taskId)) return;

                if (!activitiesData?.totalPrice || activitiesData.totalPrice > budgetRanges[requestData.budget].max) {
                    activitiesData = { activities: [], totalPrice: 0 };
                }
                logTaskProgress(taskId, `Activities found for ${destination.name} totaling $${activitiesData.totalPrice}`);

                // Combine results
                const totalCost = Number(flightData.price) +
                    Number(accommodationData.price.replace(/\D/g, '')) +
                    Number(activitiesData.totalPrice);

                if (totalCost > budgetRanges[requestData.budget].max) {
                    logTaskProgress(taskId, `Skipped ${destination.name}: Total cost exceeds budget`);
                    continue;
                }

                if (results.length < 1) {
                    console.log(new Date().toLocaleString(), '🏖️ Adding destination:', destination.name, `Total Cost: $${totalCost}`);
                    logTaskProgress(taskId, `🔥🔥🔥 Yay, found 1 valid destination within budget!`);
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
                    accommodationSuggestion: `<a href="${accommodationData.url}" target="_blank">${accommodationData.name}</a><br>${accommodationData.address}<br>Rating: ${accommodationData.rating} (${accommodationData.reviews} reviews)<br>Price: ${accommodationData.price} (${accommodationData.pricePerNight} per night)<br>Perks: ${accommodationData.perks || ''}<br><a href="${accommodationData.url}" target="_blank">View on Booking.com</a>`,
                    topActivities: activitiesData.activities,
                    timeline: {
                        visaApplication: destination.visaTimeline,
                        bookingDeadline: calculateBookingDeadline(requestData.timeframe),
                        departureDate: flightData.departureDate
                    }
                });
                try {
                    await redisClient.setex(`TASK:${taskId}`, 3600, JSON.stringify(results));
                } catch { }

                logTaskProgress(taskId, `Successfully scraped ${destination.name} (total cost: $${totalCost})`);

            } catch (err) {
                logTaskProgress(taskId, `Error sourcing data for ${destination.name}: ${err.message}`);
                continue;
            }
        }

        if (results.length < 1) {
            throw new Error('Could not retrieve complete data for any destination');
        }

        // Sort by total cost
        results.sort((a, b) => a.estimatedCost.total - b.estimatedCost.total);
        updateTaskStatus(taskId, 'completed', { destinations: results });
        logTaskProgress(taskId, `Task completed with ${results.length} destinations`);

    } catch (err) {
        console.error(`Task ${taskId} caught error:`, err);
        if ((await checkCancelled(taskId))) return;
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
                console.log(new Date().toLocaleString(), '✅ Returning cached destination data');
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
            await redisClient.setex(cacheKey, 86400 * 30, JSON.stringify(result.destinations));
            // console.log(new Date().toLocaleString(),'✅ Cached destination data for 1 hour');
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

        setTimeout(() => cancelTask(taskId), 15 * 60 * 1000);
        processTask(taskId, req.body)
            .then(() => console.timeEnd(taskId))
            .catch(err => {
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

        if (!response.data) {
            try {
                const cached = await redisClient.get(`TASK:${taskId}`);
                if (cached) {
                    console.log(new Date().toLocaleString(), '✅ Returning task cached data');
                    response.data = JSON.parse(cached);
                }
            } catch (err) {
                console.warn('⚠️ Redis get error:', err.message);
            }
        }
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

// API: Cancel task
app.post('/api/task/:taskId/cancel', async (req, res) => {
    try {
        const { taskId } = req.params;

        const taskResult = db.exec(`SELECT status FROM tasks WHERE id = ?`, [taskId]);
        if (!taskResult.length || !taskResult[0].values.length) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const [status] = taskResult[0].values[0];
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            return res.status(400).json({ error: `Cannot cancel a task with status ${status}` });
        }

        // Update status to cancelled
        const now = Date.now();
        db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, ['cancelled', now, taskId]);
        saveDatabase();

        // Optional: set a Redis flag so the running process can stop early
        const redisClient = getRedisClient();
        if (redisClient) {
            await redisClient.set(`cancel:${taskId}`, '1', 'EX', 3600); // expire in 1 hour
        }

        res.json({ taskId, status: 'cancelled' });
    } catch (err) {
        console.error('Error cancelling task:', err);
        res.status(500).json({ error: 'Failed to cancel task' });
    }
});


// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

initDatabase().then(() => {
    app.listen(PORT, () => console.log(new Date().toLocaleString(), `Server running on port ${PORT}`));
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});