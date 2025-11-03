const puppeteer = require('puppeteer-extra')
const { getRedisClient } = require('../helpers');

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')
puppeteer.use(AdblockerPlugin({ blockTrackers: true }))

const anonymizeUA = require('puppeteer-extra-plugin-anonymize-ua')
puppeteer.use(anonymizeUA())
const fs = require('fs');


async function launchBrowser() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()

    return { browser, page };
}

// --- Interaction Helpers ---
async function closeCookieBanner(page) {
    const selector = '#acceptCookieButton';
    try {
        const el = await page.$(selector);
        if (el) {
            await el.click();
            console.log(new Date().toLocaleString(), '✅ Accepted cookies');
        }
    } catch (e) { }
}

async function closeLoginModal(page) {
    const selector = '#login-modal button[aria-label="Close modal"]';
    try {
        const el = await page.$(selector);
        if (el) {
            await el.click();
            console.log(new Date().toLocaleString(), '✅ Closed login modal');
        }
    } catch (e) { }
}

async function handleCaptchaLoop(page, originalUrl) {
    const selector = '#px-captcha';

    while (true) {
        // Check if captcha exists - this is the ONLY reliable test
        const captchaDiv = await page.$(selector);

        if (!captchaDiv) {
            const currentUrl = new URL(page.url()).origin + new URL(page.url()).pathname;
            const originalUrlBase = new URL(originalUrl).origin + new URL(originalUrl).pathname;

            if (currentUrl !== originalUrlBase) {
                console.log(new Date().toLocaleString(), '🔄 Returning to original URL after captcha');
                await page.goto(originalUrl, { waitUntil: 'networkidle2' });
                await closeCookieBanner(page);
                continue;
            }
            console.log(new Date().toLocaleString(), '✅ No captcha detected, proceeding...');
            break;
        }

        console.log(new Date().toLocaleString(), '⚠️ Captcha detected, pressing and holding...');

        try {
            // Get captcha element position
            const bounds = await page.evaluate(sel => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                return {
                    centerX: rect.left + rect.width / 2,
                    centerY: rect.top + rect.height / 2,
                    width: rect.width,
                    height: rect.height
                };
            }, selector);

            if (!bounds) {
                console.log(new Date().toLocaleString(), '⚠️ Could not get captcha bounds');
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            const { centerX, centerY, width, height } = bounds;

            // Generate random offset (±30% of width/height, max ±24px)
            function randomOffset(size) {
                const max = Math.min(size * 0.3, 24);
                return (Math.random() - 0.5) * 2 * max;
            }
            const noisyX = centerX + randomOffset(width);
            const noisyY = centerY + randomOffset(height);

            await page.mouse.move(noisyX, noisyY);
            await page.mouse.down({ clickCount: 1 });

            // Wait indefinitely for captcha to disappear
            try {
                await page.waitForSelector(selector, { hidden: true, timeout: 0 });
                console.log(new Date().toLocaleString(), '✅ Captcha cleared');
            } catch (err) {
                console.warn('⚠️ Error waiting for captcha to disappear:', err.message);
            }

            await page.mouse.up();
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (err) {
            console.error('❌ Error handling captcha:', err.message);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

async function waitForFlightResults(page, selector = 'ul[class*="FlightsResults_dayViewItems"] li div[class*="FlightsTicket_container"]', timeout = 30000) {
    const start = Date.now();
    const captchaSelector = '#px-captcha';

    while (Date.now() - start < timeout) {
        // Only call handleCaptchaLoop if captcha actually exists
        const captchaExists = await page.$(captchaSelector);
        if (captchaExists) {
            await handleCaptchaLoop(page, page.url());
        }

        await closeCookieBanner(page);

        const flightExists = await page.$(selector);
        if (flightExists) {
            console.log(new Date().toLocaleString(), '✅ Flight results found!');
            return true;
        }
    }
    return false;
}

// --- Main Scraper ---
async function scrapeFlights({
    departureAirport,
    destinationAirport,
    timeframe = '1-month',
    duration = '5-7-days',
    adults = 1,
    children = 0
} = {}) {

    const departureDate = getDateRange(timeframe);
    const durationDays = getDurationDays(duration);
    const returnDate = new Date(departureDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const [year, month, day] = formatDate(departureDate).split('-');
    const [year2, month2, day2] = formatDate(returnDate).split('-');

    const departureDateStr = `${year.substr(-2)}${month}${day}`;
    const returnDateStr = `${year2.substr(-2)}${month2}${day2}`;

    const url = `https://www.skyscanner.com/transport/flights/${departureAirport}/${destinationAirport}/${departureDateStr}/${returnDateStr}/?adultsv2=${adults}&cabinclass=economy${children > 0 ? `&childrenv2=${children}` : ''}&ref=home&rtn=1&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false&currency=USD`;

    // Check cache first
    const redisClient = getRedisClient();

    try {
        const cached = await redisClient.get(url);
        if (cached) {
            console.log(new Date().toLocaleString(), '✅ Returning cached flight data');
            return JSON.parse(cached);
        }
    } catch (err) {
        console.warn('⚠️ Redis get error:', err.message);
    }


    let browser;
    let page;

    try {
        // Properly capture browser and page
        const response = await launchBrowser();
        browser = response.browser;
        page = response.page;

        console.log(new Date().toLocaleString(), `Navigating to Skyscanner: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30 * 1000 });

        await Promise.race([
            closeCookieBanner(page),
            handleCaptchaLoop(page, page.url()),
            closeLoginModal(page),
        ]);

        try {
            const [output, _] = await Promise.race([
                waitForFlightResults(page),
                page.waitForSelector('div[id="not-found-root"]', { timeout: 30 * 1000 })
            ]);
            console.log(new Date().toLocaleString(), output ? '✅ Flight results loaded' : '⚠️ No flights found');
        } catch (e) {
            console.log(new Date().toLocaleString(), '⚠️ Timeout waiting for flight results');

            // fs.writeFileSync(`${process.cwd()}/html/flights_error_${Date.now()}.html`, await page.content());
            // take screenshot for debugging
            // await page.screenshot({ path: `${process.cwd()}/screenshots/flights_${Date.now()}.png`, fullPage: true });
        };

        // Extract flight data
        const flightData = await page.evaluate(() => {
            const result = document.querySelector('ul[class*="FlightsResults_dayViewItems"] li div[class*="FlightsTicket_container"]');
            if (!result) return null;

            const priceElement = result.querySelector('div[class*="TicketStubPrice_priceWrapper"]');
            const durationElement = result.querySelector('div[class*="LegInfo_legInfo"] div[class*="Stops_stopsContainer"] span[class*="BpkText_bpk-text"]');
            const airlineElement = result.querySelector('div[class*="LogoImage_container"] span[class*="LogoImage_label"]');
            const layoverElement = result.querySelector('div[class*="LegInfo_legInfo"] div[class*="Stops_stopsLabelContainer"] span');

            return {
                url: result.querySelector('a') ? result.querySelector('a').href : null,
                price: priceElement ? priceElement.innerText?.trim().split('\n').pop()?.replace(/[^0-9]/g, '') : null,
                airline: airlineElement ? airlineElement.innerText.trim() : null,
                duration: durationElement ? durationElement.innerText.trim().replace(/[^\d]+/g, ' ').trim().split(' ').join(':') : null,
                layovers: layoverElement ? layoverElement.innerText.trim().replace(/[^0-9]/g, '') || 0 : null
            };
        });

        const output = {
            ...flightData,
            departureDate: `${year}-${month}-${day}`,
            returnDate: `${year2}-${month2}-${day2}`
        };

        // Cache the result for 24 hours
        if (output.price) {
            try {
                await redisClient.setex(url, 86400 * 3, JSON.stringify(output));
                console.log(new Date().toLocaleString(), '✅ Cached flight data for 24 hours');
            } catch (err) {
                console.warn('⚠️ Redis set error:', err.message);
            }
        }

        return output;

    } catch (error) {
        console.error('❌ Error scraping flights:', error);
        return null;
    } finally {
        if (browser) {
            await browser.close();
            console.log(new Date().toLocaleString(), '🔒 Browser closed');
        }
    }
}

module.exports = scrapeFlights;