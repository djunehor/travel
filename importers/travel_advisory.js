import fetch from 'node-fetch';
import fs from 'fs';

const url = 'https://cadataapi.state.gov/api/TravelAdvisories';

function extractLevelScore(title) {
    // Extracts the advisory level from the Title string
    // e.g., "Level 1: Exercise Normal Precautions" => 1
    const match = title.match(/Level (\d)/);
    return match ? parseInt(match[1], 10) : null;
}

async function fetchAndNormalizeTravelAdvisories() {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const advisories = await response.json();
        // advisories is an array
        const normalized = advisories
            .filter(entry => entry.Title && extractLevelScore(entry.Title))
            .map(entry => {
                // Country name is before the dash in Title
                const country = entry.Title.split(' - ')[0].trim();
                const score = extractLevelScore(entry.Title);
                return { country, score };
            });
        fs.writeFileSync('travel_advisories_normalized.json', JSON.stringify(normalized, null, 2), 'utf-8');
        console.log('Normalized advisories saved to travel_advisories_normalized.json');
    } catch (err) {
        console.error('Error fetching or normalizing travel advisories:', err);
    }
}

fetchAndNormalizeTravelAdvisories();
