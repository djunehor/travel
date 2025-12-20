import express, { json } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import Joi from 'joi';
import crypto from 'crypto';
import { getRedisClient } from './helpers/redis.js';
import { initDatabase, setupDabatase, saveDatabase } from './helpers/database.js';
import { generateTaskId, processTask, updateTaskStatus, cancelTask } from './helpers/task.js';
import { getEligibleDestinations, getFlagEmoji, fetchCurrencyRates } from './helpers/destination.js'
import { enqueueTask, getQueueStatus, getTaskQueuePosition, removeTaskFromQueue, initializeQueue } from './helpers/queue.js';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const app = express();

// Middleware
// Trust proxy - required when behind nginx/reverse proxy for accurate IP tracking
app.set('trust proxy', 1);

// Security: Disable X-Powered-By header to prevent information disclosure
app.disable('x-powered-by');

// Security: Apply Helmet.js for HTTP security headers
app.use(helmet({
    contentSecurityPolicy: false, // Configure CSP via nginx for better control
    crossOriginEmbedderPolicy: false // Allow embedding resources from other origins
}));

// Security: Rate limiting to prevent abuse
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 requests per hour
    message: { error: 'Rate limit exceeded for this endpoint.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const wsLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 new connections per hour per IP
    message: { error: 'Too many WebSocket connection attempts.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply general API rate limiter to all routes
app.use(apiLimiter);

// Restrict CORS to the production UI domain `usearlo.to` while allowing
// non-browser requests that have no Origin header (curl, server-to-server).
const isDevelopment = process.env.NODE_ENV === 'development';

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g., curl, mobile apps, server-side)
        if (!origin) return callback(null, true);

        const allowed = [
            'https://usearlo.to',
            'https://www.usearlo.to'
        ];

        // Allow configured production UI domains
        if (allowed.includes(origin)) {
            return callback(null, true);
        }

        // Allow localhost/127.0.0.1 only in development with specific ports
        if (isDevelopment) {
            try {
                const parsed = new URL(origin);
                const hostname = parsed.hostname;
                if (hostname === 'localhost' || hostname === '127.0.0.1') {
                    const port = parsed.port;
                    const allowedPorts = ['5173', '3000', '4173', '8080']; // Vite dev, Express, Vite preview
                    if (!port || allowedPorts.includes(port)) {
                        return callback(null, true);
                    }
                }
            } catch (err) {
                // If origin isn't a valid URL, fall through to deny
            }
        }

        return callback(new Error('Not allowed by CORS'));
    }
}));

// Security: Request size limits to prevent DoS attacks
app.use(json({ 
    limit: '1mb',  // Limit request body size to 1MB
    strict: true   // Only parse arrays and objects
}));

app.use(express.urlencoded({ 
    extended: true, 
    limit: '1mb' 
}));

// Validation schemas
const schemas = {
    planVacation: Joi.object({
        budget: Joi.string().valid('under-500', '500-1000', '1000-2000', '2000-5000', 'over-5000').required(),
        timeframe: Joi.string().valid('1-month', '3-month', '6-month', 'flexible').required(),
        duration: Joi.string().valid('3-5-days', '1-week', '2-weeks', '3-weeks', '1-month', 'flexible').required(),
        departureCountry: Joi.string().length(3).uppercase().required(),
        visaPreference: Joi.string().valid('visa-free', 'visa-on-arrival', 'required', 'any').required(),
        travelStyles: Joi.array().items(Joi.string().max(100)).min(1).max(10).required(),
        travelers: Joi.array().items(Joi.object({
            name: Joi.string().max(100).allow('').optional(),
            type: Joi.string().valid('adult', 'child').required(),
            nationality: Joi.string().length(2).uppercase().required(),
            residence: Joi.string().length(2).uppercase().required(),
            visas: Joi.array().items(Joi.string().length(2).uppercase()).max(20).default([])
        })).min(1).max(20).required()
    }),
    
    checkTravel: Joi.object({
        nationality: Joi.string().length(2).uppercase().required(),
        residence: Joi.string().length(2).uppercase().required(),
        visas: Joi.array().items(Joi.string().length(2).uppercase()).max(20).optional(),
        visaPreference: Joi.string().valid('visa-free', 'visa-on-arrival', 'required', 'any').required()
    }),
    
    feedback: Joi.object({
        name: Joi.string().max(200).allow(null, '').optional(),
        email: Joi.string().email().max(320).required(),
        message: Joi.string().max(5000).allow(null, '').optional()
    }),
    
    extractTripData: Joi.object({
        transcriptHistory: Joi.array().items(Joi.object({
            role: Joi.string().valid('user', 'assistant', 'system').required(),
            content: Joi.string().max(50000).required()
        })).min(1).max(100).required(),
        extractionPrompt: Joi.string().max(10000).required()
    }),
    
    cancelTask: Joi.object({
        taskToken: Joi.string().length(64).optional()
    })
};

