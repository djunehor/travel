
// Database
import initSqlJs from 'sql.js';
import fs from 'node:fs';

const dbPath = `${process.cwd()}/vacation_planner.db`;

export async function initDatabase() {
    const SQL = await initSqlJs();
    let db;

    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    return db;
}

export function setupDabatase(db) {

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

    db.run(`
        CREATE TABLE IF NOT EXISTS task_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        )
    `);

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

    db.run(`
CREATE TABLE IF NOT EXISTS destination_visa_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destination_country_id INTEGER NOT NULL,
    condition_type TEXT NOT NULL,
    condition_value TEXT NOT NULL,
    resulting_requirement TEXT NOT NULL,
    notes TEXT,
    FOREIGN KEY (destination_country_id) REFERENCES countries(id) ON DELETE CASCADE
);
    `)

    db.run(`
    CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(country_id);
    CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(iata);
CREATE INDEX IF NOT EXISTS idx_visa_origin ON visa_requirements(origin_country_id);
CREATE INDEX IF NOT EXISTS idx_visa_destination ON visa_requirements(destination_country_id);
CREATE INDEX IF NOT EXISTS idx_destination_policies ON destination_visa_policies(destination_country_id, condition_type, condition_value);
`);

    saveDatabase(db);

}

export function saveDatabase(db) {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
}
