const { connect } = require('puppeteer-real-browser');
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

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

            console.log('✅ Redis client initialized');
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

    if (timeframe === 'next_week') {
        now.setDate(now.getDate() + 7);
    } else if (timeframe === 'tomorrow') {
        now.setDate(now.getDate() + 1);
    } else if (typeof timeframe === 'number') {
        now.setDate(now.getDate() + timeframe);
    } else {
        // Default: tomorrow if invalid timeframe
        now.setDate(now.getDate() + 1);
    }

    // Safety check: ensure date is in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (now <= today) {
        console.warn('⚠️ Calculated date is in the past, using tomorrow instead');
        now.setDate(today.getDate() + 1);
    }

    return now;
}

function getDurationDays(duration) {
    if (typeof duration === 'string' && duration.endsWith('d')) return parseInt(duration.replace('d', ''), 10);
    return Number(duration) || 7;
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

async function launchBrowser() {
    return await connect({
        headless: false,
        args: [],
        customConfig: {},
        turnstile: true,
        connectOption: {},
        disableXvfb: false,
        ignoreAllFlags: false,
    });
}

// --- Interaction Helpers ---
async function closeCookieBanner(page) {
    const selector = '#acceptCookieButton';
    try {
        const el = await page.$(selector);
        if (el) {
            await el.click();
            console.log('✅ Accepted cookies');
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
            console.log('✅ Closed login modal');
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
                console.log('🔄 Returning to original URL after captcha');
                await page.goto(originalUrl, { waitUntil: 'networkidle2' });
                await closeCookieBanner(page);
                continue;
            }
            console.log('✅ No captcha detected, proceeding...');
            break;
        }

        console.log('⚠️ Captcha detected, pressing and holding...');

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
                console.log('⚠️ Could not get captcha bounds');
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
                console.log('✅ Captcha cleared');
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
            console.log('✅ Flight results found!');
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('⚠️ Timeout waiting for flight results');
    return false;
}

// --- Main Scraper ---
async function scrapeFlights({
    departureAirport = 'BER',
    destinationAirport = 'BCN',
    timeframe = 'next_week',
    duration = '7d',
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

    const url = `https://www.skyscanner.de/transport/flights/${departureAirport}/${destinationAirport}/${departureDateStr}/${returnDateStr}/?adultsv2=${adults}&cabinclass=economy&childrenv2=${children}&ref=home&rtn=1&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false&currency=USD`;

    // Check cache first
    const redisClient = getRedisClient();
    if (redisClient) {
        try {
            const cached = await redisClient.get(url);
            if (cached) {
                console.log('✅ Returning cached flight data');
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

        console.log(`Navigating to Skyscanner: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        await closeCookieBanner(page);
        await handleCaptchaLoop(page, page.url());
        await closeLoginModal(page);

        const resultsLoaded = await waitForFlightResults(page);
        if (!resultsLoaded) {
            console.log('⚠️ Flight results did not load in time, taking screenshot');
            const dir = path.resolve('screenshots');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
            await page.screenshot({ path: `${dir}/skyscanner_${Date.now()}.png`, fullPage: true });
        }

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
                price: priceElement ? priceElement.innerText.trim().split('\n')[1].replace(/[^0-9]/g, '') : null,
                airline: airlineElement ? airlineElement.innerText.trim() : null,
                duration: durationElement ? durationElement.innerText.trim().replace(/[^\d]+/g, ' ').trim().split(' ').join(':') : null,
                layovers: layoverElement ? layoverElement.innerText.trim().replace(/[^0-9]/g, '') : null
            };
        });

        const output = {
            ...flightData,
            departureDate: `${year}-${month}-${day}`,
            returnDate: `${year2}-${month2}-${day2}`
        };

        // Cache the result for 24 hours
        if (redisClient && output) {
            try {
                await redisClient.setex(url, 86400, JSON.stringify(output));
                console.log('✅ Cached flight data for 24 hours');
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
            console.log('🔒 Browser closed');
        }
    }
}

module.exports = scrapeFlights;