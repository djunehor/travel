import { getRedisClient } from './redis.js';

export function normalizeVisaStatus(requirement) {
    if (!requirement) return 'visa required';
    const req = requirement.toLowerCase().trim();

    // Handle numeric values (days allowed) as visa-free
    if (!isNaN(req)) return 'visa-free';

    if (req === 'visa-free' || req === 'visa free' || req === 'no visa required') return 'visa-free';
    if (req === 'visa on arrival' || req === 'visa-on-arrival') return 'visa-on-arrival';
    if (req === 'e-visa' || req === 'evisa') return 'e-visa';
    return 'visa required';
}

export function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) {
        return ''; // Return empty string for invalid codes
    }

    // The magic offset: 127397 (Regional Indicator 'A' - ASCII 'A')
    const OFFSET = 127397;

    // 1. Convert to uppercase
    // 2. Split into individual characters ('D', 'E')
    // 3. Map each character to its Unicode code point (e.g., 'D' -> 68)
    // 4. Add the offset to get the Regional Indicator Symbol code point (e.g., 68 + 127397)
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => OFFSET + char.charCodeAt(0));

    // Convert the two code points back into a single string (the flag emoji)
    return String.fromCodePoint(...codePoints);
}

export function isRequirementBetter(req1, req2) {
    const hierarchy = {
        'visa-free': 0,
        'visa-on-arrival': 1,
        'e-visa': 2,
        'visa required': 3
    };
    return hierarchy[req1] < hierarchy[req2];
}

export function meetsVisaPreference(requirement, preference) {
    const normalized = normalizeVisaStatus(requirement);

    const acceptableStatuses = {
        'visa-free': ['visa-free'],
        'visa-on-arrival': ['visa-free', 'visa-on-arrival'],
        'short-processing': ['visa-free', 'visa-on-arrival', 'e-visa'],
        'any-processing': ['visa-free', 'visa-on-arrival', 'e-visa', 'visa required']
    };

    return acceptableStatuses[preference]?.includes(normalized) || false;
}

export function getCountryId(db, iso2) {
    if (!iso2) return null;
    const result = db.exec(`SELECT id FROM countries WHERE iso2 = ?`, [iso2.toUpperCase()]);
    if (result.length && result[0].values.length) {
        return result[0].values[0][0];
    }
    return null;
}

// A list of Schengen countries' ISO2 codes for policy normalization
function isSchengenCountry(iso2) {
    if (!iso2) return false;
    const SCHENGEN_ISO2 = new Set([
        'AT', 'BE', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
        'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
        'PT', 'SK', 'SI', 'ES', 'SE', 'CH', 'BG', 'HR', 'RO'
    ]);
    return SCHENGEN_ISO2.has(iso2.toUpperCase());
}

// Assumes normalizeVisaStatus, isRequirementBetter, getCountryId are defined elsewhere

