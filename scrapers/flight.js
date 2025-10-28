const puppeteer = require('puppeteer-extra')

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')
puppeteer.use(AdblockerPlugin({ blockTrackers: true }))

const anonymizeUA = require('puppeteer-extra-plugin-anonymize-ua')
puppeteer.use(anonymizeUA())

const Redis = require('ioredis');
const fs = require('fs');

// --- Redis Setup ---
let redis = null;

function getRedisClient() {
    if (!redis && process.env.REDIS_URL) {
        try {
            redis = new Redis(process.env.REDIS_URL, {
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    if (times > 3) return null;
                    return Math.min(times * 200, 1000);
                }
            });

            redis.on('error', (err) => {
                console.warn('⚠️ Redis connection error:', err.message);
                redis = null;
            });

            console.log(new Date().toLocaleString(), '✅ Redis client initialized');
        } catch (err) {
            console.warn('⚠️ Failed to initialize Redis:', err.message);
            redis = null;
        }
    }
    return redis;
}

// --- Helper Functions ---
function getDateRange(timeframe) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight

    // helper: clone + add days
    const addDays = (date, days) => {
        const d = new Date(date.getTime());
        d.setDate(d.getDate() + days);
        return d;
    };

    let target;

    if (typeof timeframe === 'number') {
        target = addDays(today, timeframe);
    } else {
        switch (timeframe) {
            case '1-month':        // within 1 month -> choose ~30 days from today
                target = addDays(today, 15);
                break;
            case '1-3-months':     // start of range -> ~30 days
                target = addDays(today, 45);
                break;
            case '3-6-months':     // start of range -> ~90 days
                target = addDays(today, 90);
                break;
            case '6-plus-months':  // start -> ~180 days
                target = addDays(today, 100);
                break;
            case 'next_week':
                target = addDays(today, 7);
                break;
            case 'tomorrow':
                target = addDays(today, 1);
                break;
            default:
                // fallback: tomorrow
                target = addDays(today, 1);
        }
    }

    // safety: if computed date is not in the future (edge cases), use tomorrow
    if (target <= today) {
        console.warn('⚠️ Calculated date is not in the future; using tomorrow instead');
        target = addDays(today, 1);
    }

    return target;
}

function getDurationDays(duration) {
    if (!duration || typeof duration !== 'string') return 7; // default 7 days

    duration = duration.toLowerCase();

    // Match "3-5-days" or "5-7-days"
    let dayMatch = duration.match(/(\d+)-(\d+)-days/);
    if (dayMatch) {
        const min = parseInt(dayMatch[1], 10);
        const max = parseInt(dayMatch[2], 10);
        return Math.round((min + max) / 2); // average
    }

    // Match "1-2-weeks" or "2-plus-weeks"
    let weekMatch = duration.match(/(\d+)(?:-(\d+)|\+)?-weeks/);
    if (weekMatch) {
        const minWeeks = parseInt(weekMatch[1], 10);
        const maxWeeks = weekMatch[2] ? parseInt(weekMatch[2], 10) : minWeeks + 1; // "plus" -> add 1 week
        return Math.round(((minWeeks + maxWeeks) / 2) * 7); // convert weeks → days
    }

    // If it's a single number with "d" suffix
    let singleDayMatch = duration.match(/(\d+)d/);
    if (singleDayMatch) return parseInt(singleDayMatch[1], 10);

    // fallback
    return 7;
}


function formatDate(date) {
    return date.toISOString().split('T')[0];
}

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
            await new Promise(resolve => setTimeout(resolve, 1000));
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
            await new Promise(resolve => setTimeout(resolve, 1000));
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

async function waitForFlightResults(page, selector = 'ul[class*="FlightsResults_dayViewItems"] li div[class*="FlightsTicket_container"]', timeout = 60000) {
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

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(new Date().toLocaleString(), '⚠️ Timeout waiting for flight results');
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

    const url = `https://www.skyscanner.de/transport/flights/${departureAirport}/${destinationAirport}/${departureDateStr}/${returnDateStr}/?adultsv2=${adults}&cabinclass=economy${children > 0 ? `&childrenv2=${children}` : ''}&ref=home&rtn=1&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false&currency=USD`;

    // Check cache first
    const redisClient = getRedisClient();
    if (redisClient) {
        try {
            const cached = await redisClient.get(url);
            if (cached) {
                console.log(new Date().toLocaleString(), '✅ Returning cached flight data');
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('⚠️ Redis get error:', err.message);
        }
    }

    let browser;
    let page;

    try {
        // Properly capture browser and page
        const response = await launchBrowser();
        browser = response.browser;
        page = response.page;

        console.log(new Date().toLocaleString(), `Navigating to Skyscanner: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        await closeCookieBanner(page);
        await handleCaptchaLoop(page, page.url());
        await closeLoginModal(page);

        try {
            await waitForFlightResults(page);
        } catch (e) {
            console.log(new Date().toLocaleString(), '⚠️ Timeout waiting for flight results');

            fs.writeFileSync(`${process.cwd()}/html/flights_error_${Date.now()}.html`, await page.content());
            // take screenshot for debugging
            await page.screenshot({ path: `${process.cwd()}/screenshots/flights_${Date.now()}.png`, fullPage: true });
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
        if (redisClient && output.price) {
            try {
                await redisClient.setex(url, 86400, JSON.stringify(output));
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