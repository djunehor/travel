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

async function closeCookieBanner(page) {
    const selector = '#onetrust-accept-btn-handler';
    try {
        const el = await page.$(selector);
        if (el) {
            await el.click();
            console.log(new Date().toLocaleString(), '✅ Accepted Booking.com cookies');
            await new Promise(resolve => setTimeout(resolve, 1000)); // wait for any potential navigation
        }
    } catch (e) { }
}

// --- Main Scraper ---
async function scrapeAccommodation(destination, checkInStr, checkOutStr, budget, adults, children) {

    let browser;
    let page;
    try {
        const durationDays = (new Date(checkOutStr) - new Date(checkInStr)) / (1000 * 60 * 60 * 24);
        console.log(new Date().toLocaleString(), `🏨 Scraping accommodation in ${destination} from ${checkInStr} to ${checkOutStr} for budget $${budget}`, durationDays);
        const maxPricePerNight = Math.round(budget / durationDays);
        console.log(new Date().toLocaleString(), `💰 Max price per night: $${maxPricePerNight.toFixed(2)}`);

        const url = `https://www.booking.com?checkin=${checkInStr}&checkout=${checkOutStr}&group_adults=${adults}&group_children=${children}&age=12&no_rooms=1&selected_currency=USD&order=price&nflt=price%3DUSD-min-${maxPricePerNight}-1`;

        // Check cache first
        const redisClient = getRedisClient();
        if (redisClient) {
            try {
                const cached = await redisClient.get(url);
                if (cached) {
                    console.log(new Date().toLocaleString(), '✅ Returning cached accommodation data');
                    return JSON.parse(cached);
                }
            } catch (err) {
                console.warn('⚠️ Redis get error:', err.message);
            }
        }
        const l = await launchBrowser();
        browser = l.browser;
        page = l.page;

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        );
        await page.setViewport({ width: 1280, height: 800 });


        console.log(new Date().toLocaleString(), `Navigating to Booking.com: ${url}`);
        await page.goto(`${url}&chal_t=${Date.now()}`, { waitUntil: 'networkidle2', timeout: 60 * 1000 });

        await closeCookieBanner(page);

        try {
            await page.waitForSelector('button[aria-label="Dismiss sign-in info."]', { timeout: 5000 });
        } catch (e) {
            console.log(new Date().toLocaleString(), 'No sign-in info banner to dismiss');
        }

        await page.evaluate(() => window.scrollBy(0, window.innerHeight));

        await page.evaluate(() => {
            const dismissBtn = document.querySelector('button[aria-label="Dismiss sign-in info."]');
            if (dismissBtn) dismissBtn.click();
        });
        // type destination in input field input[name="ss"]
        await page.type('input[name="ss"]', destination, { delay: 100 });
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120 * 1000 });

        // Wait for property card
        try {
            const [output, _] = await Promise.all([
                page.waitForSelector('div[data-testid="property-card"]', { timeout: 120 * 1000 }),
                page.waitForSelector('div[data-testid="properties-list-empty-state"]', { timeout: 120 * 1000 })
            ]);
            console.log(new Date().toLocaleString(), output ? '✅ Accommodation results loaded' : '⚠️ No accommodation found');
        } catch (e) {
            console.log(new Date().toLocaleString(), '⚠️ Timeout waiting for accommodation results');
            fs.writeFileSync(`${process.cwd()}/html/accommodation_error_${Date.now()}.html`, await page.content());
            // take screenshot for debugging
            await page.screenshot({ path: `${process.cwd()}/screenshots/accommodation_${Date.now()}.png`, fullPage: true });
        };

        // Extract accommodation information
        const hotelData = await page.evaluate(() => {
            const propertyElement = document.querySelector('div[data-testid="property-card"]');
            if (!propertyElement) return null;

            return {
                url: propertyElement.querySelector('a') ? propertyElement.querySelector('a').href : null,
                name: propertyElement.querySelector('div[data-testid="title"]')?.innerText.trim() || null,
                rating: propertyElement.querySelector('div[data-testid="review-score"] div')?.textContent.trim().split(' ')[1] || null,
                price: propertyElement.querySelector('span[data-testid="price-and-discounted-price"]')?.textContent.trim() || null,
                reviews: propertyElement.querySelectorAll('div[data-testid="review-score"] div')?.[2]?.querySelectorAll('div')?.[1]?.textContent?.trim().split(' ')[0] || null,
                perks: propertyElement.querySelectorAll('div[data-testid="recommended-units"] li') ? Array.from(propertyElement.querySelectorAll('div[data-testid="recommended-units"] li')).map(li => li.textContent).join(', ') : [],
                address: propertyElement.querySelector('span[data-testid="address"]')?.textContent.trim() || null
            };
        });

        const result = {
            ...hotelData,
            pricePerNight: hotelData?.price ? parseFloat(parseInt(hotelData.price.replace(/[^0-9]/g, '')) / durationDays).toFixed(2) : null,
            from: checkInStr,
            to: checkOutStr
        };

        // Cache the result for 24 hours
        if (redisClient && result.price) {
            try {
                await redisClient.setex(url, 86400, JSON.stringify(result));
                console.log(new Date().toLocaleString(), '✅ Cached accommodation data for 24 hours');
            } catch (err) {
                console.warn('⚠️ Redis set error:', err.message);
            }
        }

        return result;

    } catch (error) {
        console.error('Error scraping accommodation:', error);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = scrapeAccommodation;