export function getVisaEligibilityForTraveler(db, traveler, visaPreference) {
    const eligible = new Map(); // destination_id -> {requirement, source}
    console.log(`[DEBUG] Starting eligibility check for: ${traveler.nationality} (Nat), ${traveler.residence} (Res)`);

    const nationalityId = getCountryId(db, traveler.nationality);

    // --- 1. Prepare Held Policies and Separate by Type ---
    const heldPolicies = [];

    // a) Add Residence Permit Policy (Priority 1)
    if (traveler.residence) {
        let residencePolicyValue;
        if (isSchengenCountry(traveler.residence)) {
            residencePolicyValue = 'SCHENGEN_RESIDENCE_PERMIT';
        } else {
            residencePolicyValue = `${traveler.residence.toUpperCase()}_RESIDENCE_PERMIT`;
        }
        heldPolicies.push(residencePolicyValue);
        console.log(`[DEBUG] Added Residence Policy: ${residencePolicyValue}`);
    }

    // b) Add other Held Visas (Priority 2)
    if (traveler.visas && traveler.visas.length > 0) {
        for (const visa of traveler.visas) {
            const visaPolicyValue = visa.toUpperCase();
            if (!heldPolicies.includes(visaPolicyValue)) {
                heldPolicies.push(visaPolicyValue);
                console.log(`[DEBUG] Added Held Visa Policy: ${visaPolicyValue}`);
            }
        }
    }

    const residencePolicy = heldPolicies.find(p => p.endsWith('_RESIDENCE_PERMIT'));
    const otherPolicies = heldPolicies.filter(p => !p.endsWith('_RESIDENCE_PERMIT'));

    if (!nationalityId) {
        console.warn(`Country not found: ${traveler.nationality}`);
        return eligible;
    }

    // 2. Check base requirements from nationality
    const nationalityResults = db.exec(
        `SELECT destination_country_id, requirement 
         FROM visa_requirements 
         WHERE origin_country_id = ?`,
        [nationalityId]
    );

    if (nationalityResults.length && nationalityResults[0].values.length) {
        for (const [destId, req] of nationalityResults[0].values) {
            const normalized = normalizeVisaStatus(req);
            eligible.set(destId, { requirement: normalized, source: 'nationality' });
            // For brevity, only log when the base is important
            if (normalized !== 'visa required') {
                console.log(`[DEBUG] Base: ${destId} set to ${normalized} (Nationality)`);
            }
        }
    }

    // 3. Check conditional requirements (FORCED PRIORITY ORDER)

    // --- Part A: Residence Policy (Highest Priority for Narrative) ---
    if (residencePolicy) {
        console.log(`[DEBUG] Processing Residence Policy: ${residencePolicy}`);
        const policyResults = db.exec(
            `SELECT destination_country_id, resulting_requirement 
             FROM destination_visa_policies 
             WHERE condition_value = ?`,
            [residencePolicy]
        );

        if (policyResults.length && policyResults[0].values.length) {
            for (const [destId, resultReq] of policyResults[0].values) {
                const normalized = normalizeVisaStatus(resultReq);
                const existingInfo = eligible.get(destId);
                const isBetter = !existingInfo || isRequirementBetter(normalized, existingInfo.requirement);

                if (isBetter) {
                    // Update only if strictly better
                    eligible.set(destId, {
                        requirement: normalized,
                        source: `residence_${traveler.residence.toUpperCase()}`
                    });
                    console.log(`[DEBUG] -> Dest ${destId}: UPDATED to ${normalized} (RESIDENCE - Better)`);
                }
                // If it's not strictly better, but it's the same best status, we keep the Residence source (which is implied here
                // because we check Residence FIRST, but we'll add a check for robustness if Residence runs AFTER a Held Visa,
                // which is prevented by this structural change, but the next loop iteration might be needed for the UK visa to run first
                // if the order was somehow reversed. The previous priority fix is better placed here to show intent:

                // Since this section is dedicated to the Residence Policy, we MUST ensure the source is set if it's the best status.
                // However, since we now check Residence FIRST, we only need 'isBetter'. 
            }
        }
    }

    // --- Part B: Other Held Visas (Secondary Priority) ---
    if (otherPolicies.length > 0) {
        console.log(`[DEBUG] Processing Other Held Visas: ${otherPolicies.join(', ')}`);
        for (const heldVisa of otherPolicies) {

            const policyResults = db.exec(
                `SELECT destination_country_id, resulting_requirement 
                 FROM destination_visa_policies 
                 WHERE condition_value = ?`,
                [heldVisa]
            );

            if (policyResults.length && policyResults[0].values.length) {
                for (const [destId, resultReq] of policyResults[0].values) {
                    const normalized = normalizeVisaStatus(resultReq);
                    const existingInfo = eligible.get(destId);

                    // Only update if this held visa is STRICTLY better than what's currently recorded 
                    // (which should be the Residence Policy result, if applicable).
                    if (!existingInfo || isRequirementBetter(normalized, existingInfo.requirement)) {

                        eligible.set(destId, {
                            requirement: normalized,
                            source: `holds_${heldVisa.replace('_RESIDENCE_PERMIT', '')}_visa`
                        });
                        console.log(`[DEBUG] -> Dest ${destId}: UPDATED to ${normalized} (VISA - Strictly Better)`);
                    } else {
                        console.log(`[DEBUG] -> Dest ${destId}: SKIPPED ${heldVisa} (Not Better than ${existingInfo?.requirement})`);
                    }
                }
            }
        }
    }

    // Filter by visa preference
    const filtered = new Map();
    for (const [destId, info] of eligible.entries()) {
        if (meetsVisaPreference(info.requirement, visaPreference)) {
            filtered.set(destId, info);
        }
    }

    console.log(`[DEBUG] Final eligible count: ${filtered.size}`);
    return filtered;
}

/**
 * Get country code (ISO2) by airport IATA code
 * @param {Object} db - Database instance
 * @param {string} iata - Airport IATA code (e.g., 'LOS', 'JFK')
 * @returns {string|null} - Country ISO2 code or null if not found
 */
