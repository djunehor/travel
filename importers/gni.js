import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
import fs from 'fs';

async function launchBrowser() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    return { browser, page };
}

const url = 'https://en.wikipedia.org/wiki/List_of_countries_by_GNI_(PPP)_per_capita';

async function extractFirstTableToJson() {
    const l = await launchBrowser();
    const browser = l.browser;
    const page = l.page;

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    console.log(new Date().toLocaleString(), `Navigating to Wikipedia: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30 * 1000 });
    await page.screenshot({ path: 'gni_page.png', fullPage: true });

    // Extract the first table and map to JSON
    const tableData = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        if (tables.length < 1) return null;
        const table = tables[0]; // first table (0-based)
        const headers = Array.from(table.querySelectorAll('tr th')).map(th => th.innerText.trim());
        const rows = Array.from(table.querySelectorAll('tr')).slice(1); // skip header row
        const data = rows.map(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length === 0) return null;
            const obj = {};
            cells.forEach((cell, i) => {
                obj[i === 1 ? 'score' : (headers[i].split(' ')[0].trim() || `col${i+1}`)] = cell.innerText.trim();
            });
            return obj;
        }).filter(Boolean);
        return data;
    });

    if (tableData) {
        fs.writeFileSync('gni_table.json', JSON.stringify(tableData, null, 2), 'utf-8');
        console.log('First table extracted and saved to gni_table.json');
    } else {
        console.log('Could not find the first table on the page.');
    }

    await browser.close();
}

extractFirstTableToJson();
