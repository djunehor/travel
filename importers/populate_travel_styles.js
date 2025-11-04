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

    // Default: Give every country at least some attributes
    // You can refine this later with actual data
    const travelStyleMapping = {
        // Beach countries
        beach: ['MV', 'MU', 'SC', 'FJ', 'BS', 'BB', 'JM', 'TH', 'ID', 'MY', 'PH', 'VN', 'GR', 'ES', 'IT', 'HR', 'PT', 'CY', 'MT', 'TR', 'EG', 'TN', 'MA', 'MX', 'CR', 'PA', 'CU', 'DO', 'BR', 'AU', 'NZ', 'ZA'],
        
        // Adventure/Nature countries
        adventure: ['NP', 'NZ', 'IS', 'NO', 'CH', 'AT', 'CA', 'US', 'AR', 'CL', 'PE', 'BO', 'EC', 'CR', 'ZA', 'KE', 'TZ', 'UG', 'RW', 'BT', 'LK', 'TH', 'VN', 'ID', 'MY', 'AU', 'JP'],
        
        // Culture/History countries
        culture: ['IT', 'GR', 'EG', 'TR', 'FR', 'ES', 'GB', 'DE', 'AT', 'CZ', 'PL', 'RU', 'CN', 'JP', 'KR', 'IN', 'TH', 'VN', 'KH', 'MM', 'LA', 'IR', 'IQ', 'JO', 'IL', 'SA', 'AE', 'OM', 'MA', 'TN', 'MX', 'PE', 'BR'],
        
        // Shopping/Nightlife countries
        shopping: ['AE', 'SG', 'HK', 'JP', 'KR', 'TH', 'MY', 'GB', 'FR', 'IT', 'ES', 'DE', 'US', 'AU', 'TR', 'MX', 'BR'],
        
        // Food/Culinary countries
        food: ['IT', 'FR', 'ES', 'JP', 'TH', 'VN', 'CN', 'IN', 'TR', 'MX', 'PE', 'GR', 'PT', 'KR', 'MY', 'SG', 'ID', 'MA', 'LB', 'IL', 'BR', 'AR']
    };

    let updated = 0;
    
    for (const [iso2, name] of result[0].values) {
        const beach = travelStyleMapping.beach.includes(iso2) ? 1 : 0;
        const adventure = travelStyleMapping.adventure.includes(iso2) ? 1 : 0;
        const culture = travelStyleMapping.culture.includes(iso2) ? 1 : 0;
        const shopping = travelStyleMapping.shopping.includes(iso2) ? 1 : 0;
        const food = travelStyleMapping.food.includes(iso2) ? 1 : 0;
        
        // Give every country at least one attribute if they have none
        const hasAny = beach || adventure || culture || shopping || food;
        const defaultCulture = hasAny ? culture : 1; // Default to culture if no attributes
        
        db.run(
            `UPDATE countries 
             SET beach_relaxation = ?, 
                 adventure_nature = ?, 
                 culture_history = ?, 
                 shopping_nightlife = ?, 
                 food_culinary = ?
             WHERE iso2 = ?`,
            [beach, adventure, defaultCulture, shopping, food, iso2]
        );
        updated++;
    }

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
        console.log('\n📊 Travel Style Distribution:');
        console.log(`   Beach: ${beach} countries`);
        console.log(`   Adventure: ${adventure} countries`);
        console.log(`   Culture: ${culture} countries`);
        console.log(`   Shopping: ${shopping} countries`);
        console.log(`   Food: ${food} countries`);
    }
}

populateTravelStyles().catch(console.error);