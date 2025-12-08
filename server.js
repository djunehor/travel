import express, { json } from 'express';
import cors from 'cors';
import { getRedisClient } from './helpers/redis.js';
import { initDatabase, setupDabatase, saveDatabase } from './helpers/database.js';
import { generateTaskId, processTask, updateTaskStatus, cancelTask } from './helpers/task.js';
import { getEligibleDestinations, getFlagEmoji, fetchCurrencyRates } from './helpers/destination.js'
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const app = express();

// Middleware
app.use(cors({ origin: '*' })); // allow access from all origins
app.use(json());

const PORT = process.env.PORT || 3000;
const CACHE_TTL = 86400 * 90; 

const redisClient = getRedisClient();
let db;

// API: Create task
app.post('/plan-vacation', async (req, res) => {
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

app.post('/check-travel', async (req, res) => {
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
app.get('/task/:taskId', async (req, res) => {
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

// API: Cancel task
app.post('/task/:taskId/cancel', async (req, res) => {
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

// Get all airports
app.get('/airports', async (_, res) => {
    try {
        const cacheKey = 'airports:v2';
        
        // Check Redis cache
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            console.log('[CACHE HIT] airports');
            // Set HTTP cache headers (1 day)
            res.set('Cache-Control', 'public, max-age=86400');
            res.set('ETag', `"${Date.now()}"`);
            return res.json(JSON.parse(cachedData));
        }
        
        console.log('[CACHE MISS] airports');
        const result = db.exec(
            `SELECT a.iata, a.name as airport, a.region as region_name,
             a.city as city_name,
             c.iso2 as country_code, c.name as country_name
             FROM airports a
             JOIN countries c ON a.country_id = c.id
             ORDER BY a.id`
        );
        
        if (!result.length || !result[0].values.length) {
            return res.json([]);
        }
        
        const airports = result[0].values.map(([iata, airport, region_name, city_name, country_code, country_name]) => ({
            iata,
            airport,
            region_name,
            city_name,
            country_code,
            country_name
        }));
        
        // Cache in Redis with TTL
        await redisClient.set(cacheKey, JSON.stringify(airports), 'EX', CACHE_TTL);
        
        // Set HTTP cache headers (1 day)
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('ETag', `"${Date.now()}"`);
        
        res.json(airports);
    } catch (err) {
        console.error('Error fetching airports:', err);
        res.status(500).json({ error: 'Failed to fetch airports' });
    }
});

// Get all countries
app.get('/countries', async (_, res) => {
    try {
        const cacheKey = 'countries:all';
        
        // Check Redis cache
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            console.log('[CACHE HIT] countries');
            // Set HTTP cache headers (1 day)
            res.set('Cache-Control', 'public, max-age=86400');
            res.set('ETag', `"${Date.now()}"`);
            return res.json(JSON.parse(cachedData));
        }
        
        console.log('[CACHE MISS] countries');
        const result = db.exec(
            `SELECT c.id, c.name, c.iso2, c.capital, c.region, c.subregion, c.languageCode, c.currencyCode, cl.cost_index, cl.normalized_cost_index
             FROM countries c
             LEFT JOIN cost_of_living cl ON cl.country_id = c.id
             ORDER BY c.name`
        );

        if (!result.length || !result[0].values.length) {
            return res.json([]);
        }

        const countries = result[0].values.map(([id, name, iso2, capital, region, subregion, languageCode, currencyCode, costIndex, normalizedCostIndex]) => ({
            id,
            name,
            code: iso2,
            capital,
            region,
            subregion,
            languageCode,
            currencyCode,
            costIndex,
            normalizedCostIndex,
            emoji: getFlagEmoji(iso2)
        }));
        
        // Cache in Redis with TTL
        await redisClient.set(cacheKey, JSON.stringify(countries), 'EX', CACHE_TTL);
        
        // Set HTTP cache headers (1 day)
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('ETag', `"${Date.now()}"`);
        
        res.json(countries);
    } catch (err) {
        console.error('Error fetching countries:', err);
        res.status(500).json({ error: 'Failed to fetch countries' });
    }
});

app.get('/rates', async (_, res) => {
    try {
        const cacheKey = 'rates:currency';
        
        // Check Redis cache
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            console.log('[CACHE HIT] rates');
            // Set HTTP cache headers (1 day)
            res.set('Cache-Control', 'public, max-age=86400');
            res.set('ETag', `"${Date.now()}"`);
            return res.json(JSON.parse(cachedData));
        }
        
        console.log('[CACHE MISS] rates');
        const rates = await fetchCurrencyRates();
        
        // Cache in Redis with 1 day TTL
        await redisClient.set(cacheKey, JSON.stringify(rates), 'EX', 86400);
        
        // Set HTTP cache headers (1 day)
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('ETag', `"${Date.now()}"`);
        
        res.json(rates);
    } catch (err) {
        console.error('Error fetching rates:', err);
        res.status(500).json({ error: 'Failed to fetch rates' });
    }
});

app.post('/visa-requirements', async (req, res) => {
    try {
        const { nationality, residence, visas, destination } = req.body;

        // Validate required fields
        if (!nationality || !destination) {
            return res.status(400).json({ 
                error: 'Missing required fields: nationality and destination are mandatory.' 
            });
        }

        // Create cache key
        const cacheKey = `visa_req:${JSON.stringify({ nationality, residence, visas: visas || [], destination })}`;
        
        // Check cache
        const cachedResult = await redisClient.get(cacheKey);
        if (cachedResult) {
            console.log(`[CACHE HIT] Visa requirements for ${destination}`);
            return res.json(JSON.parse(cachedResult));
        }

        console.log(`[CACHE MISS] Calculating visa requirements for ${destination}`);

        // Get country IDs
        const nationalityResult = db.exec(
            `SELECT id FROM countries WHERE UPPER(iso2) = ? OR UPPER(name) = ?`,
            [nationality.toUpperCase(), nationality.toUpperCase()]
        );

        const destinationResult = db.exec(
            `SELECT id, name, iso2 FROM countries WHERE UPPER(iso2) = ? OR UPPER(name) = ?`,
            [destination.toUpperCase(), destination.toUpperCase()]
        );

        if (!nationalityResult.length || !nationalityResult[0].values.length) {
            return res.status(404).json({ error: `Nationality country not found: ${nationality}` });
        }

        if (!destinationResult.length || !destinationResult[0].values.length) {
            return res.status(404).json({ error: `Destination country not found: ${destination}` });
        }

        const nationalityId = nationalityResult[0].values[0][0];
        const [destinationId, destinationName, destinationCode] = destinationResult[0].values[0];

        // Get base visa requirement based on nationality
        const baseRequirementResult = db.exec(
            `SELECT requirement FROM visa_requirements 
             WHERE origin_country_id = ? AND destination_country_id = ?`,
            [nationalityId, destinationId]
        );

        let baseRequirement = 'visa required'; // default
        if (baseRequirementResult.length && baseRequirementResult[0].values.length) {
            baseRequirement = baseRequirementResult[0].values[0][0];
        }

        // Prepare held policies (residence + visas)
        const heldPolicies = [];
        
        // Add residence permit if provided
        if (residence) {
            const residenceResult = db.exec(
                `SELECT iso2 FROM countries WHERE UPPER(iso2) = ? OR UPPER(name) = ?`,
                [residence.toUpperCase(), residence.toUpperCase()]
            );
            
            if (residenceResult.length && residenceResult[0].values.length) {
                const residenceCode = residenceResult[0].values[0][0];
                heldPolicies.push(`${residenceCode.toUpperCase()}_RESIDENCE_PERMIT`);
            }
        }

        // Add held visas
        if (visas && Array.isArray(visas) && visas.length > 0) {
            heldPolicies.push(...visas.map(v => v.toUpperCase()));
        }

        // Check for conditional policies that may improve the requirement
        const conditionalRequirements = [];
        
        for (const policy of heldPolicies) {
            const policyResult = db.exec(
                `SELECT resulting_requirement, condition_value, notes 
                 FROM destination_visa_policies 
                 WHERE destination_country_id = ? AND condition_value = ?`,
                [destinationId, policy]
            );

            if (policyResult.length && policyResult[0].values.length) {
                for (const [resultingReq, conditionValue, notes] of policyResult[0].values) {
                    conditionalRequirements.push({
                        condition: conditionValue,
                        requirement: resultingReq,
                        notes: notes || null
                    });
                }
            }
        }

        // Determine the best (most lenient) requirement
        const requirementRanking = {
            'visa free': 1,
            'visa on arrival': 2,
            'eta': 3,
            'e-visa': 4,
            'visa required': 5
        };

        const normalizeRequirement = (req) => {
            const normalized = req.toLowerCase().trim();
            if (normalized.includes('visa free') || normalized.includes('visa-free')) return 'visa free';
            if (normalized.includes('visa on arrival') || normalized.includes('voa')) return 'visa on arrival';
            if (normalized.includes('eta') || normalized.includes('e-ta')) return 'eta';
            if (normalized.includes('e-visa') || normalized.includes('evisa')) return 'e-visa';
            return 'visa required';
        };

        let finalRequirement = normalizeRequirement(baseRequirement);
        let appliedCondition = null;
        let notes = null;

        // Check if any conditional requirement is better
        for (const conditional of conditionalRequirements) {
            const normalizedConditional = normalizeRequirement(conditional.requirement);
            if (requirementRanking[normalizedConditional] < requirementRanking[finalRequirement]) {
                finalRequirement = normalizedConditional;
                appliedCondition = conditional.condition;
                notes = conditional.notes;
            }
        }

        const response = {
            destination: {
                name: destinationName,
                code: destinationCode,
                emoji: getFlagEmoji(destinationCode)
            },
            nationality,
            residence: residence || null,
            visas: visas || [],
            visaRequirement: {
                requirement: finalRequirement,
                baseRequirement: normalizeRequirement(baseRequirement),
                appliedCondition,
                notes,
                conditionalRequirements: conditionalRequirements.length > 0 ? conditionalRequirements : null
            }
        };

        // Cache the result
        await redisClient.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);
        
        res.json(response);
    } catch (err) {
        console.error('Error fetching visa requirements:', err);
        res.status(500).json({ error: 'Failed to fetch visa requirements' });
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