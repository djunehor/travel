import express, { json } from 'express';
import cors from 'cors';
import { getRedisClient } from './helpers/redis.js';
import { initDatabase, setupDabatase, saveDatabase } from './helpers/database.js';
import { generateTaskId, processTask, updateTaskStatus, cancelTask } from './helpers/task.js';
import { getEligibleDestinations, getFlagEmoji } from './helpers/destination.js'
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(json());

const redisClient = getRedisClient();
let db;

// API: Create task
app.post('/api/plan-vacation', async (req, res) => {
    try {
        const requestData = req.body || {};
        // validate
        if (!requestData.budget || !requestData.timeframe || !requestData.duration || !requestData.departureCountry || !requestData.visaPreference || !requestData.travelStyles) {
            return res.status(400).json({ error: 'Missing required fields in request data' });
        }
        const taskId = generateTaskId();
        const now = Date.now();

        db.run(
            `INSERT INTO tasks (id, status, request_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
            [taskId, 'pending', JSON.stringify(requestData), now, now]
        );
        saveDatabase(db);

        console.time(taskId)

        setTimeout(() => cancelTask(db, taskId), 15 * 60 * 1000);
        processTask(db, taskId, requestData)
            .then(() => console.timeEnd(taskId))
            .catch(err => {
                console.error(`Error processing task ${taskId}:`, err);
                updateTaskStatus(db, taskId, 'failed', null, err.message);
            });

        res.json({ taskId, status: 'pending' });
    } catch (err) {
        console.error('Error creating task:', err);
        res.status(500).json({ error: 'Failed to create task' });
    }
});

const CACHE_TTL = 86400 * 90; 

app.post('/api/check-travel', async (req, res) => {
    try {
        const redisClient = getRedisClient();
        const requestData = req.body || {};
        const { nationality, residence, visas, visaPreference } = requestData;

        // 1. Validate Input
        if (!nationality || !residence || !visaPreference) {
            return res.status(400).json({ error: 'Missing required fields: nationality, residence, and visaPreference are mandatory.' });
        }
        
        // 2. Prepare Data and Generate Cache Key
        const singleTraveler = {
            name: 'Primary Traveler',
            type: 'adult',
            nationality: nationality,
            residence: residence,
            visas: visas || [],
        };
        
        const minimalRequestData = {
            travelers: [singleTraveler], 
            visaPreference: visaPreference,
            // Fillers required by getEligibleDestinations internal logic
            budget: 'N/A',
            timeframe: 'N/A',
            duration: 'N/A',
            departureCountry: 'N/A', 
            travelStyles: [],
        };

        // Create a stable, deterministic key using JSON stringify for the critical inputs
        const cacheKey = `visa_eligibility:${JSON.stringify({
            t: minimalRequestData.travelers,
            v: minimalRequestData.visaPreference,
        })}`;
        
        // 3. Check Cache
        const cachedResult = await redisClient.get(cacheKey);

        if (cachedResult) {
            console.log(`[CACHE HIT] Key: ${cacheKey}`);
            // Parse the stored JSON string and return it immediately
            const destinations = JSON.parse(cachedResult);
            return res.json({ data: destinations });
        }
        
        // 4. Cache Miss: Execute Logic
        console.log(`[CACHE MISS] Key: ${cacheKey}. Calculating...`);
        
        let destinations = getEligibleDestinations(db, minimalRequestData).map((s) => {
            // Apply flag emoji and enrich data
            return {
                ...s,
                emoji: getFlagEmoji(s.countryCode)
            }
        });
        
        // 5. Set Cache
        // Store the final, enriched array of destinations as a JSON string with an expiration time
        await redisClient.set(cacheKey, JSON.stringify(destinations), 'EX', CACHE_TTL);
        console.log(`[CACHE SET] TTL: ${CACHE_TTL}s`);

        res.json({ data: destinations });
        
    } catch (err) {
        // Log the error but continue execution for non-critical failures (like a transient Redis connection error)
        console.error('Error getting travel details or Redis operation failed:', err);
        // Do NOT return res.status(500) if the only failure was Redis. Only return 500 if core logic failed.
        
        // If the error is not a fatal code execution error, but only a cache failure, you might still proceed with the response.
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to get travel details' });
        }
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
                    response.data = { destinations: JSON.parse(cached) };
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

// Get all airports
app.get('/api/airports', (_, res) => {
    try {
        const result = db.exec(
            `SELECT a.iata, a.name as airport, a.region as region_name, c.iso2 as country_code
             FROM airports a
             JOIN countries c ON a.country_id = c.id
             ORDER BY a.id`
        );
        
        if (!result.length || !result[0].values.length) {
            return res.json([]);
        }
        
        const airports = result[0].values.map(([iata, airport, region_name, country_code]) => ({
            iata,
            airport,
            region_name,
            country_code
        }));
        
        res.json(airports);
    } catch (err) {
        console.error('Error fetching airports:', err);
        res.status(500).json({ error: 'Failed to fetch airports' });
    }
});

// Get all countries
app.get('/api/countries', (_, res) => {
    try {
        const result = db.exec(
            `SELECT id, name, iso2 FROM countries ORDER BY name`
        );
        
        if (!result.length || !result[0].values.length) {
            return res.json([]);
        }
        
        const countries = result[0].values.map(([id, name, iso2]) => ({
            id,
            name,
            code: iso2
        }));
        
        res.json(countries);
    } catch (err) {
        console.error('Error fetching countries:', err);
        res.status(500).json({ error: 'Failed to fetch countries' });
    }
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
        saveDatabase(db);

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

initDatabase().then((_) => {
    db = _;
    setupDabatase(db);
    console.log(new Date().toLocaleString(), '✅ Database initialized successfully')
    app.listen(PORT, () => console.log(new Date().toLocaleString(), `Server running on port ${PORT}`));
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});