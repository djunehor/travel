
import initSqlJs from 'sql.js';
import fs from 'node:fs';

function getCountryId(db, iso2) {
    const result = db.exec(`SELECT id FROM countries WHERE iso2 = ?`, [iso2]);
    if (result.length && result[0].values.length) {
        return result[0].values[0][0];
    }
    return null;
}


async function importAirports() {
    const SQL = await initSqlJs();
    const dbPath = `${process.cwd()}/vacation_planner.db`;

    let db;
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`DROP TABLE IF EXISTS airports`);
    db.run(`
          CREATE TABLE IF NOT EXISTS airports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
    country_id INTEGER NOT NULL,
    name TEXT NOT NULL,
        region TEXT NOT NULL,
        iata TEXT NOT NULL,
            icao TEXT NOT NULL,
    UNIQUE(country_id, iata),
    FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
        )
    `);

    const airportCodes = JSON.parse(fs.readFileSync('./json/country_airports.json'));

    for (const airport of airportCodes) {
        const countryId = getCountryId(db, airport.country_code)

        try {
            db.run(
                `INSERT OR REPLACE INTO airports 
             (country_id, name, region, iata, icao) 
             VALUES (?, ?, ?, ?, ?)`,
                [countryId, airport.airport, airport.region_name, airport.iata, airport.icao]
            );
        } catch { }
    }

    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`Imported ${airportCodes.length} airports`);
}

importAirports().catch(console.error)