// Validation middleware
const validate = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body, { 
        abortEarly: false,
        stripUnknown: true 
    });
    
    if (error) {
        const errors = error.details.map(detail => detail.message);
        return res.status(400).json({ 
            error: 'Validation failed', 
            details: isDevelopment ? errors : undefined
        });
    }
    
    req.body = value; // Use sanitized value
    next();
};

const PORT = process.env.PORT || 3000;
const CACHE_TTL = 86400 * 90; 

const redisClient = getRedisClient();
let db;

// API: Create task
app.post('/plan-vacation', validate(schemas.planVacation), strictLimiter, async (req, res) => {
    try {
        const requestData = req.body;
        const taskId = generateTaskId();
        const taskToken = crypto.randomBytes(32).toString('hex'); // Ownership token
        const now = Date.now();

        db.run(
            `INSERT INTO tasks (id, status, request_data, task_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, 'pending', JSON.stringify(requestData), taskToken, now, now]
        );
        saveDatabase(db);

        console.time(taskId)

        // Enqueue the task with automatic timeout
        const queueInfo = await enqueueTask(taskId, async () => {
            try {
                await Promise.race([
                    processTask(db, taskId, requestData),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Task timeout')), 15 * 60 * 1000))
                ]);
                console.timeEnd(taskId);
            } catch (err) {
                console.error(`Error processing task ${taskId}:`, err);
                updateTaskStatus(db, taskId, 'failed', null, err.message);
            }
        });

        res.json({
            taskId,
            taskToken, // Return token to client for ownership verification
            status: 'queued',
            queued: true,
            message: 'Your task has been queued and will start when a processing slot is available.',
            queuePosition: queueInfo.position,
            totalQueued: queueInfo.totalQueued
        });
    } catch (err) {
        console.error('Error creating task:', err);
        res.status(500).json({ error: 'Failed to create task' });
    }
});

app.post('/check-travel', validate(schemas.checkTravel), async (req, res) => {
    try {
        const redisClient = getRedisClient();
        const requestData = req.body;
        const { nationality, residence, visas, visaPreference } = requestData;
        
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

        // Include queue info if available
        try {
            const position = await getTaskQueuePosition(taskId);
            if (position) {
                response.queued = Boolean(position.isQueued);
                response.isActive = Boolean(position.isActive);
                if (position.position) response.queuePosition = position.position;
                if (position.totalQueued !== undefined) response.totalQueued = position.totalQueued;
            }
        } catch (err) {
            // Non-fatal: don't block returning task info if queue lookup fails
            console.warn('⚠️ Failed to fetch queue position:', err.message);
        }

        res.json(response);
    } catch (err) {
        console.error('Error fetching task:', err);
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

// API: Cancel task
app.post('/task/:taskId/cancel', validate(schemas.cancelTask), async (req, res) => {
    try {
        const { taskId } = req.params;
        const { taskToken } = req.body;

        const taskResult = db.exec(`SELECT status, task_token FROM tasks WHERE id = ?`, [taskId]);
        if (!taskResult.length || !taskResult[0].values.length) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const [status, storedToken] = taskResult[0].values[0];
        
        // Verify ownership if token is provided (backward compatible)
        if (taskToken && storedToken && taskToken !== storedToken) {
            return res.status(403).json({ error: 'Forbidden: Invalid task token' });
        }
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            return res.status(400).json({ error: `Cannot cancel a task with status ${status}` });
        }

        // Update status to cancelled
        const now = Date.now();
        db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, ['cancelled', now, taskId]);
        saveDatabase(db);

        // Try to remove from queue if not yet started
        await removeTaskFromQueue(taskId);

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

// Centralized error handler (must be last middleware)
app.use((err, req, res, next) => {
    // Log full error server-side
    console.error('Error:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString()
    });
    
    // Send sanitized error to client
    const statusCode = err.statusCode || err.status || 500;
    const message = isDevelopment ? err.message : 'An error occurred';
    
    // Don't send response if headers already sent
    if (res.headersSent) {
        return next(err);
    }
    
    res.status(statusCode).json({
        error: message,
        ...(isDevelopment && { stack: err.stack })
    });
});

// Extract trip data from conversation transcript
app.post('/extract-trip-data', validate(schemas.extractTripData), strictLimiter, async (req, res) => {
    try {
        const { transcriptHistory, extractionPrompt } = req.body;

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            console.error('[Extract] Missing GEMINI_API_KEY in environment');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const EXTRACTION_MODEL = 'gemini-2.0-flash';
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EXTRACTION_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

        // Format transcript for the prompt
        const formattedTranscript = transcriptHistory
            .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
            .join('\n');

        const payload = {
            contents: [
                {
                    parts: [
                        { text: extractionPrompt },
                        { text: `\n\n**Conversation Transcript:**\n${formattedTranscript}` }
                    ]
                }
            ],
            generationConfig: {
                response_mime_type: "application/json",
                temperature: 0.1
            }
        };

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[Extract] Gemini Extraction Error:", errorText);
            return res.status(response.status).json({ error: `Extraction failed: ${response.status}` });
        }

        const data = await response.json();
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!resultText) {
            return res.status(500).json({ error: "No data returned from extraction model" });
        }

        // Parse JSON response
        const extractedData = JSON.parse(resultText);
        res.json(extractedData);

    } catch (error) {
        console.error("[Extract] Failed to extract trip data:", error);
        res.status(500).json({ error: 'Failed to extract trip data', details: error.message });
    }
});

// Feedback form handler
app.post('/feedback', validate(schemas.feedback), async (req, res) => {
    try {
        const { name, email, message } = req.body;

        const createdAt = Date.now();

        db.run(
            `INSERT INTO feedback (name, email, message, created_at) VALUES (?, ?, ?, ?)`,
            [name || null, email || null, message || null, createdAt]
        );
        saveDatabase(db);

        // Cache recent feedback in Redis (keep latest 100)
        try {
            const item = { name: name || null, email: email || null, message: message || null, createdAt };
            if (redisClient) {
                await redisClient.lpush('feedback:recent', JSON.stringify(item));
                await redisClient.ltrim('feedback:recent', 0, 99);
            }
        } catch (err) {
            console.warn('Failed to cache feedback in Redis:', err.message);
        }

        res.status(201).json({ status: 'ok' });
    } catch (err) {
        console.error('Error saving feedback:', err);
        res.status(500).json({ error: 'Failed to save feedback' });
    }
});

// Queue status endpoints
app.get('/queue/status', async (_, res) => {
    try {
        const status = await getQueueStatus();
        res.json(status);
    } catch (err) {
        console.error('Error fetching queue status:', err);
        res.status(500).json({ error: 'Failed to get queue status' });
    }
});

app.get('/task/:taskId/queue-position', async (req, res) => {
    try {
        const { taskId } = req.params;
        const position = await getTaskQueuePosition(taskId);
        
        if (!position) {
            return res.status(404).json({ error: 'Task not found in queue' });
        }
        
        res.json({ taskId, ...position });
    } catch (err) {
        console.error('Error fetching queue position:', err);
        res.status(500).json({ error: 'Failed to get queue position' });
    }
});

// Get a random recently generated itinerary
app.get('/itineraries/random', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        const since = req.query.since ? parseInt(req.query.since, 10) : (Date.now() - 1000 * 60 * 60 * 24 * 7); // default: last 7 days

        const result = db.exec(
            `SELECT id, result_data, updated_at FROM tasks WHERE status = ? AND result_data IS NOT NULL AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?`,
            ['completed', since, limit]
        );

        if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'No itineraries found' });

        const rows = result[0].values.map(([id, resultData, updated_at]) => ({ id, data: JSON.parse(resultData), updated_at }));

        const randomItem = rows[Math.floor(Math.random() * rows.length)];

        res.json({ taskId: randomItem.id, updatedAt: randomItem.updated_at, itinerary: randomItem.data });
    } catch (err) {
        console.error('Error fetching random itinerary:', err);
        res.status(500).json({ error: 'Failed to fetch itinerary' });
    }
});

initDatabase().then((_) => {
    db = _;
    setupDabatase(db);
    initializeQueue();
    console.log(new Date().toLocaleString(), '✅ Database initialized successfully')
    
    const server = app.listen(PORT, () => {
        console.log(new Date().toLocaleString(), `Server running on port ${PORT}`);
    });

    // WebSocket server for Gemini Live API proxy
    const wss = new WebSocketServer({ server, path: '/gemini-live' });
    
    wss.on('connection', (clientWs, req) => {
        const clientIp = req.socket.remoteAddress;
        const connectionId = `${clientIp}-${Date.now()}`;
        
        console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] Client connected from ${clientIp}`);
        
        // Verify Gemini API key exists
        if (!process.env.GEMINI_API_KEY) {
            console.error(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ❌ Missing GEMINI_API_KEY in environment`);
            clientWs.close(1008, 'Server configuration error');
            return;
        }

        // Connect to Gemini API on behalf of client
        // API key must be passed as query parameter for WebSocket connections
        console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] Initiating connection to Gemini API...`);
        const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
        const geminiWs = new WebSocket(geminiUrl);
        
        let messageCount = { toGemini: 0, toClient: 0 };

        geminiWs.on('open', () => {
            console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ✅ Connected to Gemini API`);
        });

        geminiWs.on('error', (error) => {
            console.error(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ❌ Gemini WebSocket error:`, {
                message: error.message,
                code: error.code,
                stack: isDevelopment ? error.stack : undefined
            });
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close(1011, 'Upstream service error');
            }
        });

        geminiWs.on('close', (code, reason) => {
            console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] Gemini connection closed - Code: ${code}, Reason: ${reason || 'none'}`);
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close(1000, 'Upstream closed');
            }
        });

        geminiWs.on('message', (data) => {
            messageCount.toClient++;
            
            // Log message type without exposing sensitive data
            try {
                const parsed = JSON.parse(data.toString());
                console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ⬇️  Message #${messageCount.toClient} from Gemini:`, 
                    Object.keys(parsed).join(', '));
            } catch {
                console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ⬇️  Message #${messageCount.toClient} from Gemini (binary/unparseable)`);
            }
            
            // Relay Gemini response to client
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data);
            } else {
                console.warn(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ⚠️  Cannot send to client - connection not open (state: ${clientWs.readyState})`);
            }
        });

        // Relay client messages to Gemini
        clientWs.on('message', (data) => {
            messageCount.toGemini++;
            
            // Log message type without exposing sensitive data
            try {
                const parsed = JSON.parse(data.toString());
                console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ⬆️  Message #${messageCount.toGemini} to Gemini:`, 
                    Object.keys(parsed).join(', '));
            } catch {
                console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ⬆️  Message #${messageCount.toGemini} to Gemini (binary/unparseable)`);
            }
            
            if (geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(data);
            } else {
                console.warn(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ⚠️  Cannot send to Gemini - connection not open (state: ${geminiWs.readyState})`);
            }
        });

        clientWs.on('close', (code, reason) => {
            console.log(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] Client disconnected - Code: ${code}, Reason: ${reason || 'none'}, Messages: ${messageCount.toGemini} sent, ${messageCount.toClient} received`);
            if (geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.close();
            }
        });

        clientWs.on('error', (error) => {
            console.error(new Date().toLocaleString(), `[Gemini Proxy] [${connectionId}] ❌ Client WebSocket error:`, {
                message: error.message,
                code: error.code
            });
        });
    });

    console.log(new Date().toLocaleString(), '✅ Gemini WebSocket proxy initialized on path /gemini-live');
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
