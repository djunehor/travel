# System Architecture

## Overview

The Nigerian Vacation Planner follows a task-based async architecture with frontend polling.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          USER BROWSER                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │          vacation-planner.html (Frontend)                │   │
│  │                                                           │   │
│  │  • Multi-step form (8 steps)                            │   │
│  │  • Form validation                                       │   │
│  │  • API communication                                     │   │
│  │  • Result polling (every 5s)                            │   │
│  │  • Results display                                       │   │
│  └─────────────────┬───────────────────────────────────────┘   │
│                    │                                             │
└────────────────────┼─────────────────────────────────────────────┘
                     │
                     │ HTTP Requests
                     │ (POST /api/plan-vacation)
                     │ (GET /api/task/:taskId)
                     │
┌────────────────────▼─────────────────────────────────────────────┐
│                    BACKEND SERVER                                 │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Express.js (server.js)                      │   │
│  │                                                           │   │
│  │  Endpoints:                                              │   │
│  │  • POST /api/plan-vacation  → Create task               │   │
│  │  • GET  /api/task/:taskId   → Get task status/results  │   │
│  │  • GET  /health              → Health check             │   │
│  └───┬────────────────────────────────────────┬────────────┘   │
│      │                                         │                 │
│      │                                         │                 │
│  ┌───▼────────────────────┐        ┌──────────▼──────────────┐ │
│  │   SQLite Database      │        │  Background Processor   │ │
│  │                        │        │                          │ │
│  │  tasks table:          │        │  1. Get LLM suggestions │ │
│  │  • id                  │        │  2. Scrape flights      │ │
│  │  • status              │        │  3. Scrape hotels       │ │
│  │  • request_data        │        │  4. Scrape activities   │ │
│  │  • result_data         │        │  5. Update task status  │ │
│  │  • timestamps          │        └──────────┬──────────────┘ │
│  └────────────────────────┘                   │                 │
│                                                │                 │
└────────────────────────────────────────────────┼─────────────────┘
                                                 │
                     ┌───────────────────────────┼───────────────────────────┐
                     │                           │                           │
                     │                           │                           │
         ┌───────────▼────────────┐  ┌──────────▼──────────┐  ┌────────────▼──────────┐
         │    OpenAI GPT-4        │  │  Puppeteer Browser  │  │  Puppeteer Browser    │
         │                        │  │                      │  │                        │
         │  • Analyze travelers   │  │  Google Flights      │  │  Booking.com          │
         │  • Consider visas      │  │  ─────────────      │  │  ─────────────        │
         │  • Suggest 2-3 dest.   │  │  • Search flights    │  │  • Search hotels      │
         │  • Include visa info   │  │  • Parse prices      │  │  • Parse prices       │
         │                        │  │  • Get schedules     │  │  • Get names          │
         └────────────────────────┘  └─────────────────────┘  └───────────────────────┘
                                     
                                     ┌──────────────────────┐
                                     │  Puppeteer Browser   │
                                     │                      │
                                     │  GetYourGuide        │
                                     │  ─────────────       │
                                     │  • Search activities │
                                     │  • Parse prices      │
                                     │  • Get names         │
                                     └──────────────────────┘
```

## Request Flow

### 1. Form Submission
```
User fills form → Frontend validates → POST /api/plan-vacation
                                              ↓
                                     Backend creates task
                                              ↓
                                     Saves to SQLite (status: pending)
                                              ↓
                                     Returns taskId immediately
                                              ↓
                                     Starts background processing
```

### 2. Background Processing
```
Background thread starts
    ↓
Step 1: Call OpenAI API
    • Send traveler data
    • Get 2-3 destination suggestions
    • Each includes visa requirements
    ↓
Step 2: For each destination (sequential)
    ↓
    a) Scrape Google Flights
       • Launch Puppeteer browser
       • Navigate to flight search
       • Extract price, airline, duration
       • Close browser
    ↓
    b) Scrape Booking.com
       • Launch Puppeteer browser
       • Navigate to hotel search
       • Extract price, hotel name
       • Close browser
    ↓
    c) Scrape GetYourGuide
       • Launch Puppeteer browser
       • Navigate to activities
       • Extract activities and prices
       • Close browser
    ↓
    d) Compile destination data
       • Calculate total cost
       • Format response
    ↓
Step 3: Update task in database
    • status: completed
    • result_data: JSON with all destinations
