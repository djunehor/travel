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
    const selector = '.accept.uc-accept-button';
    try {
        const el = await page.$(selector);
        if (el) {
            await el.click();
            console.log(new Date().toLocaleString(), '✅ Accepted GetYourGuide cookies');
        }
    } catch (e) { }
}

async function scrapeActivities(destination, checkInStr, checkOutStr, budget) {

    let browser;
    let page;
    try {
        const durationDays = (new Date(checkOutStr) - new Date(checkInStr)) / (1000 * 60 * 60 * 24);

        const maxPrice = Math.round(budget / durationDays);
        const minPrice = Math.min(1, Math.floor(maxPrice * 0.5));
        console.log(new Date().toLocaleString(), '🎟️ Scraping activities for:', destination, `Duration: ${durationDays} days`, { minPrice, maxPrice });
        const url = `https://www.getyourguide.com/s?q=${destination}&searchSource=3&src=search_bar&date_from=${checkInStr}&date_to=${checkOutStr}&price_range=${minPrice}-${maxPrice}&sort=price&order=asc`;

        // Check cache first
        const redisClient = getRedisClient();
        if (redisClient) {
            try {
                const cached = await redisClient.get(url);
                if (cached) {
                    console.log(new Date().toLocaleString(), '✅ Returning cached activities data');
                    return JSON.parse(cached);
                }
            } catch (err) {
                console.warn('⚠️ Redis get error:', err.message);
            }
        }

        const l = await launchBrowser();
        browser = l.browser;
        page = l.page;

        console.log(new Date().toLocaleString(), `Navigating to GetYourGuide: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30 * 1000 });

        await closeCookieBanner(page);

        const emptySelector = 'sector[id="no-results-block"]';
        // Wait for activity cards
        const activitySelector = 'section div[class="activity-card-block activity-card-block--grid"]';

        try {
            const [activitiesElement, _] = await Promise.race([
                page.waitForSelector(activitySelector, { timeout: 30 * 1000 }),
                page.waitForSelector(emptySelector, { timeout: 30 * 1000 })
            ]);
            console.log(new Date().toLocaleString(), activitiesElement ? '✅ Activity results loaded' : '⚠️ No activities found');
        } catch (e) {
            console.log(new Date().toLocaleString(), '⚠️ Timeout waiting for activity results');

            fs.writeFileSync(`${process.cwd()}/html/activies_error_${Date.now()}.html`, await page.content());
            // take screenshot for debugging
            await page.screenshot({ path: `${process.cwd()}/screenshots/activities_${Date.now()}.png`, fullPage: true });
        };


        // Extract activities
        const activitiesData = await page.evaluate(() => {
            const activities = [];
            const activityElements = document.querySelectorAll('section div[class="activity-card-block activity-card-block--grid"]');

            activityElements.forEach((el, index) => {
                if (index < 5) {
                    const titleElement = el.querySelector('h3[data-test-id="activity-card-title"]');
                    const priceElement = el.querySelector('span[class*="activity-price__text-price"]');
                    const priceUnitElement = el.querySelector('span[class*="activity-price__text-suffix"]');

                    if (titleElement) {
                        activities.push({
                            url: el.querySelector('a') ? el.querySelector('a').href : null,
                            name: titleElement?.textContent.trim(),
                            price: priceElement?.textContent.trim(),
                            priceUnit: priceUnitElement?.textContent.trim()
                        });
                    }
                }
            });

            return activities;
        });

        const activities = activitiesData.slice(0, 4);
        const totalPrice = activities.reduce((sum, activity) => {
            const price = parseInt(activity.price?.replace(/[^0-9]/g, '') || '0');
            return sum + (isNaN(price) ? 0 : price);
        }, 0);

        const result = {
            activities,
            totalPrice
        };

        // Cache the result for 24 hours
        if (redisClient && result.activities.length > 0) {
            try {
                await redisClient.setex(url, 86400, JSON.stringify(result));
                console.log(new Date().toLocaleString(), '✅ Cached activities data for 24 hours');
            } catch (err) {
                console.warn('⚠️ Redis set error:', err.message);
            }
        }

        return result;

    } catch (error) {
        console.error('❌ Error scraping activities:', error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = scrapeActivities;
