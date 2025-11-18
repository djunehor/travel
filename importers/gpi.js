import puppeteer from 'puppeteer-extra'

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteer.use(StealthPlugin())

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker'
puppeteer.use(AdblockerPlugin({ blockTrackers: true }))

import fs from 'fs'
async function launchBrowser() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    return { browser, page };
}

const url = 'https://en.wikipedia.org/wiki/Global_Peace_Index'


async function extractSecondTableToJson() {
    const l = await launchBrowser();
    const browser = l.browser;
    const page = l.page;

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    console.log(new Date().toLocaleString(), `Navigating to Wikipedia: ${url}`);
    await page.goto(`${url}`, { waitUntil: 'networkidle2', timeout: 30 * 1000 });

    // Extract the second table and map to JSON
    const tableData = await page.evaluate(() => {
        // Get all tables on the page
        const tables = Array.from(document.querySelectorAll('table'));
        if (tables.length < 2) return null;
        const table = tables[1]; // second table (0-based)
        const headers = Array.from(table.querySelectorAll('tr th')).map(th => th.innerText.trim());
        const rows = Array.from(table.querySelectorAll('tr')).slice(1); // skip header row
        const data = rows.map(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length === 0) return null;
            const obj = {};
            cells.forEach((cell, i) => {
                obj[headers[i] || `col${i+1}`] = cell.innerText.trim();
            });
            return obj;
        }).filter(Boolean);
        return data;
    });

    if (tableData) {
        fs.writeFileSync('gpi_table.json', JSON.stringify(tableData, null, 2), 'utf-8');
        console.log('Second table extracted and saved to gpi_table.json');
    } else {
        console.log('Could not find the second table on the page.');
    }

    await browser.close();
}

extractSecondTableToJson();