import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

async function importCountries() {
    const SQL = await initSqlJs();
    const dbPath = `${process.cwd()}/vacation_planner.db`;
    
    let db;
    if (existsSync(dbPath)) {
        const buffer = readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }
    
    db.run(`DROP TABLE IF EXISTS countries`);
    db.run(`
        CREATE TABLE IF NOT EXISTS countries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            iso2 TEXT NOT NULL UNIQUE,
            beach_relaxation BOOLEAN DEFAULT 0,
            adventure_nature BOOLEAN DEFAULT 0,
            culture_history BOOLEAN DEFAULT 0,
            shopping_nightlife BOOLEAN DEFAULT 0,
            food_culinary BOOLEAN DEFAULT 0
        )
    `);
    
    // Sample data - you'll need to populate this fully
    const countries = JSON.parse(readFileSync('./json/countries.json'))
    
    for (const country of countries) {
        db.run(
            `INSERT OR REPLACE INTO countries 
             (name, iso2) 
             VALUES (?, ?)`,
            [country.name, country.code]
        );
    }
    
    writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`Imported ${countries.length} countries`);
}

importCountries().catch((e) => console.error(e));