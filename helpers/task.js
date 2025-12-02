import { saveDatabase } from './database.js';
import { getRedisClient } from './redis.js';
import { getEligibleDestinations, getCountryByIata } from './destination.js';
import { getDateRange, getDurationDays, calculateBookingDeadline } from './date.js'
import { scrapeFlightAccommodation } from '../scrapers/flight_accommodation.js'
import { scrapeActivities } from '../scrapers/activities.js'

const budgetRanges = {
    'under-500': { min: 0, max: 500 },
    '500-1000': { min: 500, max: 1000 },
    '1000-2000': { min: 1000, max: 2000 },
    '2000-5000': { min: 2000, max: 5000 },
    'over-5000': { min: 5000, max: 50000 }
};

export function generateTaskId() {
    return `TASK${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

export function logTaskProgress(db, taskId, message) {
    const timestamp = Date.now();
    db.run(
        `INSERT INTO task_logs (task_id, message, timestamp) VALUES (?, ?, ?)`,
        [taskId, message, timestamp]
    );
    saveDatabase(db);
}

export function updateTaskStatus(db, taskId, status, resultData = null, errorMessage = null) {
    const now = Date.now();
    db.run(
        `UPDATE tasks SET status = ?, result_data = ?, error_message = ?, updated_at = ? WHERE id = ?`,
        [status, resultData ? JSON.stringify(resultData) : null, errorMessage, now, taskId]
    );
    saveDatabase(db);
}

export async function cancelTask(db, taskId) {
    const now = Date.now();
    db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?`, ['cancelled', now, taskId, 'pending']);
    saveDatabase(db);

    const redisClient = getRedisClient();
    if (redisClient) {
        await redisClient.set(`cancel:${taskId}`, '1', 'EX', 3600); // expire in 1 hour
    }
}

export async function checkCancelled(db, taskId) {
    // Redis check
    const redisClient = getRedisClient();
    if (redisClient) {
        const cancelled = await redisClient.get(`cancel:${taskId}`);
        if (cancelled) {
            logTaskProgress(db, taskId, 'Task aborted by user - soft');
            updateTaskStatus(db, taskId, 'cancelled');
            return true;
        }
    }
    // DB check fallback
    const statusCheck = db.exec(`SELECT status FROM tasks WHERE id = ?`, [taskId]);
    if (statusCheck.length && statusCheck[0].values.length && statusCheck[0].values[0][0] === 'cancelled') {
        logTaskProgress(db, taskId, 'Task aborted by user - hard');
        return true;
    }
    return false;
}