```

### 3. Frontend Polling
```
Frontend starts polling immediately after getting taskId
    ↓
Every 5 seconds: GET /api/task/:taskId
    ↓
Check status:
    • pending → Keep polling
    • completed → Display results
    • failed → Show error
    ↓
Max 60 attempts (5 minutes)
```

## Data Flow

### Request Data Structure
```javascript
{
  travelers: [
    {
      name: "Adult 1",
      type: "adult|child|infant",
      nationality: "NG",
      residence: "NG",
      visas: ["USA", "UK"]
    }
  ],
  budget: "1000-2000",
  timeframe: "1-3-months",
  duration: "5-7-days",
  departureCountry: "NG",
  visaPreference: "visa-on-arrival",
  travelStyles: ["beach-relaxation"]
}
```

### Response Data Structure
```javascript
{
  taskId: "task_1234567890_abc123",
  status: "completed",
  data: {
    destinations: [
      {
        name: "Dubai, UAE",
        visaStatus: "visa-on-arrival",
        visaProcessingTime: "15 minutes",
        visaRequirements: [...],
        estimatedCost: {
          flights: 850,
          accommodation: 600,
          activities: 400,
          total: 1850
        },
        flightDetails: {...},
        accommodationSuggestion: "...",
        topActivities: [...],
        timeline: {...}
      }
    ]
  }
}
```

## Database Schema

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,           -- "task_1234567890_abc123"
    status TEXT NOT NULL,          -- "pending" | "processing" | "completed" | "failed"
    request_data TEXT NOT NULL,    -- JSON string of user input
    result_data TEXT,              -- JSON string of results (null until completed)
    error_message TEXT,            -- Error message if failed
    created_at INTEGER NOT NULL,   -- Unix timestamp
    updated_at INTEGER NOT NULL    -- Unix timestamp
);
```

## Technology Choices

### Why Express.js?
- Simple, lightweight
- Large ecosystem
- Easy to deploy
- Good for RESTful APIs

### Why SQLite?
- No separate database server needed
- File-based (easy to deploy)
- Perfect for MVP
- Can migrate to PostgreSQL later

### Why Puppeteer?
- Real browser automation
- Handles JavaScript-heavy sites
- Can bypass simple anti-bot measures
- Takes screenshots for debugging

### Why Task-Based?
- Better UX (instant response)
- Prevents timeout errors
- Allows for long processing
- Scalable architecture

### Why Polling?
- Simple to implement
- No WebSocket complexity
- Works everywhere
- Easy to debug

## Scalability Considerations

### Current Limitations
- Single-threaded processing
- No queue management
- In-memory task list
- Sequential scraping

### Future Improvements
- Add Redis for task queue
- Implement worker threads
- Use job queue (Bull, Bee-Queue)
- Parallel scraping with rate limits
- WebSocket for real-time updates
- Cache visa requirements
- Use official APIs instead of scraping

## Security Considerations

### Current Implementation
- CORS enabled for all origins (MVP only)
- No authentication
- No rate limiting
- API key in environment variable

### Production Recommendations
- Restrict CORS to specific domains
- Add API authentication
- Implement rate limiting
- Use secrets management (AWS Secrets, etc.)
- Add request validation
- Sanitize all inputs
- Add logging and monitoring

## Error Handling

### Scraping Failures
```
Try to scrape → Fails → Log error → Return mock data → Continue
```

### LLM Failures
```
Call OpenAI → Fails → Retry once → Still fails → Return error → Update task status to failed
```

### Network Failures
```
Network error → Retry with exponential backoff → Max 3 retries → Return error
```

## Performance Metrics

**Average Processing Time:**
- LLM suggestion: 3-5 seconds
- Flight scraping: 10-30 seconds
- Hotel scraping: 10-30 seconds
- Activities scraping: 10-30 seconds
- Total: 2-5 minutes per request

**Resource Usage:**
- Memory: ~200-500 MB per request (Puppeteer browsers)
- CPU: Moderate (Puppeteer rendering)
- Network: High during scraping
- Storage: Minimal (SQLite database)

## Monitoring & Logging

### Current Logging
- Console logs for all steps
- Error messages to stderr
- Task status in database

### Recommended Additions
- Structured logging (Winston, Pino)
- Error tracking (Sentry, Rollbar)
- Performance monitoring (New Relic, DataDog)
- Uptime monitoring (Pingdom, UptimeRobot)