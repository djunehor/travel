# Vacation Planner - Complete Setup Guide

This is an MVP Nigerian Vacation Planner that helps users find suitable vacation destinations based on visa requirements, budget, and preferences.

## Project Structure

```
vacation-planner/
├── vacation-planner.html    # Frontend (multi-step form)
├── server.js                # Backend Express server
├── scrapers.js              # Web scraping module (Puppeteer)
├── package.json             # Node.js dependencies
├── .env.example             # Environment variables template
├── API-CONTRACT.md          # API documentation
├── BACKEND-README.md        # Backend-specific docs
└── vacation_planner.db      # SQLite database (created on first run)
```

## Quick Start

### 1. Backend Setup

```bash
# Install dependencies
npm install --break-system-packages

# Create environment file
cp .env.example .env

# Add your OpenAI API key to .env
# OPENAI_API_KEY=sk-your-key-here

# Start the backend server
npm start
```

Backend will run on `http://localhost:3000`

### 2. Frontend Setup

Simply open `vacation-planner.html` in a web browser. The frontend will connect to the backend API at `http://localhost:3000`.

For production, you'll need to:
- Host the HTML file on a web server
- Update the API URL in the HTML file to your production backend URL
- Enable CORS on your backend for your domain

## How It Works

### User Flow

1. **User fills multi-step form** with:
   - Number of travelers (adults, children, infants)
   - Each traveler's nationality, residence, and existing visas
   - Budget, travel timeframe, trip duration
   - Departure country, visa preference, travel interests

2. **Form submission**:
   - Frontend sends data to `POST /api/plan-vacation`
   - Backend creates task with status "pending"
   - Returns task ID immediately
   - Frontend starts polling `GET /api/task/:taskId` every 5 seconds

3. **Background processing**:
   - OpenAI GPT-4 analyzes visa requirements for all travelers
   - LLM suggests 2-3 suitable destinations
   - Puppeteer scrapes Google Flights, Booking.com, GetYourGuide sequentially
   - Compiles complete itinerary with real prices

4. **Results display**:
   - Once task status is "completed", results are shown
   - Each destination includes:
     - Visa status and requirements
     - Flight details and prices
     - Accommodation suggestions and prices
     - Top activities and prices
     - Total cost breakdown
     - Timeline for booking

## Key Features

### Frontend
- Clean, responsive UI with Tailwind CSS
- 8-step progressive form with validation
- Back/Next navigation
- Dynamic traveler detail collection
- Loading state with polling
- Results display with booking links

### Backend
- Task-based async processing (no waiting for slow scraping)
- LLM-powered destination suggestions with visa logic
- Sequential web scraping for best deals
- SQLite database for task persistence
- Error handling with fallback to mock data (for MVP stability)
- RESTful API endpoints

### Intelligence
- Visa requirements based on nationality + residence + existing visas
- Considers special cases (e.g., UAE visa-on-arrival with US/UK/Schengen visa)
- Budget-aware destination filtering
- Travel style matching
- Processing time constraints

## Environment Variables

Create a `.env` file:

```
OPENAI_API_KEY=sk-your-openai-api-key
PORT=3000
```

## API Endpoints

### POST /api/plan-vacation
Creates vacation planning task, returns task ID immediately.

### GET /api/task/:taskId
Returns task status and results (when completed).

### GET /health
Health check endpoint.

See `API-CONTRACT.md` for detailed request/response formats.

## Technologies Used

### Backend
- **Express.js**: Web framework
- **SQLite (sql.js)**: Database for task storage
- **OpenAI SDK**: GPT-4 for destination suggestions
- **Puppeteer**: Web scraping for flights, hotels, activities
- **CORS**: Cross-origin resource sharing

### Frontend
- **Vanilla JavaScript**: No framework dependencies
- **Tailwind CSS**: Utility-first CSS (via CDN)
- **Fetch API**: HTTP requests to backend

## Development Notes

### Scraping Challenges
- Google Flights, Booking.com, and GetYourGuide have anti-bot measures
- Selectors may break when sites update
- Mock data is used as fallback for MVP
- Future: Use official APIs where available

### LLM Prompt Engineering
- Comprehensive visa rules included in system prompt
- Structured JSON output for consistency
- Temperature set to 0.7 for creative yet reliable suggestions

### Database
- Simple schema with single tasks table
- In-memory with file persistence
- No user accounts (stateless for MVP)

## Future Improvements

1. **Replace Scraping with APIs**:
   - Amadeus API for flights
   - Booking.com Affiliate API
   - GetYourGuide Partner API

2. **Enhanced Features**:
   - User accounts and saved searches
   - Email notifications when results ready (instead of polling)
   - Multi-language support
   - Currency conversion
   - Calendar integration

3. **Performance**:
   - Caching for visa requirements
   - Redis for task queue
   - Rate limiting
   - Parallel scraping with error handling

4. **UX Improvements**:
   - Live chat support
   - Comparison view for destinations
   - Booking directly through the platform
   - Travel insurance integration

## Troubleshooting

### "Failed to create task"
- Check if backend is running (`npm start`)
- Verify OPENAI_API_KEY is set in `.env`
- Check console for error messages

### "Request timed out"
- Scraping can take 2-5 minutes
- Check backend logs for specific errors
- Increase maxAttempts in frontend if needed

### Scraping returns mock data
- This is expected for MVP
- Real scraping may fail due to anti-bot measures
- Mock data ensures the flow works end-to-end

### CORS errors
- Ensure backend CORS is enabled (already configured)
- Check if frontend and backend URLs match

## Production Deployment

### Backend
1. Deploy to a Node.js hosting service (Heroku, Railway, Render, etc.)
2. Set environment variables in hosting dashboard
3. Note the production URL

### Frontend
1. Update API URLs in `vacation-planner.html` to production backend URL
2. Deploy HTML file to static hosting (Netlify, Vercel, GitHub Pages, etc.)

### Database
- SQLite file will persist on server filesystem
- For production, consider PostgreSQL or MongoDB
- Implement regular backups

## License

MIT

## Support

For issues or questions, check the logs:
- Backend: Console output where `npm start` is running
- Frontend: Browser developer console (F12)