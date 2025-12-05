import puppeteer from 'puppeteer-extra'
import { getRedisClient } from '../helpers/redis.js';

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin())

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
puppeteer.use(AdblockerPlugin({ blockTrackers: true }))

import anonymizeUA from 'puppeteer-extra-plugin-anonymize-ua';
puppeteer.use(anonymizeUA())

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
        }
    } catch (e) { }
}

// --- Main Scraper ---
export async function scrapeFlightAccommodation(origin, destination, checkInStr, checkOutStr, durationDays, budgetRange, adults, children) {

    let browser;
    let page;
    try {
        console.log(new Date().toLocaleString(), `🏨 Scraping flight+accommodation for ${origin}-${destination} from ${checkInStr} to ${checkOutStr} for budget $${budgetRange.min}-${budgetRange.max}`, durationDays);

        const query = {
            "pageType": "search",
            "destination": destination,
            "dateFrom": checkInStr,
            "dateTo": checkOutStr,
            "origin": origin,
            "searchMode": "DP",
            "sort": "recommended",
            "source": "csw",
            "bfSubSource": "S07HPV10S07RR01",
            "businessProfileId": "HOLIDAYSBOOKINGDE_PROMO",
            "adults": adults.toString(),
            "price": `0,${budgetRange.max - (0.05 * budgetRange.max)}`,
            //   "searchId": "t1762193180350fe59",
            //   "vcSearchId": "590905357"
        }
        if (children > 0) {
            query.ages = Array(children).fill('11').join(',')
        }

        const url = `https://booking-dp.lastminute.de/s/tsx?${new URLSearchParams(query).toString()}`;

        // Check cache first
        const redisClient = getRedisClient();

        try {
            const cached = await redisClient.get(url);
            if (cached) {
                console.log(new Date().toLocaleString(), '✅ Returning cached accommodation data');
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('⚠️ Redis get error:', err.message);
        }

        const l = await launchBrowser();
        browser = l.browser;
        page = l.page;

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        );
        await page.setViewport({ width: 1280, height: 800 });


        console.log(new Date().toLocaleString(), `Navigating to Booking.com: ${new URL(url).host}`);
        await page.goto(`${url}&chal_t=${Date.now()}`, { waitUntil: 'networkidle2', timeout: 30 * 1000 });

        await closeCookieBanner(page);

        try {
            await Promise.race([
                page.waitForSelector('button[aria-label="Dismiss sign-in info."]', { timeout: 5 * 1000 }),
                page.waitForSelector('div[data-testid="property-card"]', { timeout: 5 * 1000 }),
                page.waitForSelector('div[data-testid="properties-list-empty-state"]', { timeout: 5 * 1000 })
            ])
        } catch (e) {
            console.log(new Date().toLocaleString(), 'No sign-in info banner to dismiss');
        }

        await page.evaluate(() => window.scrollBy(0, window.innerHeight));

        await page.evaluate(() => {
            const dismissBtn = document.querySelector('button[aria-label="Dismiss sign-in info."]');
            if (dismissBtn) dismissBtn.click();
        });

        // Wait for property card
        try {
            await Promise.race([
                page.waitForSelector('div.list-container div[data-testid="card-container"]', { timeout: 30 * 1000 }),
                page.waitForSelector('div.openx-ui-filters-no-results', { timeout: 30 * 1000 })
            ]);
        } catch (e) {
            console.log(new Date().toLocaleString(), '⚠️ Timeout waiting for accommodation results', e.message);
            // fs.writeFileSync(`${process.cwd()}/html/accommodation_error_${Date.now()}.html`, await page.content());
            // // take screenshot for debugging
            // await page.screenshot({ path: `${process.cwd()}/screenshots/accommodation_${Date.now()}.png`, fullPage: true });
        };

        // if empty list, abort here
        const isEmpty = await page.$('div.openx-ui-filters-no-results',);
        if (isEmpty) {
            console.log(new Date().toLocaleString(), '⚠️ No accommodation results found for the given criteria.', url);
            return null;
        }



        // Extract accommodation information
        const allHotelData = await page.evaluate(() => {
            const propertyElements = Array.from(document.querySelectorAll('div.list-container div[data-testid="card-container"] a'));
            const allData = [];

            for (let i = 0; i < propertyElements.length; i = i + 2) {
                const propertyElement = propertyElements[i].parentElement;
                if (!propertyElement) continue;

                const [rating, approval, reviews] = propertyElement.querySelectorAll('a[data-testid="details"] > div > div')?.[1]?.innerText.trim().split('\n').map((s) => s.trim()) || [null, null, null];

                allData.push({
                    url: propertyElement.querySelector('a')?.href || null,
                    img: propertyElement.querySelector('img[srcset]')?.src || null,
                    name: propertyElement.querySelector('a[data-testid="details"] > div > div')?.textContent.trim() || null,
                    rating: rating ? parseFloat(Number(rating)).toFixed(1) : null,
                    approval: approval || null,
                    stars: propertyElement.querySelectorAll('a[data-testid="details"] > div > div')[1].querySelector('[role="img"]')?.children.length || null,
                    priceRaw: propertyElement.querySelectorAll('a[data-testid="details"] > div')?.[1]?.children[1]?.textContent.trim() || null,
                    price: Number(propertyElement.querySelectorAll('a[data-testid="details"] > div')?.[1]?.children[1]?.textContent.trim().replace(/[^0-9]/g, '') || null),
                    deposit: Number(propertyElement.querySelectorAll('a[data-testid="details"] > div')?.[1]?.children[2]?.textContent.trim().replace(/[^0-9]/g, '') || null),
                    depositRaw: propertyElement.querySelectorAll('a[data-testid="details"] > div')?.[1]?.children[2]?.textContent.trim() || null,
                    priceCurrency: propertyElement.querySelectorAll('a[data-testid="details"] > div')?.[1]?.children[1]?.textContent.replace(/[0-9\s.,pP]/g, '').trim() || null,
                    reviews: reviews ? Number(reviews.replace(/[^0-9,.]/g, '').trim().replace(/\./g, '').replace(',', '.')) : null,
                    perks: propertyElement.querySelectorAll('div[data-testid="recommended-units"] li') ? Array.from(propertyElement.querySelectorAll('div[data-testid="recommended-units"] li')).map(li => li.textContent).join(', ') : [],
                    address: propertyElement.querySelectorAll('a')[1].querySelectorAll('div span')[2]?.textContent.split(',')[0].trim() || null
                });
            }
            return allData;
        });

        // sort by price
        allHotelData.sort((a, b) => a.price - b.price);

        // find first hotel with rating greater than 8.0
        const hotelData = allHotelData.find(hotel => hotel.rating >= 8.0);

        const result = {
            ...hotelData || {},
            pricePerNight: hotelData?.price ? parseFloat(hotelData?.price / durationDays).toFixed(2) : null,
            from: checkInStr,
            to: checkOutStr
        };

        // Cache the result for 24 hours
        if (!isNaN(result.price)) {
            try {
                await redisClient.setex(url, 86400 * 7, JSON.stringify(result));
                console.log(new Date().toLocaleString(), '✅ Cached accommodation data for 24 hours');
            } catch (err) {
                console.warn('⚠️ Redis set error:', err.message);
            }
        }

        return result;

    } catch (error) {
        console.error('❌ Error scraping accommodation:', error);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}
