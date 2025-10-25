const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

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
    return await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        defaultViewport: { width: 1366, height: 768 }
    });
}

async function closeCookieBanner(page) {
    const selector = '#onetrust-accept-btn-handler';
    try {
        const el = await page.$(selector);
        if (el) {
            await el.click();
            console.log('✅ Accepted Booking.com cookies');
            await page.waitForTimeout(1000);
        }
    } catch (e) { }
}

// --- Main Scraper ---
async function scrapeAccommodation(destination, duration, adults, children) {
    let browser;
    try {
        const durationDays = getDurationDays(duration);
        const checkIn = getDateRange('1-3-months');
        const checkOut = new Date(checkIn.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const checkInStr = formatDate(checkIn);
        const checkOutStr = formatDate(checkOut);

        const url = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}&checkin=${checkInStr}&checkout=${checkOutStr}&group_adults=${adults}&group_children=${children}&age=12&no_rooms=1&chal_t=${Date.now()}&force_referer=`;

        browser = await launchBrowser();
        const page = await browser.newPage();

        const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(userAgent.toString());

        console.log(`Navigating to Booking.com: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        await closeCookieBanner(page);

        // Wait for property card
        await page.waitForSelector('div[data-testid="property-card"]', { timeout: 15000 }).catch(() => {
            console.log('⚠️ Timeout waiting for accommodation results');
        });

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

        if (!hotelData?.url) {
            const dir = path.resolve('screenshots');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
            await page.screenshot({ path: `${dir}/booking_${Date.now()}.png`, fullPage: true });
        }

        const result = {
            ...hotelData,
            pricePerNight: hotelData.price ? parseFloat(parseInt(hotelData.price.replace(/[^0-9]/g, '')) / durationDays).toFixed(2) : null,
            from: checkInStr,
            to: checkOutStr
        };
        console.log('🏨 Accommodation Data:', result);
        
        return result;

    } catch (error) {
        console.error('Error scraping accommodation:', error);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// --- Run standalone ---
if (require.main === module) {
    scrapeAccommodation('New York, USA', '7', 2, 0);

}

module.exports = scrapeAccommodation;