function getCountryCodeByIata(db, iata) {
    if (!iata) return null;

    const result = db.exec(
        `SELECT c.iso2 
         FROM airports a
         JOIN countries c ON a.country_id = c.id
         WHERE a.iata = ?`,
        [iata.toUpperCase()]
    );

    if (result.length && result[0].values.length) {
        return result[0].values[0][0];
    }

    return null;
}

/**
 * Get country by airport IATA code
 * @param {Object} db - Database instance
 * @param {string} iata - Airport IATA code (e.g., 'LOS', 'JFK')
 * @returns {Object|null} - Country object {id, country_id, iata, airport_name, city, region, iso2, name, continent, sub_continent} or null if not found
 */
export function getCountryByIata(db, iata) {
    if (!iata) return null;

    const result = db.exec(
        `SELECT a.id, c.id as country_id, a.iata, a.name as airport_name,
        a.city, a.region, c.iso2, c.name, c.region as continent,
        c.subregion as sub_continent,
        c.latitude as country_latitude, c.longitude as country_longitude,
        a.latitude as airport_latitude, a.longitude as airport_longitude
         FROM airports a
         JOIN countries c ON a.country_id = c.id
         WHERE a.iata = ?`,
        [iata.toUpperCase()]
    );

    if (result.length && result[0].values.length) {
        const [id, country_id, iata, airport_name, city, region, iso2, name, continent, sub_continent, country_latitude, country_longitude, airport_latitude, airport_longitude] = result[0].values[0];
        return {
            id,
            country_id,
            iata,
            airport_name,
            city,
            region,
            iso2,
            name,
            continent,
            sub_continent,
            country_latitude,
            country_longitude,
            airport_latitude,
            airport_longitude
        };
    }

    return null;
}

/**
 * Get primary airport for a country by country code
 * @param {Object} db - Database instance
 * @param {string} countryCode - Country ISO2 code (e.g., 'NG', 'US')
 * @returns {Object|null} - Airport object {iata, name, city} or null if not found
 */