export async function processTask(db, taskId, requestData) {
    console.log(new Date().toLocaleString(), 'DB Passed', db)
    const results = [];
    try {
        console.log(new Date().toLocaleString(), `[${taskId}] START: processTask initiated`);
        logTaskProgress(db, taskId, `Processing task ${taskId}`);

        // Step 1: Check for cancellation
        console.log(new Date().toLocaleString(), `[${taskId}] Checking initial cancellation status`);
        if (await checkCancelled(db, taskId)) {
            console.log(new Date().toLocaleString(), `[${taskId}] CANCELLED: Task cancelled at start`);
            return;
        }

        // Step 2: Get destination suggestions from LLM
        console.log(new Date().toLocaleString(), `[${taskId}] Fetching destination suggestions from LLM`);
        logTaskProgress(db, taskId, 'Getting destination suggestions from LLM');
        let destinations = getEligibleDestinations(db, requestData);
        console.log(new Date().toLocaleString(), `[${taskId}] Received ${destinations?.length || 0} destinations from Recommendation engine`);

        // Cancellation check after LLM call
        if (await checkCancelled(db, taskId)) {
            console.log(new Date().toLocaleString(), `[${taskId}] CANCELLED: Task cancelled after destination fetch`);
            return;
        }

        console.log(new Date().toLocaleString(), `[${taskId}] Destinations sorted by budget`);

        if (!destinations?.length) {
            console.log(new Date().toLocaleString(), `[${taskId}] ERROR: No destinations returned from LLM`);
            throw new Error('No suitable destinations found');
        }

        logTaskProgress(db, taskId, `Found ${destinations.length} potential destinations`);

        // Step 3: Scrape data for each destination and departure airport
        console.log(new Date().toLocaleString(), `[${taskId}] Starting sourcing loop for ${destinations.length} destinations`);
        for (const i in destinations) {
            const destination = destinations[i];
            console.log(new Date().toLocaleString(), `[${taskId}] LOOP iteration ${Number(i) + 1}/${destinations.length}: Processing ${destination.name}`);

            if (await checkCancelled(db, taskId)) {
                console.log(new Date().toLocaleString(), `[${taskId}] CANCELLED: Task cancelled in loop at iteration ${Number(i) + 1}`);
                return;
            }

            if (results.length >= 3) {
                console.log(new Date().toLocaleString(), `[${taskId}] BREAK: Reached maximum of 3 valid destinations`);
                logTaskProgress(db, taskId, 'Reached maximum of 3 valid destinations');
                break;
            }

            const departure = {
                iata: requestData.departureCountry
            };
       
            if (!departure?.iata) {
                console.log(new Date().toLocaleString(), `[${taskId}] SKIP: Invalid departure airport ${requestData.departureCountry}`);
                logTaskProgress(db, taskId, `Invalid departure airport code: ${requestData.departureCountry}`);
                continue;
            }
            console.log(new Date().toLocaleString(), `✈️ [${Number(i) + 1}/${destinations.length}] Processing destination: ${destination.name} (${destination.airportCode})`);

            try {
                if (await checkCancelled(db, taskId)) {
                    console.log(new Date().toLocaleString(), `[${taskId}] CANCELLED: Task cancelled before flight+accommodation sourcing`);
                    return;
                }

                console.log(new Date().toLocaleString(), `[${taskId}] sourcing flights+accommodation for ${destination.name}`);
                logTaskProgress(db, taskId, `[${Number(i) + 1}/${destinations.length}] Sourcing flight data for ${destination.name}`);
                const adults = requestData.travelers.filter(t => t.type === 'adult').length;
                const children = requestData.travelers.length - adults;

                const departureDate = getDateRange(requestData.timeframe);
                const durationDays = getDurationDays(requestData.duration);
                const returnDate = new Date(departureDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

                const flightPlusAccommodation = await scrapeFlightAccommodation(
                    departure.iata,
                    destination.airportCode,
                    departureDate.toISOString().split('T')[0],
                    returnDate.toISOString().split('T')[0],
                    durationDays,
                    budgetRanges[requestData.budget],
                    adults,
                    children
                );
                console.log(new Date().toLocaleString(), `[${taskId}] Flight+accommodation sourcing complete for ${destination.name}:`, flightPlusAccommodation?.price ? `$${flightPlusAccommodation.price}` : 'NO PRICE');

                if (await checkCancelled(db, taskId)) {
                    console.log(new Date().toLocaleString(), `[${taskId}] CANCELLED: Task cancelled after flight+accommdation sourcing`);
                    return;
                }

                if (!flightPlusAccommodation?.price || Number(flightPlusAccommodation.price) > budgetRanges[requestData.budget].max) {
                    console.log(new Date().toLocaleString(), `[${taskId}] SKIP: Flight+accommodation price invalid or exceeds budget for ${destination.name}`);
                    logTaskProgress(db, taskId, `Skipped ${destination.name}: Flight+accommodation price exceeds budget`);
                    continue;
                }
                logTaskProgress(db, taskId, `Flight+accommodation found for ${destination.name} at $${flightPlusAccommodation.price}`);

                // Activities
                if (await checkCancelled(db, taskId)) {
                    console.log(new Date().toLocaleString(), `[${taskId}] CANCELLED: Task cancelled before activities sourcing`);
                    return;
                }

                console.log(new Date().toLocaleString(), `[${taskId}] sourcing activities for ${destination.name} with budget ${budgetRanges[requestData.budget].max - Number(flightPlusAccommodation.price)}`);
                logTaskProgress(db, taskId, `Sourcing activities data for ${destination.name}`);
                let activitiesData = await scrapeActivities(
                    destination.name,
                    departureDate.toISOString().split('T')[0],
                    returnDate.toISOString().split('T')[0],
                    durationDays,
                    budgetRanges[requestData.budget].max - Number(flightPlusAccommodation.price)
                );
                console.log(new Date().toLocaleString(), `[${taskId}] Activities sourcing complete for ${destination.name}:`, activitiesData?.totalPrice || 'NO PRICE');

                if (await checkCancelled(db, taskId)) {
                    console.log(new Date().toLocaleString(), `[${taskId}] CANCELLED: Task cancelled after activities sourcing`);
                    return;
                }

                if (!activitiesData?.totalPrice || activitiesData.totalPrice > budgetRanges[requestData.budget].max) {
                    console.log(new Date().toLocaleString(), `[${taskId}] Activities price invalid or exceeds budget, using empty activities`, activitiesData);
                    activitiesData = { activities: [], totalPrice: 0 };
                }
                logTaskProgress(db, taskId, `Activities found for ${destination.name} totaling $${activitiesData.totalPrice}`);

                // Combine results
                const totalCost = Number(flightPlusAccommodation.price) + Number(activitiesData.totalPrice);
                console.log(new Date().toLocaleString(), `[${taskId}] Total cost calculated for ${destination.name}: $${totalCost}`);

                if (totalCost > budgetRanges[requestData.budget].max) {
                    console.log(new Date().toLocaleString(), `[${taskId}] SKIP: Total cost exceeds budget for ${destination.name}`);
                    logTaskProgress(db, taskId, `Skipped ${destination.name}: Total cost exceeds budget`);
                    continue;
                }

                if (results.length === 0) {
                    console.log(new Date().toLocaleString(), '🏖️ Adding first destination:', destination.name, `Total Cost: $${totalCost}`);
                    logTaskProgress(db, taskId, `🔥🔥🔥 Yay, found 1 valid destination within budget!`);
                }

                console.log(new Date().toLocaleString(), `[${taskId}] ADDING RESULT: ${destination.name} with cost $${totalCost}`);
                const departureAirportAndCountry = getCountryByIata(db, departure.iata);
                const arrivalAirportAndCountry = getCountryByIata(db, destination.airportCode);
        
                results.push({
                    name: destination.name,
                    visaStatus: destination.visaStatus,
                    visaProcessingTime: destination.visaProcessingTime,
                    visaRequirements: destination.visaRequirements,
                    estimatedCost: {
                        flights: 0.5 * flightPlusAccommodation.price,
                        accommodation: 0.5 * flightPlusAccommodation.price,
                        activities: activitiesData.totalPrice,
                        total: totalCost,
                        currency: flightPlusAccommodation.priceCurrency
                    },
                    flightDetails: {
                        origin: departureAirportAndCountry,
                        destination: arrivalAirportAndCountry,
                        departureDate: departureDate.toISOString().split('T')[0],
                        returnDate: returnDate.toISOString().split('T')[0],
                    },
                    accommodationSuggestion: `<a href="${flightPlusAccommodation.url}" target="_blank">${flightPlusAccommodation.name}</a><br>${flightPlusAccommodation.address}<br>Rating: ${flightPlusAccommodation.rating} (${flightPlusAccommodation.reviews} reviews)<br>Price: ${flightPlusAccommodation.price} (${flightPlusAccommodation.pricePerNight} per night)<br>Perks: ${flightPlusAccommodation.perks || ''}<br><a href="${flightPlusAccommodation.url}" target="_blank">View on Booking.com</a>`,
                    topActivities: activitiesData.activities,
                    timeline: {
                        visaApplication: destination.visaTimeline,
                        bookingDeadline: calculateBookingDeadline(requestData.timeframe),
                        departureDate: departureDate.toISOString().split('T')[0],
                    }
                });
                console.log(new Date().toLocaleString(), `[${taskId}] Results array now has ${results.length} destinations`);

                try {
                    const redisClient = getRedisClient();
                    await redisClient.setex(`TASK:${taskId}`, 3600, JSON.stringify(results));
                    console.log(new Date().toLocaleString(), `[${taskId}] Cached partial results to Redis`);
                } catch (err) {
                    console.warn(new Date().toLocaleString(), `[${taskId}] Failed to cache to Redis:`, err.message);
                }

                logTaskProgress(db, taskId, `Successfully scraped ${destination.name} (total cost: $${totalCost})`);

            } catch (err) {
                console.log(new Date().toLocaleString(), `[${taskId}] ERROR sourcing ${destination.name}:`, err.message);
                logTaskProgress(db, taskId, `Error sourcing data for ${destination.name}: ${err.message}`);
                continue;
            }
        }

        console.log(new Date().toLocaleString(), `[${taskId}] LOOP COMPLETE: Finished processing all destinations. Results count: ${results.length}`);

        if (results.length < 1) {
            console.log(new Date().toLocaleString(), `[${taskId}] ERROR: No results found after loop`);
            throw new Error('Could not retrieve complete data for any destination');
        }

        console.log(new Date().toLocaleString(), `[${taskId}] Sorting ${results.length} results by cost`);
        // Sort by total cost
        results.sort((a, b) => a.estimatedCost.total - b.estimatedCost.total);

        console.log(new Date().toLocaleString(), `[${taskId}] UPDATING STATUS TO COMPLETED with ${results.length} destinations`);
        updateTaskStatus(db, taskId, 'completed', { destinations: results });
        console.log(new Date().toLocaleString(), `[${taskId}] STATUS UPDATE COMPLETE`);

        logTaskProgress(db, taskId, `Task completed with ${results.length} destinations`);
        console.log(new Date().toLocaleString(), `[${taskId}] END: processTask completed successfully`);

    } catch (err) {
        console.error(new Date().toLocaleString(), `[${taskId}] EXCEPTION CAUGHT:`, err);
        if ((await checkCancelled(db, taskId))) {
            console.log(new Date().toLocaleString(), `[${taskId}] Task was cancelled, not logging failure`);
            return;
        }
        console.log(new Date().toLocaleString(), `[${taskId}] Logging task failure`);
        logTaskProgress(db, taskId, `Task failed: ${err.message}`);
        updateTaskStatus(db, taskId, 'failed', null, err.message);
        console.log(new Date().toLocaleString(), `[${taskId}] END: processTask failed`);
    }
}