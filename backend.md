# Vacation Planner Backend

Backend API for the Nigerian Vacation Planner application using Express.js, SQLite, OpenAI, and Puppeteer.

## Prerequisites

- Node.js (v14 or higher)
- npm
- OpenAI API key

## Installation

1. Install dependencies:
```bash
npm install --break-system-packages
```

2. Create a `.env` file:
```bash
cp .env.example .env
```

3. Add your OpenAI API key to `.env`:
```
OPENAI_API_KEY=your-actual-api-key
PORT=3000
```

## Running the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### POST /api/plan-vacation

Creates a new vacation planning task and returns a task ID.

**Request Body:**
```json
{
  "travelers": [
    {
      "name": "Adult 1",
      "type": "adult",
      "nationality": "NG",
      "residence": "NG",
      "visas": ["USA", "UK"]
    }
  ],
  "budget": "1000-2000",
  "timeframe": "1-3-months",
  "duration": "5-7-days",
  "departureCountry": "NG",
  "visaPreference": "short-processing",
  "travelStyles": ["beach-relaxation", "culture-history"]
}
```

**Response:**
```json
{
  "taskId": "task_1234567890_abc123",
  "status": "pending"
}
```

### GET /api/task/:taskId

Retrieves the status and results of a vacation planning task.

**Response (Pending):**
```json
{
  "taskId": "task_1234567890_abc123",
  "status": "pending"
}
```

**Response (Completed):**
```json
{
  "taskId": "task_1234567890_abc123",
  "status": "completed",
  "data": {
    "destinations": [...]
  }
}
```

**Response (Failed):**
```json
{
  "taskId": "task_1234567890_abc123",
  "status": "failed",
  "error": "Error message"
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## How It Works

1. **Task Creation**: When a vacation planning request is received, a task is created in SQLite with status "pending" and a unique task ID is returned immediately.

2. **LLM Destination Suggestions**: OpenAI GPT-4 analyzes the travelers' visa situation, budget, preferences, and suggests 2-3 suitable destinations with detailed visa requirements.

3. **Web Scraping**: For each suggested destination, Puppeteer scrapes:
   - Google Flights for flight prices and details
   - Booking.com for accommodation options and prices
   - GetYourGuide for activities and experiences

4. **Results Compilation**: All scraped data is compiled into a comprehensive itinerary with costs, visa information, and booking links.

5. **Task Completion**: The task status is updated to "completed" with the results, which the frontend can retrieve via polling.

## Database

The application uses SQLite with a single `tasks` table:

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    request_data TEXT NOT NULL,
    result_data TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
)
```

Database file: `vacation_planner.db`

## Error Handling

- If scraping fails for a destination, that destination is skipped and the system continues with others
- If all destinations fail, the task status is set to "failed"
- Mock data is used as fallback when web scraping encounters issues (for MVP stability)

## Notes

- The scraping process is sequential to find the best deals across all platforms
- Puppeteer runs in headless mode for efficiency
- The LLM includes comprehensive visa requirement logic in its prompt
- Frontend should poll the task endpoint every 3-5 seconds until status is "completed" or "failed"

## Future Improvements

- Add caching for visa requirements
- Implement webhook notifications instead of polling
- Add more sophisticated scraping with retry logic
- Support for more booking platforms
- Rate limiting and request queuing