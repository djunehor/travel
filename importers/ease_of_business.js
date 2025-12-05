import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
import fs from 'fs';
import { initDatabase, saveDatabase } from '../helpers/database.js';

async function launchBrowser() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    return { browser, page };
}

const url = 'https://en.wikipedia.org/wiki/Ease_of_doing_business_index';

async function insertEaseOfBusinessData(jsonPath) {
    const db = await initDatabase();
    db.run('DROP TABLE IF EXISTS ease_of_business');
    db.run(`
        CREATE TABLE ease_of_business (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            country_id INTEGER NOT NULL,
            ease_index REAL,
            normalized_ease_index REAL,
            FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
        )
    `);


    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    // Find min and max ease index
    const easeIndices = data.map(entry => parseFloat(entry['score'] || entry['2020'])).filter(v => !isNaN(v));
    const minEase = Math.min(...easeIndices);
    const maxEase = Math.max(...easeIndices);

    const countryStmt = db.prepare('SELECT id FROM countries WHERE name LIKE ?');
    const insertStmt = db.prepare('INSERT INTO ease_of_business (country_id, ease_index, normalized_ease_index) VALUES (?, ?, ?)');

    let inserted = 0;
    for (const entry of data) {
        const countryName = entry['Country'];
        const originalEaseIndex = parseFloat(isNaN(entry['score']) ? entry['2020'] : entry['score']);
  
        let normalizedEaseIndex = null;
        if (!isNaN(originalEaseIndex) && maxEase > minEase) {
            normalizedEaseIndex = ((originalEaseIndex - minEase) / (maxEase - minEase)) * 100;
        }
        countryStmt.bind([countryName]);
        let countryId = null;
        while (countryStmt.step()) {
            countryId = countryStmt.get()[0];
        }
        countryStmt.reset();
        if (countryId && !isNaN(originalEaseIndex) && normalizedEaseIndex !== null) {
            insertStmt.run([countryId, originalEaseIndex, normalizedEaseIndex]);
            inserted++;
        } else {
            console.warn(`Country not found or invalid ease index: ${countryName}`);
        }
    }
    insertStmt.free();
    countryStmt.free();
    saveDatabase(db);
    console.log(`Inserted ${inserted} ease_of_business records.`);
}

async function extractThirdTableToJson() {
    const jsonPath = 'ease_of_business_table.json';
    if (fs.existsSync(jsonPath)) {
        console.log(`${jsonPath} already exists. Skipping scrape.`);
        await insertEaseOfBusinessData(jsonPath);
        return;
    }
    const l = await launchBrowser();
    const browser = l.browser;
    const page = l.page;

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    console.log(new Date().toLocaleString(), `Navigating to Wikipedia: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30 * 1000 });

    // Extract the third table and map to JSON
    const tableData = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        if (tables.length < 3) return null;
        const table = tables[2]; // third table (0-based)
        const headers = Array.from(table.querySelectorAll('tr th')).map(th => th.innerText.trim());
        const rows = Array.from(table.querySelectorAll('tr')).slice(1); // skip header row
        const data = rows.map(row => {
            const cells = Array.from(row.children);
            if (cells.length === 0) return null;
            const obj = {};
      
            cells.forEach((cell, i) => {
                obj[i === 14 ? 'score' : (headers[i] ? headers[i] === 'Jurisdiction' ? 'Country' : headers[i] : `col${i+1}`)] = cell.innerText.trim();
            });
            return obj;
        }).filter(Boolean);
        return data;
    });

    if (tableData) {
        fs.writeFileSync(jsonPath, JSON.stringify(tableData, null, 2), 'utf-8');
        console.log('Third table extracted and saved to ease_of_business_table.json');
        await insertEaseOfBusinessData(jsonPath);
    } else {
        console.log('Could not find the third table on the page.');
    }

    await browser.close();
}

extractThirdTableToJson();
