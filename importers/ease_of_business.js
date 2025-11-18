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

const url = 'https://en.wikipedia.org/wiki/Ease_of_doing_business_index';

async function extractThirdTableToJson() {
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
        fs.writeFileSync('ease_of_business_table.json', JSON.stringify(tableData, null, 2), 'utf-8');
        console.log('Third table extracted and saved to ease_of_business_table.json');
    } else {
        console.log('Could not find the third table on the page.');
    }

    await browser.close();
}

extractThirdTableToJson();