export function getAirportByCountryCode(db, countryCode) {
    if (!countryCode) return null;

    // Get all airports and country/capital info
    const result = db.exec(
        `SELECT a.iata, a.name, a.city, a.latitude, a.longitude, c.capital, c.latitude as country_latitude, c.longitude as country_longitude
         FROM airports a
         JOIN countries c ON a.country_id = c.id
         WHERE c.iso2 = ?`,
        [countryCode.toUpperCase()]
    );

    if (!result.length || !result[0].values.length) return null;

    const airports = result[0].values.map(row => {
        const [iata, name, city, latitude, longitude, capital, countryLat, countryLon] = row;
        return { iata, name, city, latitude, longitude, capital, countryLat, countryLon };
    });

    // Try to find airports in the capital city
    const capitalName = airports[0].capital;
    const inCapital = airports.filter(a => a.city && a.city.toLowerCase() === (capitalName || '').toLowerCase());

    // Haversine formula
    function haversine(lat1, lon1, lat2, lon2) {
        function toRad(x) { return x * Math.PI / 180; }
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    let closestAirport = null;
    if (inCapital.length > 0) {
        // Use country center as proxy for capital center
        const countryLat = airports[0].countryLat;
        const countryLon = airports[0].countryLon;
        closestAirport = inCapital.reduce((min, a) => {
            const dist = haversine(countryLat, countryLon, a.latitude, a.longitude);
            return (!min || dist < min.dist) ? { airport: a, dist } : min;
        }, null).airport;
    } else {
        // Find closest to country center
        const countryLat = airports[0].countryLat;
        const countryLon = airports[0].countryLon;
        closestAirport = airports.reduce((min, a) => {
            const dist = haversine(countryLat, countryLon, a.latitude, a.longitude);
            return (!min || dist < min.dist) ? { airport: a, dist } : min;
        }, null).airport;
    }

    if (closestAirport) {
        return { iata: closestAirport.iata, name: closestAirport.name, city: closestAirport.city };
    }
    return null;
}

export function getAirportByIata(db, iata) {
    if (!iata) return null;

    const result = db.exec(
        `SELECT a.iata, a.name, a.region as city
         FROM airports a
         WHERE a.iata = ?
         LIMIT 1`,
        [iata.toUpperCase()]
    );

    if (result.length && result[0].values.length) {
        const [iata, name, city] = result[0].values[0];
        return { iata, name, city };
    }

    return null;
}


export function getEligibleDestinations(db, requestData) {
    const { travelers, visaPreference, travelStyles, departureCountry } = requestData;

    const departureCountryCode = getCountryCodeByIata(db, departureCountry);
    const departureCountryId = getCountryId(db, departureCountryCode);

    // Get all travelers' country IDs to exclude
    const excludeIds = new Set([departureCountryId].filter(Boolean));
    for (const traveler of travelers) {
        const natId = getCountryId(db, traveler.nationality);
        const resId = getCountryId(db, traveler.residence);
        if (natId) excludeIds.add(natId);
        if (resId) excludeIds.add(resId);
    }

    // Get visa eligibility for each traveler
    const eligibleByTraveler = travelers.map(traveler =>
        getVisaEligibilityForTraveler(db, traveler, visaPreference)
    );

    if (eligibleByTraveler.length === 0) {
        console.log('No travelers provided');
        return [];
    }

    // Find intersection (countries eligible for ALL travelers)
    let eligibleCountries = new Map(eligibleByTraveler[0]);

    for (let i = 1; i < eligibleByTraveler.length; i++) {
        const newEligible = new Map();

        for (const [destId, info] of eligibleCountries.entries()) {
            if (eligibleByTraveler[i].has(destId)) {
                // Use the worst requirement among all travelers
                const otherInfo = eligibleByTraveler[i].get(destId);
                const worstRequirement = isRequirementBetter(info.requirement, otherInfo.requirement)
                    ? otherInfo.requirement
                    : info.requirement;

                newEligible.set(destId, { requirement: worstRequirement, source: 'multiple' });
            }
        }

        eligibleCountries = newEligible;
    }

    // Remove excluded countries
    excludeIds.forEach(id => eligibleCountries.delete(id));

    console.log(`Found ${eligibleCountries.size} countries meeting visa requirements`);

    // Filter by travel style preferences (but don't fail if none match)
    if (travelStyles && travelStyles.length > 0) {
        const styleColumns = travelStyles
            .map(s => s.replace(/-/g, '_'))
            .join(' = 1 OR ');
        const styleFilter = `(${styleColumns} = 1)`;

        const countryIdList = [...eligibleCountries.keys()].join(',');

        if (countryIdList) {
            const results = db.exec(
                `SELECT id FROM countries 
                 WHERE id IN (${countryIdList}) 
                 AND ${styleFilter}`
            );

            if (results.length && results[0].values.length) {
                const filtered = new Set(results[0].values.map(row => row[0]));

                // Keep only countries that match style preferences
                for (const destId of eligibleCountries.keys()) {
                    if (!filtered.has(destId)) {
                        eligibleCountries.delete(destId);
                    }
                }

                console.log(`After travel style filter: ${eligibleCountries.size} countries`);
            } else {
                console.log('⚠️ Warning: No countries match the selected travel styles, returning all visa-eligible countries');
                // Don't filter - return all visa-eligible destinations
            }
        }
    }

    // Build destination objects with country details
    const destinations = [];

    // In the final loop where destinations are built:
    for (const [countryId, visaInfo] of eligibleCountries.entries()) {
        const countryResult = db.exec(
            `SELECT name, iso2 FROM countries WHERE id = ?`,
            [countryId]
        );

        if (!countryResult.length || !countryResult[0].values.length) continue;

        const [countryName, countryCode] = countryResult[0].values[0];
        const airport = getAirportByCountryCode(db, countryCode);

        if (!airport) {
            console.log(`⚠️ No airport found for ${countryName} (${countryCode})`);
            continue;
        }

        destinations.push({
            name: countryName,
            countryCode: countryCode,
            airportCode: airport.iata,
            visaStatus: visaInfo.requirement,
            visaProcessingTime: getProcessingTime(visaInfo.requirement),
            visaRequirements: getVisaRequirements(visaInfo.requirement),
            visaTimeline: generateVisaTimeline(db, visaInfo.requirement, travelers, countryName, visaInfo.source), // Pass source
            estimatedBudget: 0
        });
    }

    // sort randomly
    destinations.sort(() => Math.random() - 0.5);

    console.log(`Returning ${destinations.length} destinations for scraping`);
    return destinations;
}

function getProcessingTime(visaStatus) {
    const times = {
        'visa-free': 'No visa required',
        'visa-on-arrival': '15-30 minutes at airport',
        'e-visa': '3-5 business days',
        'visa required': '2-4 weeks'
    };
    return times[visaStatus] || 'Unknown';
}

function getVisaRequirements(visaStatus) {
    const requirements = {
        'visa-free': ['Valid passport with 6 months validity'],
        'visa-on-arrival': ['Valid passport', 'Return ticket', 'Proof of accommodation'],
        'e-visa': ['Valid passport', 'Online application', 'Payment', 'Passport photo'],
        'visa required': ['Valid passport', 'Visa application form', 'Passport photos', 'Proof of funds', 'Travel itinerary']
    };
    return requirements[visaStatus] || [];
}

function generateVisaTimeline(db, visaStatus, travelers, countryName, source) {
    if (visaStatus === 'visa-free') {

        // --- 1. Handle Residence Permit Source (e.g., residence_DE) ---
        if (source && source.startsWith('residence_')) {
            const residenceCode = source.split('_')[1];

            // Safely retrieve residence country name
            const residenceResult = db.exec(`SELECT name FROM countries WHERE iso2 = ?`, [residenceCode]);
            const residenceName = residenceResult.length && residenceResult[0].values.length
                ? residenceResult[0].values[0][0]
                : residenceCode; // Fallback to 'DE' if name not found

            // Generate traveler list with robust name lookup
            const travelerInfo = travelers.map(t => {
                const natResult = db.exec(`SELECT name FROM countries WHERE iso2 = ?`, [t.nationality]);
                const nationality = natResult.length && natResult[0].values.length
                    ? natResult[0].values[0][0]
                    : t.nationality; // Fallback to 'NG' if name not found

                // This assumes all travelers benefit from the same residence permit
                return `${nationality} citizen with ${residenceName} residence permit`;
            }).join(', ');

            return `Visa-free entry through residence permit. As ${travelerInfo}, you can enter ${countryName} without a visa.`;
        }

        // --- 2. Handle Held Visa Source (e.g., holds_SCHENGEN_visa) ---
        if (source && source.startsWith('holds_')) {
            // Extract visa type from source like "holds_UK_visa" or "holds_SCHENGEN_visa"
            const match = source.match(/holds_(.+?)_visa/);
            const visaType = match ? match[1].replace('_RESIDENCE_PERMIT', '') : 'valid visa'; // Clean up the policy value

            return `Visa-free entry for ${visaType} visa/residence permit holders. Present your valid ${visaType} document and passport at ${countryName} immigration.`;
        }

        // --- 3. Handle Nationality Source ---
        else if (source === 'nationality') {
            const nationalityList = travelers.map(t => {
                const result = db.exec(`SELECT name FROM countries WHERE iso2 = ?`, [t.nationality]);
                return result.length && result[0].values.length ? result[0].values[0][0] : t.nationality;
            }).join(', ');

            return `No visa required for citizens of ${nationalityList}.`;
        }

        // --- 4. Fallback ---
        else {
            return `No visa required. Check with ${countryName} embassy for entry requirements.`;
        }
    }

    if (visaStatus === 'visa-on-arrival') {
        return `Visa on arrival available at ${countryName} airport. Present passport, return ticket, and proof of accommodation.`;
    }

    if (visaStatus === 'e-visa') {
        return `Apply for e-visa online 3-5 business days before travel. Processing typically takes 3-5 business days.`;
    }

    // Default for 'visa required'
    return `Standard visa application required. Apply at ${countryName} embassy or consulate 2-4 weeks before departure.`;
}

export async function fetchCurrencyRates() {
    const redisClient = getRedisClient();
    if (redisClient) {
        const currencyRates = await redisClient.get(`currency_rates`);

        if (currencyRates) {
            return JSON.parse(currencyRates);
        }
    }
    return fetch('https://open.er-api.com/v6/latest/USD')
        .then(res => res.json())
        .then(async data => {
            if (redisClient) {
                await redisClient.set(`currency_rates`, JSON.stringify(data.rates), 'EX', 86400); // Cache for 1 day
            }
            return data.rates;
        }).catch(err => {
            console.error('Error fetching currency rates:', err);
            return null;
        });
}

 export function convertAmount(amount, fromCurrency, toCurrency, currencyRates) {
    if (fromCurrency === toCurrency) return amount;
    const fromRate = currencyRates[fromCurrency];
    const toRate = currencyRates[toCurrency];
    if (!fromRate || !toRate) {
        return 0;
    }
    const usdAmount = amount / fromRate; // Convert to USD first
    return usdAmount * toRate; // Then convert to target currency
}