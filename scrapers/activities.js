import puppeteer from 'puppeteer-extra'
// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// Add adblocker plugin to block all ads and trackers (saves bandwidth)
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

import { getRedisClient } from '../helpers/redis.js';

puppeteer.use(StealthPlugin())

puppeteer.use(AdblockerPlugin({ blockTrackers: true }))

import anonymizeUA from 'puppeteer-extra-plugin-anonymize-ua';
puppeteer.use(anonymizeUA())

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

export async function scrapeActivities(destination, checkInStr, checkOutStr, durationDays, budget) {

    let browser;
    let page;
    try {

        const maxPrice = Math.round(budget / durationDays);
        const minPrice = Math.min(1, Math.floor(maxPrice * 0.5));
        console.log(new Date().toLocaleString(), '🎟️ Scraping activities for:', destination, `Duration: ${durationDays} days`, { minPrice, maxPrice });
        const url = `https://www.getyourguide.com/s?q=${destination}&searchSource=3&src=search_bar&date_from=${checkInStr}&date_to=${checkOutStr}&price_range=${minPrice}-${maxPrice}&sort=price&order=asc`;

        // Check cache first
        const redisClient = getRedisClient();

        try {
            const cached = await redisClient.get(url);
            if (cached) {
                console.log(new Date().toLocaleString(), '✅ Returning cached activities data');
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('⚠️ Redis get error:', err.message);
        }


        const l = await launchBrowser();
        browser = l.browser;
        page = l.page;

        console.log(new Date().toLocaleString(), `Navigating to GetYourGuide: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60 * 1000 });

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

            //fs.writeFileSync(`${process.cwd()}/html/activies_error_${Date.now()}.html`, await page.content());
            // take screenshot for debugging
            // await page.screenshot({ path: `${process.cwd()}/screenshots/activities_${Date.now()}.png`, fullPage: true });
        };


        // Extract activities
        const activities = await page.evaluate(() => {
            const activities = [];
            const activityElements = document.querySelectorAll('section div[class="activity-card-block activity-card-block--grid"]');

            activityElements.forEach((el, _index) => {

                const titleElement = el.querySelector('h3[data-test-id="activity-card-title"]');
                const priceElement = el.querySelector('span[class*="activity-price__text-price"]');
                const priceUnitElement = el.querySelector('span[class*="activity-price__text-suffix"]');

                if (titleElement) {
                    activities.push({
                        url: el.querySelector('a') ? el.querySelector('a').href : null,
                        name: titleElement?.textContent.trim(),
                        price: priceElement?.textContent.trim(),
                        priceNumber: Number(priceElement?.textContent.trim().replace(/[^0-9]/g, '') || '0'),
                        priceUnit: priceUnitElement?.textContent.trim(),
                        currency: priceElement?.textContent.trim().replace(/[0-9,. ]/g, '').trim() || null,
                    });
                }

            });

            return activities;
        });
    
        // we neeed to take as many acvtivities as possible within budget, then calculate total price for that
        const sortedActivities = activities.sort((a, b) => a.priceNumber - b.priceNumber);

        const selectedActivities = [];
        let currentTotal = 0;
        for (let i = 0; i < sortedActivities.length; i++) {
            const activity = sortedActivities[i];
            const price = activity.priceNumber;
            if (isNaN(price)) continue;
            if (currentTotal + price <= budget) {
                selectedActivities.push(activity);
                currentTotal += price;
            } else {
                break;
            }
        }

        console.log(new Date().toLocaleString(), `✅ Selected ${selectedActivities.length} activities within budget $${budget}, total price $${currentTotal}`);

        // we need to add "day" info to each activity e.g 1 means day 1, 2 means day 2 etc.
        for (let i = 0; i < selectedActivities.length; i++) {
            const activity = selectedActivities[i];
            activity.day = (i % durationDays) + 1;
        }
        // sort by day
        selectedActivities.sort((a, b) => a.day - b.day);
        const result = {
            activities: selectedActivities,
            totalPrice: currentTotal
        };

        // Cache the result for 24 hours
        if (result.activities.length > 0) {
            try {
                await redisClient.setex(url, 86400 * 7, JSON.stringify(result));
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
