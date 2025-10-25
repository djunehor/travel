const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

async function launchBrowser() {
    return await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        defaultViewport: { width: 1366, height: 768 }
    });
}

async function closeCookieBanner(page) {
    const selector = '.accept.uc-accept-button';
    try {
        const el = await page.$(selector);
        if (el) {
            await el.click();
            console.log('✅ Accepted GetYourGuide cookies');
            await page.waitForTimeout(1000);
        }
    } catch (e) {}
}

async function scrapeActivities(destination, travelStyles) {
    let browser;
    try {
        const url = `https://www.getyourguide.com/s/?q=${encodeURIComponent(destination)}`;

        browser = await launchBrowser();
        const page = await browser.newPage();
        const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(userAgent.toString());

        console.log(`Navigating to GetYourGuide: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        await closeCookieBanner(page);

        // Wait for activity cards
        const activitySelector = 'section div[class="activity-card-block activity-card-block--grid"]';
        await page.waitForSelector(activitySelector, { timeout: 10000 }).catch(() => {
            console.log('⚠️ Timeout waiting for activity results');
        });

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

        if (!totalPrice || activities.length === 0) {
            const dir = path.resolve('screenshots');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
            await page.screenshot({ path: `${dir}/getyourguide_${Date.now()}.png`, fullPage: true });
        }

        const result = {
            activities,
            totalPrice
        };

        console.log('🎟️ Activities Data:', result);

        return result;

    } catch (error) {
        console.error('Error scraping activities:', error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// --- Run standalone ---
if (require.main === module) {
    scrapeActivities('New York, USA', ['cultural', 'adventure']);
}

module.exports = scrapeActivities;
