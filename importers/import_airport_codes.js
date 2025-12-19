
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

    /**
     *  {
        "icao": "EDDF",
        "iata": "FRA",
        "name": "Frankfurt am Main International Airport",
        "city": "Frankfurt-am-Main",
        "state": "Hesse",
        "country": "DE",
        "elevation": 364,
        "lat": 50.0264015198,
        "lon": 8.543129921,
        "tz": "Europe/Berlin"
    },
     */

    db.run(`DROP TABLE IF EXISTS airports`);
    db.run(`
        CREATE TABLE IF NOT EXISTS airports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        region TEXT NOT NULL,
        iata TEXT NOT NULL,
        icao TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        elevation INTEGER,
        tz TEXT,
        UNIQUE(country_id, iata),
        FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
        )
    `);

    // we fetch the airportCodes from https://raw.githubusercontent.com/mwgg/Airports/refs/heads/master/airports.json
    const request = await fetch('https://raw.githubusercontent.com/mwgg/Airports/refs/heads/master/airports.json');
    const airportData = await request.json();
    const airportCodes = Object.values(airportData);

    for (const airport of airportCodes) {
        const countryId = getCountryId(db, airport.country)

        if(!countryId) {
            continue;
        }

        if(!airport.iata || airport.iata.length !== 3) {
            continue;
        }
        
        try {
        db.run(
            `INSERT OR REPLACE INTO airports 
            (country_id, name, city, region, iata, icao, latitude, longitude, elevation, tz) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                countryId,
                airport.name,
                airport.city,
                airport.state || '', // region
                airport.iata,
                airport.icao,
                airport.lat,
                airport.lon,
                airport.elevation,
                airport.tz
            ]
        );
        } catch(e) { console.error('Error inserting airport:', airport, e) }
    }

    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`Imported ${airportCodes.length} airports`);
}

importAirports().catch((e) => {
    console.error(e);
    process.exit(1);
});