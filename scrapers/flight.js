const { connect } = require('puppeteer-real-browser');
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');


// Use puppeteer-real-browser's connect for realistic browser automation

// --- Helper Functions ---
function getDateRange(timeframe) {
    const now = new Date();
    if (timeframe === 'next_week') now.setDate(now.getDate() + 7);
    else if (timeframe === 'tomorrow') now.setDate(now.getDate() + 1);
    else if (typeof timeframe === 'number') now.setDate(now.getDate() + timeframe);
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
    // Use connect() from puppeteer-real-browser
    return await connect({
    headless: false,

    args: [],

    customConfig: {},

    turnstile: true,

    connectOption: {},

    disableXvfb: false,
    ignoreAllFlags: false,
    // proxy:{
    //     host:'<proxy-host>',
    //     port:'<proxy-port>',
    //     username:'<proxy-username>',
    //     password:'<proxy-password>'
    // }
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

            await Promise.resolve(setTimeout(() => { }, 1000));
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

            await Promise.resolve(setTimeout(() => { }, 1000));
        }
    } catch (e) { }
}

async function handleCaptchaLoop(page, originalUrl) {
    const selector = '#px-captcha';
    while (true) {
        const currentUrl = page.url();
        const captchaDiv = await page.$(selector);
        const captchaDetected = currentUrl.includes('captcha') || captchaDiv;

        if (!captchaDetected) {
            if (currentUrl !== originalUrl) {
                console.log('🔄 Returning to original URL after captcha');
                await page.goto(originalUrl, { waitUntil: 'networkidle2' });
                await closeCookieBanner(page);
                continue;
            }
            break; // stable on original URL
        }

        console.log('⚠️ Captcha detected, pressing and holding...');
        // Add random noise to the click position
        const { centerX, centerY, width, height } = await page.evaluate(sel => {
            const el = document.querySelector(sel);
            const rect = el.getBoundingClientRect();
            return {
                centerX: rect.left + rect.width / 2,
                centerY: rect.top + rect.height / 2,
                width: rect.width,
                height: rect.height
            };
        }, selector);


        // Generate larger random offset (±30% of width/height, max ±24px)
        function randomOffset(size) {
            const max = Math.min(size * 0.3, 24);
            return (Math.random() - 0.5) * 2 * max;
        }
        const noisyX = centerX + randomOffset(width);
        const noisyY = centerY + randomOffset(height);

        await page.mouse.move(noisyX, noisyY);
        await page.mouse.down({ clickCount: 1 });
        try {
            await page.waitForSelector(selector, { hidden: true, timeout: 0 });
            console.log('✅ Captcha cleared');
        } catch (err) {
            console.warn('⚠️ Captcha did not disappear', err);
        }
        await page.mouse.up();

        await Promise.resolve(setTimeout(() => { }, 1000));
    }
}

async function waitForFlightResults(page, selector = 'ul[class*="FlightsResults_dayViewItems"] li div[class*="FlightsTicket_container"]', timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        await handleCaptchaLoop(page, page.url());
        await closeCookieBanner(page);

        const flightExists = await page.$(selector);
        if (flightExists) return true;

        await Promise.resolve(setTimeout(() => { }, 1000));
    }
    return false;
}

// --- Main Scraper ---
async function scrapeSkyscanner({
    departureAirport = 'BER',
    destinationAirport = 'BCN',
    timeframe = 'next_week',
    duration = '7d',
    adults = 1,
    children = 0
} = {}) {
    let browser;
    try {
        const departureDate = getDateRange(timeframe);
        const durationDays = getDurationDays(duration);
        const returnDate = new Date(departureDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const [year, month, day] = formatDate(departureDate).split('-');
        const [year2, month2, day2] = formatDate(returnDate).split('-');

        const departureDateStr = `${year.substr(-2)}${month}${day}`;
        const returnDateStr = `${year2.substr(-2)}${month2}${day2}`;

        const url = `https://www.skyscanner.de/transport/flights/${departureAirport}/${destinationAirport}/${departureDateStr}/${returnDateStr}/?adultsv2=${adults}&cabinclass=economy&childrenv2=${children}&ref=home&rtn=1&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false`;


        // Use connect() to get page and browser
        const { page } = await launchBrowser();

        // const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        // await page.setUserAgent(userAgent.toString());

        console.log(`Navigating to Skyscanner: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        await closeCookieBanner(page);
        await handleCaptchaLoop(page, url);
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

        console.log('✅ Flight Data:', output);
        return output;

    } catch (error) {
        console.error('❌ Error scraping flights:', error);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// --- Run standalone ---
if (require.main === module) {
    scrapeSkyscanner({
        departureAirport: 'BER',
        destinationAirport: 'BCN',
        timeframe: 'next_week',
        duration: '5d',
        adults: 1,
        children: 0
    });
}

module.exports = scrapeSkyscanner;
