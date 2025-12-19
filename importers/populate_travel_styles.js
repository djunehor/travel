import { existsSync, readFileSync, writeFileSync } from 'fs';
import initSqlJs from 'sql.js';

async function populateTravelStyles() {
    const SQL = await initSqlJs();
    const dbPath = `${process.cwd()}/vacation_planner.db`;

    if (!existsSync(dbPath)) {
        console.error('Database not found');
        return;
    }

    const buffer = readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    // Get all countries
    const result = db.exec(`SELECT iso2, name FROM countries`);
    
    if (!result.length || !result[0].values.length) {
        console.log('No countries found');
        return;
    }

    // --- REVISED TRAVEL STYLE MAPPING FOR ACCURACY ---
    const travelStyleMapping = {
        // High-Quality Beach & Relaxation Destinations
        beach: [
            'MV', 'MU', 'SC', 'FJ', 'BB', 'JM', 'TH', 'ID', 'MY', 'PH', 'VN', 'GR', 
            'ES', 'IT', 'HR', 'PT', 'CY', 'MT', 'TR', 'EG', 'TN', 'MA', 'MX', 'CR', 
            'PA', 'CU', 'DO', 'BR', 'AU', 'NZ', 'ZA', 'BS', 'CL', 'MO', 'KW', 'AE',
            'IL', 'BZ', 'GT', 'CO', 'EC', 'IN', 'SR', 'VN'
        ],
        
        // World-Class Adventure & Nature (Mountains, Safaris, Jungles, Geothermal)
        adventure: [
            'NP', 'NZ', 'IS', 'NO', 'CH', 'AT', 'CA', 'US', 'AR', 'CL', 'PE', 'BO', 
            'EC', 'CR', 'ZA', 'KE', 'TZ', 'UG', 'RW', 'BT', 'LK', 'VN', 'ID', 'MY', 
            'AU', 'JP', 'MG', 'MW', 'ET', 'CO', 'PY', 'MN', 'GL', 'FJ', 'MX', 'AR',
            'LK', 'GR', 'GE', 'AZ', 'AM', 'KG'
        ],
        
        // Deep Culture, Ancient History, and Iconic Architectural Hubs
        culture: [
            'IT', 'GR', 'EG', 'TR', 'FR', 'ES', 'GB', 'DE', 'AT', 'CZ', 'PL', 'RU', 
            'CN', 'JP', 'KR', 'IN', 'TH', 'VN', 'KH', 'MM', 'LA', 'IR', 'JO', 'IL', 
            'SA', 'MA', 'TN', 'MX', 'PE', 'BR', 'PT', 'IQ', 'GT', 'ID', 'AZ', 'GE',
            'AM', 'CU', 'PK'
        ],
        
        // Major Shopping Districts, Finance Hubs, and Nightlife Capitals
        shopping: [
            'AE', 'SG', 'HK', 'JP', 'KR', 'TH', 'MY', 'GB', 'FR', 'IT', 'ES', 'DE', 
            'US', 'AU', 'TR', 'MX', 'BR', 'CN', 'TW', 'NL', 'BE', 'PT', 'SE', 'DK',
            'FI', 'IE', 'CH', 'RU', 'CL'
        ],
        
        // Internationally Recognized Gastronomic Destinations
        food: [
            'IT', 'FR', 'ES', 'JP', 'TH', 'VN', 'CN', 'IN', 'TR', 'MX', 'PE', 'GR', 
            'PT', 'KR', 'MY', 'SG', 'ID', 'MA', 'LB', 'IL', 'BR', 'AR', 'CO', 'CL', 
            'BD', 'HK', 'TW', 'BE', 'NL', 'HU'
        ]
    };
    // -----------------------------------------------------------

    let updated = 0;
    const countries = result[0].values; // Array of [iso2, name]

    for (const [iso2, name] of countries) {
        // Normalize columns (replace '-' with '_')
        const beach = travelStyleMapping.beach.includes(iso2) ? 1 : 0;
        const adventure = travelStyleMapping.adventure.includes(iso2) ? 1 : 0;
        const culture = travelStyleMapping.culture.includes(iso2) ? 1 : 0;
        const shopping = travelStyleMapping.shopping.includes(iso2) ? 1 : 0;
        const food = travelStyleMapping.food.includes(iso2) ? 1 : 0;
        
        // Logic for ensuring every country has at least one attribute.
        // We ensure a country is marked as Culture if it has no other obvious global appeal.
        const hasAny = beach || adventure || culture || shopping || food;
        const finalCulture = hasAny ? culture : 1; 
        
        db.run(
            `UPDATE countries 
             SET beach_relaxation = ?, 
                 adventure_nature = ?, 
                 culture_history = ?, 
                 shopping_nightlife = ?, 
                 food_culinary = ?
             WHERE iso2 = ?`,
            [beach, adventure, finalCulture, shopping, food, iso2]
        );
        updated++;
    }
    
    // Save and log results
    writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`✅ Updated travel styles for ${updated} countries`);
    
    // Show some stats
    const stats = db.exec(`
        SELECT 
            SUM(beach_relaxation) as beach,
            SUM(adventure_nature) as adventure,
            SUM(culture_history) as culture,
            SUM(shopping_nightlife) as shopping,
            SUM(food_culinary) as food
        FROM countries
    `);
    
    if (stats.length && stats[0].values.length) {
        const [beach, adventure, culture, shopping, food] = stats[0].values[0];
        console.log('\n📊 Travel Style Distribution (Revised):');
        console.log(`   Beach: ${beach} countries`);
        console.log(`   Adventure: ${adventure} countries`);
        console.log(`   Culture: ${culture} countries`);
        console.log(`   Shopping: ${shopping} countries`);
        console.log(`   Food: ${food} countries`);
    }
}

populateTravelStyles().catch((e) => {
    console.error(e);
    process.exit(1);
});