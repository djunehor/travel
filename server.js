const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { scrapeAccommodation, scrapeActivities, scrapeFlights } = require('./scrapers');
const airportCodes = require('./country_airports.json');
require('dotenv').config();

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

    saveDatabase();
}

function saveDatabase() {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getDurationDays(duration) {
    if (typeof duration === 'string' && duration.endsWith('d')) return parseInt(duration.replace('d', ''), 10);
    return Number(duration) || 7;
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

        processTask(taskId, req.body).catch(err => {
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
app.get('/api/task/:taskId', (req, res) => {
    try {
        const { taskId } = req.params;
        const result = db.exec(`SELECT status, result_data, error_message FROM tasks WHERE id = ?`, [taskId]);

        if (!result.length || !result[0].values.length) return res.status(404).json({ error: 'Task not found' });

        const [status, resultData, errorMessage] = result[0].values[0];
        const response = { taskId, status };

        if (status === 'completed' && resultData) response.data = JSON.parse(resultData);
        if (status === 'failed' && errorMessage) response.error = errorMessage;

        res.json(response);
    } catch (err) {
        console.error('Error fetching task:', err);
        res.status(500).json({ error: 'Failed to fetch task' });
    }
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
async function processTask(taskId, requestData) {
    try {
        console.log(`Processing task ${taskId}...`);

        // Step 1: Get destination suggestions from LLM
        console.log('Step 1: Getting destination suggestions from LLM...');
        const destinations = await getDestinationSuggestions(requestData);
        if (!destinations?.length) throw new Error('No suitable destinations found');

        const results = [];

        // Step 2: Scrape data for each destination and departure airport
        for (const destination of destinations) {
            const departureAirports = airportCodes.filter(a => requestData.departureCountry === a.country_code).slice(0, 2);

            for (const departure of departureAirports) {
                try {
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
                    if (!flightData?.price) continue;

                    // Scrape accommodation
                    const accommodationData = await scrapeAccommodation(
                        destination.name,
                        requestData.duration,
                        adults,
                        children
                    );
                    if (!accommodationData) continue;

                    // Scrape activities
                    const activitiesData = await scrapeActivities(
                        destination.name,
                        requestData.travelStyles
                    );
                    if (!activitiesData) continue;

                    // Combine results
                    const totalCost = flightData.price +
                        (accommodationData.pricePerNight * getDurationDays(requestData.duration)) +
                        activitiesData.totalPrice;

                    results.push({
                        name: destination.name,
                        visaStatus: destination.visaStatus,
                        visaProcessingTime: destination.visaProcessingTime,
                        visaRequirements: destination.visaRequirements,
                        estimatedCost: {
                            flights: flightData.price,
                            accommodation: accommodationData.pricePerNight * getDurationDays(requestData.duration),
                            activities: activitiesData.totalPrice,
                            total: totalCost
                        },
                        flightDetails: flightData,
                        accommodationSuggestion: accommodationData.name,
                        topActivities: activitiesData.activities,
                        timeline: {
                            visaApplication: destination.visaTimeline,
                            bookingDeadline: calculateBookingDeadline(requestData.timeframe),
                            departureDate: flightData.departureDate
                        }
                    });

                    console.log(`✓ Successfully scraped ${destination.name}`);

                } catch (err) {
                    console.error(`Error scraping ${destination.name}:`, err.message);
                    continue;
                }
            }
        }

        if (!results.length) throw new Error('Could not retrieve complete data for any destination');

        // Sort by total cost
        results.sort((a, b) => a.estimatedCost.total - b.estimatedCost.total);
        updateTaskStatus(taskId, 'completed', { destinations: results });
        console.log(`✓ Task ${taskId} completed with ${results.length} destinations`);
    } catch (err) {
        console.error(`Task ${taskId} failed:`, err.message);
        updateTaskStatus(taskId, 'failed', null, err.message);
    }
}

// OpenAI helper
async function getDestinationSuggestions(requestData) {
    return [{ name: 'Istanbul, Turkey', countryCode: 'TR', airportCode: 'IST', visaStatus: 'e-visa', visaProcessingTime: '3-5 business days', visaRequirements: ['Valid passport', 'Return ticket', 'Proof of accommodation', 'Valid UK visa'], visaTimeline: 'Apply for an e-visa online before travel. It takes a few minutes to fill out the application.', estimatedBudget: 500, reason: 'Istanbul is a vibrant city known for its rich culinary scene and lively nightlife, making it perfect for food and shopping enthusiasts.' }, { name: 'Accra, Ghana', countryCode: 'GH', airportCode: 'ACC', visaStatus: 'visa-free', visaProcessingTime: 'No visa required', visaRequirements: ['Valid passport', 'Return ticket'], visaTimeline: 'No visa is required for entry; travelers simply need to present their passport and return ticket upon arrival.', estimatedBudget: 400, reason: 'Accra offers a unique blend of culture, nightlife, and delicious local cuisine, ideal for a short getaway.' }, { name: 'Banjul, Gambia', countryCode: 'GM', airportCode: 'BJL', visaStatus: 'visa-on-arrival', visaProcessingTime: '15 minutes at airport', visaRequirements: ['Valid passport', 'Return ticket', 'Proof of accommodation'], visaTimeline: 'Obtain visa on arrival at the airport by presenting necessary documents.', estimatedBudget: 450, reason: 'Banjul is known for its laid-back vibe, local food, and markets, making it a great destination for relaxation and culinary experiences.' }];
    
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
    return result.destinations;
}

// Build prompt
function buildDestinationPrompt(requestData) {
    const { travelers, budget, timeframe, duration, visaPreference, travelStyles } = requestData;
    const budgetRanges = {
        'under-500': { min: 0, max: 500 },
        '500-1000': { min: 500, max: 1000 },
        '1000-2000': { min: 1000, max: 2000 },
        '2000-5000': { min: 2000, max: 5000 },
        'over-5000': { min: 5000, max: 50000 }
    };
    const budgetRange = budgetRanges[budget];

    const travelersInfo = travelers.map((t, i) =>
        `Traveler ${i + 1}: ${t.name}, nationality: ${t.nationality}, residence: ${t.residence}, existing visas: ${t.visas.join(', ') || 'none'}`
    ).join('\n');

    const prompt = `Suggest 2-3 suitable vacation destinations for the following travelers: TRAVELERS: ${travelersInfo} REQUIREMENTS: - Budget: $${budgetRange.min} - $${budgetRange.max} (total for all travelers) - Travel timeframe: ${timeframe} - Trip duration: ${duration} - Visa preference: ${visaPreference} - Travel interests: ${travelStyles.join(', ')} IMPORTANT VISA REQUIREMENTS RULES: 1. Consider each traveler's nationality and residence when determining visa requirements. For example, a resident/citizen of Germany doesn't need visa to visit any schengen country 2. If any traveler who's not a citizen of these countries holds a valid US, UK, or Schengen visa, consider destinations that offer visa-on-arrival or e-visa for such visa holders 3. Based on visa preference: - "visa-free": Only suggest destinations where ALL travelers can enter without visa - "visa-on-arrival": Include destinations with visa-on-arrival for ALL travelers - "short-processing": Include destinations with visa processing up to 4 weeks - "any-processing": Include any destination regardless of visa processing time For each destination, provide: 1. name: Full destination name (city and country) 2. countryCode: ISO 2-letter country code 3. airportCode: IATA code of the main international airport 4. visaStatus: "visa-free" | "visa-on-arrival" | "e-visa" | "standard-visa" 5. visaProcessingTime: Estimated time (e.g., "No visa required", "15 minutes at airport", "3-5 business days", "2-3 weeks") 6. visaRequirements: Array of requirements (e.g., ["Valid passport", "Return ticket", "Proof of accommodation"]) 7. visaTimeline: Brief explanation of visa process 8. estimatedBudget: Rough estimate of total cost for this destination 9. reason: Why this destination is suitable Return ONLY valid JSON in this exact format: { "destinations": [ { "name": "Dubai, UAE", "countryCode": "AE", "airportCode": "DXB", "visaStatus": "visa-on-arrival", "visaProcessingTime": "15 minutes at airport", "visaRequirements": ["Valid passport with 6 months validity", "Return ticket", "Hotel booking"], "visaTimeline": "Get visa on arrival at Dubai airport. Present required documents at immigration.", "estimatedBudget": 1800, "reason": "Offers visa-on-arrival for Nigerian passport holders with valid US/UK/Schengen visa. Popular destination with excellent infrastructure." } ] } ;`;

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
