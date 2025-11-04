// import_visa_data.js
import { existsSync, readFileSync, createReadStream, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import csv from 'csv-parser'


// Create a helper to get country ID
function getCountryId(db, iso2) {
    const result = db.exec(`SELECT id FROM countries WHERE iso2 = ?`, [iso2]);
    if (result.length && result[0].values.length) {
        return result[0].values[0][0];
    }
    return null;
}

async function importVisaRequirements() {
    const SQL = await initSqlJs();
    const dbPath = `${process.cwd()}/vacation_planner.db`;

    let db;
    if (existsSync(dbPath)) {
        const buffer = readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`DROP TABLE IF EXISTS visa_requirements`);
     db.run(`
        CREATE TABLE IF NOT EXISTS visa_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_country_id INTEGER NOT NULL,
    destination_country_id INTEGER NOT NULL,
    requirement TEXT NOT NULL,
    UNIQUE(origin_country_id, destination_country_id),
    FOREIGN KEY (origin_country_id) REFERENCES countries(id) ON DELETE CASCADE,
    FOREIGN KEY (destination_country_id) REFERENCES countries(id) ON DELETE CASCADE
)`)

    // Import CSV
    const visaData = [];

    await new Promise((resolve, reject) => {
        createReadStream(`${process.cwd()}/json/visa_requirements.csv`)
            .pipe(csv())
            .on('data', (row) => {
                const originId = getCountryId(db, row.Passport);
                const destId = getCountryId(db, row.Destination);

                if (originId && destId) {
                    visaData.push({
                        origin_country_id: originId,
                        destination_country_id: destId,
                        requirement: row.Requirement
                    });
                } 
            })
            .on('end', resolve)
            .on('error', reject);
    });

    console.log(`Importing ${visaData.length} visa requirements...`);

    for (let i = 0; i < visaData.length; i++) {
        const row = visaData[i];
        db.run(
            `INSERT OR REPLACE INTO visa_requirements (origin_country_id, destination_country_id, requirement) 
             VALUES (?, ?, ?)`,
            [row.origin_country_id, row.destination_country_id, row.requirement]
        );

        if ((i + 1) % 10000 === 0) {
            console.log(`Imported ${i + 1}/${visaData.length}`);
        }
    }

    writeFileSync(dbPath, Buffer.from(db.export()));
    console.log('Import complete!');
}

importVisaRequirements().catch(console.error)