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
        CREATE TABLE countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  iso2 TEXT NOT NULL UNIQUE,
  iso3 TEXT NOT NULL UNIQUE,
  tld TEXT,                 -- Top-level domain
  capital TEXT,
  region TEXT,
  subregion TEXT,
  currencyCode TEXT,
  languageCode TEXT,
  latitude REAL,
  longitude REAL,
area REAL,               -- in square kilometers
flag TEXT, -- emoji flag

  -- Travel interest categories
  beach_relaxation BOOLEAN DEFAULT 0,
  adventure_nature BOOLEAN DEFAULT 0,
  culture_history BOOLEAN DEFAULT 0,
  shopping_nightlife BOOLEAN DEFAULT 0,
  food_culinary BOOLEAN DEFAULT 0,

  -- Quantitative global indicators
  hdi REAL,                -- Human Development Index (0-1)
  gpi REAL,                -- Global Peace Index
  gti REAL,                -- Global Terrorism Index
  ttdi REAL,               -- Travel & Tourism Development Index
  travel_advisory INTEGER, -- US State Department rating (1-4)
  avg_daily_cost REAL,     -- Average daily cost in USD
  visa_free_rank INTEGER,  -- Henley Passport Index / travel freedom score
  climate_score REAL,      -- Optional normalized climate comfort index (0-1)
  hospital_access REAL,    -- Optional metric for medical infrastructure (0-1)
  pollution_score REAL     -- Optional AQI or pollution index (0-1)
);

    `);

    const request = await fetch('https://raw.githubusercontent.com/mledoze/countries/refs/heads/master/countries.json')
    const countries = await request.json();
    

    for (const country of countries) {
        try {
            // Remove diacritics and special marks from country name
            let name = country.name.common.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z ]/g, '');
            db.run(
                `INSERT INTO countries (name, iso2, iso3, tld, capital, region, subregion, currencyCode, languageCode, latitude, longitude, area, flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, country.cca2, country.cca3, country.tld[0], country.capital[0] || null, country.region, country.subregion || null, Object.keys(country.currencies)[0] || null, Object.keys(country.languages)[0] || null, country.latlng[0], country.latlng[1], country.area, country.flag]
            );
        } catch (e) {
            console.error('Error inserting country:', country, e);
        }
    }

    writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`Imported ${countries.length} countries`);
}

importCountries().catch((e) => console.error(e));