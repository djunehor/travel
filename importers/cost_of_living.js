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

const url = 'https://www.numbeo.com/cost-of-living/rankings_by_country.jsp';

async function insertCostOfLivingData(jsonPath) {
    const db = await initDatabase();
    db.run('DROP TABLE IF EXISTS cost_of_living');
    db.run(`
        CREATE TABLE cost_of_living (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            country_id INTEGER NOT NULL,
            cost_index REAL,
            normalized_cost_index REAL,
            FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
        )
    `);

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    // Find min and max cost index
    const costIndices = data.map(entry => parseFloat(entry['score'] || entry['Cost of Living Index'] || entry['cost_index'])).filter(v => !isNaN(v));
    const minCost = Math.min(...costIndices);
    const maxCost = Math.max(...costIndices);

    const countryStmt = db.prepare('SELECT id FROM countries WHERE name LIKE ?');
    const insertStmt = db.prepare('INSERT INTO cost_of_living (country_id, cost_index, normalized_cost_index) VALUES (?, ?, ?)');

    let inserted = 0;
    for (const entry of data) {
        const countryName = entry['Country'] || entry['country'] || entry[Object.keys(entry)[0]];
        const originalCostIndex = parseFloat(entry['score'] || entry['Cost of Living Index'] || entry['cost_index']);
        let normalizedCostIndex = null;
        if (!isNaN(originalCostIndex) && maxCost > minCost) {
            normalizedCostIndex = ((originalCostIndex - minCost) / (maxCost - minCost)) * 100;
        }
        countryStmt.bind([countryName]);
        let countryId = null;
        while (countryStmt.step()) {
            countryId = countryStmt.get()[0];
        }
        countryStmt.reset();
        if (countryId && !isNaN(originalCostIndex) && normalizedCostIndex !== null) {
            insertStmt.run([countryId, originalCostIndex, normalizedCostIndex]);
            inserted++;
        } else {
            console.warn(`Country not found or invalid cost index: ${countryName}`);
        }
    }
    insertStmt.free();
    countryStmt.free();
    saveDatabase(db);
    console.log(`Inserted ${inserted} cost_of_living records.`);
}

async function extractSecondTableToJson() {
    const jsonPath = 'cost_of_living_table.json';
    if (fs.existsSync(jsonPath)) {
        console.log(`${jsonPath} already exists. Skipping scrape.`);
        await insertCostOfLivingData(jsonPath);
        return;
    }
    const l = await launchBrowser();
    const browser = l.browser;
    const page = l.page;

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    console.log(new Date().toLocaleString(), `Navigating to Numbeo: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30 * 1000 });

    const tableData = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        if (tables.length < 2) return null;
        const table = tables[1];
        const headers = Array.from(table.querySelectorAll('tr th')).map(th => th.innerText.trim());
        const rows = Array.from(table.querySelectorAll('tr')).slice(1);
        const data = rows.map(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length === 0) return null;
            const obj = {};
            cells.forEach((cell, i) => {
                obj[i === 2 ? 'score' : (headers[i] || `col${i+1}`)] = cell.innerText.trim();
            });
            return obj;
        }).filter(Boolean);
        return data;
    });

    if (tableData) {
        fs.writeFileSync(jsonPath, JSON.stringify(tableData, null, 2), 'utf-8');
        console.log('Second table extracted and saved to cost_of_living_table.json');
        await insertCostOfLivingData(jsonPath);
    } else {
        console.log('Could not find the second table on the page.');
    }

    await browser.close();
}

extractSecondTableToJson();