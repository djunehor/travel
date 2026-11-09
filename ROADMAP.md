# Travel Planner Roadmap

This document describes the planned technical improvements and feature additions for the AI travel planning platform.

## Planned Work (Estimated: 26+ Hours)

### 1. Multi-Leg Flight Route Optimization (6 Hours)
- Add graph-based shortest flight path routing between international hub airports.
- Implement layover visa constraint checks for transit passenger itineraries.
- Add baggage allowance calculators per airline carrier.

### 2. Live Hotel & Rental Price Scraping (6 Hours)
- Add Puppeteer scraping pipelines for regional lodging providers.
- Build anti-bot request pacing with random delay backoffs.
- Add structured price extraction for daily accommodation rates.

### 3. Interactive Map & Itinerary Visualizer (5 Hours)
- Integrate Leaflet map layers to display daily sightseeing itineraries.
- Calculate day-by-day travel times between scheduled tourist attractions.
- Export visual travel schedules to downloadable PDF guides.

### 4. Currency Conversion & Budget Tracking (5 Hours)
- Add automated daily exchange rate ingestion from European Central Bank feeds.
- Build multi-currency budget split calculators for group travelers.
- Add expense tracking endpoints with category breakdown charts.

### 5. Automated Integration Test Suite (4 Hours)
- Write integration tests for SQLite destination and visa policy queries.
- Build Redis task queue mock suites for async trip generation.
- Add GitHub Actions CI workflow to run syntax and logic tests on push.
