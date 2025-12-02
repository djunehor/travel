# 🌴 AI-Powered Vacation Planner API

This project is an **AI-driven vacation planning API** built with **Express.js**, **OpenAI GPT**, **Redis**, and **SQLite (via sql.js)**.  
It takes user preferences (budget, duration, visa preferences, etc.), uses **GPT-4o-mini** to suggest suitable destinations,  
then scrapes **flights**, **accommodation**, and **activities** to recommend the best travel options — all tracked via a background task system.

---

## 🚀 Features

- **AI Destination Recommendations** — powered by OpenAI GPT-4o-mini  
- **Real-Time Travel Data Scraping** — fetches flights, hotels, and activities  
- **Budget-Aware Filtering** — respects per-trip budget constraints  
- **Visa & Safety Filtering** — filters destinations by visa rules and advisories  
- **Async Task Management** — background task processing with SQLite persistence  
- **Caching with Redis** — speeds up repeated GPT calls  
- **Structured JSON Responses** — easy to integrate with frontends  

---

## 🧰 Tech Stack

| Component | Technology |
|------------|-------------|
| Web Framework | [Express.js](https://expressjs.com/) |
| AI Engine | [OpenAI GPT-4o-mini](https://platform.openai.com/docs/models#gpt-4o-mini) |
| Database | [sql.js](https://sql.js.org/) (SQLite in-memory with persistence) |
| Cache Layer | [Redis (ioredis)](https://github.com/luin/ioredis) |
| Scraping | Custom functions (`scrapeFlights`, `scrapeAccommodation`, `scrapeActivities`) |
| Environment Management | [dotenv](https://github.com/motdotla/dotenv) |

---

## ⚙️ Setup

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/vacation-planner-api.git
cd vacation-planner-api
````

### 2. Install dependencies

```bash
npm install
```

### 3. Create a `.env` file

```bash
OPENAI_API_KEY=your_openai_api_key_here
REDIS_URL=redis://localhost:6379
PORT=3000
```

> **Note:** Redis is optional but improves performance via caching.

### 4. Start the server

```bash
node server.js
```

The API will start on:

```
http://localhost:3000
```

---

## 🧩 API Endpoints

### **1. POST `/api/plan-vacation`**

Creates a new vacation planning task.

#### Request Body Example

```json
{
  "departureCountry": "LHR",
  "travelers": [
    {
      "name": "John Doe",
      "nationality": "US",
      "residence": "DE",
      "visas": ["Schengen"]
    }
  ],
  "budget": "1000-2000",
  "duration": "7d",
  "visaPreference": "visa-free",
  "travelStyles": ["beach", "relaxation"],
  "timeframe": "1-3-months"
}
```

#### Response

```json
{
  "taskId": "TASK1730000000XYZ",
  "status": "pending"
}
```

---

### **2. GET `/api/task/:taskId`**

Fetches task status and results.

#### Response Example

```json
{
  "taskId": "TASK1730000000XYZ",
  "status": "completed",
  "data": {
    "destinations": [
      {
        "name": "Lisbon, Portugal",
        "visaStatus": "visa-free",
        "estimatedCost": {
          "flights": 400,
          "accommodation": 700,
          "activities": 300,
          "total": 1400
        },
        "flightDetails": { "departureDate": "2025-07-01" },
        "accommodationSuggestion": "Lisbon Marriott Hotel",
        "topActivities": ["City Tour", "Beach Day"],
        "timeline": {
          "visaApplication": "Not required",
          "bookingDeadline": "2-3 weeks before departure",
          "departureDate": "2025-07-01"
        }
      }
    ]
  }
}
```

---

### **3. GET `/api/airports`**

Returns a list of supported airports from `country_airports.json`.

### **4. GET `/health`**

Health check endpoint — returns `{ "status": "ok" }`.

---

## 🧮 How It Works

1. **User submits preferences** → `/api/plan-vacation`
2. **Task created in SQLite DB** → status = `pending`
3. **GPT-4o-mini generates destinations**
4. **Scrapers fetch flight, hotel, and activity data**
5. **Results filtered by budget and visa conditions**
6. **Task updated to `completed` or `failed`**
7. **Frontend polls `/api/task/:taskId` for results**

---

## 🧠 AI Prompt Design

The AI prompt (in `buildDestinationPrompt`) ensures:

* Destination relevance to travelers’ visa/residence status
* Exclusion of unsafe countries (US advisory level 3/4)
* Respect for budget and interest categories
* JSON-only structured responses

---

## 🗄️ Database Schema

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  request_data TEXT NOT NULL,
  result_data TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## 🧩 Redis Caching

* Caches GPT destination results for **1 hour**

* Key format:

  ```
  destinations:<requestData JSON>
  ```

* If Redis is unavailable, the system safely falls back to fresh GPT calls.

---

## 🧪 Example Flow

1. **POST** `/api/plan-vacation`
   → returns `{ taskId: "TASK123...", status: "pending" }`

2. Wait a few seconds...

3. **GET** `/api/task/TASK123...`
   → returns travel plan with top 3 destinations and estimated costs.

---

## 🛡️ Error Handling

* Failed scrapes or GPT issues mark tasks as `failed`.
* Automatic **retries up to 3 times** per task.
* Redis errors are logged but non-blocking.

---

## 🧾 License

MIT License © 2025 Your Name

---

## 📚 References

* [Express.js Official Docs (2024)](https://expressjs.com/)
* [OpenAI API Docs (2025)](https://platform.openai.com/docs/api-reference)
* [sql.js Documentation (2024)](https://sql.js.org/)
* [ioredis GitHub (2024)](https://github.com/luin/ioredis)

## Integrations
- Travelstart.com.ng (Flight): https://www.travelstart.com.ng/flights/results?version=3&timestamp=2025-12-02_11-30-22-030&from_0=LOS&from_type_0=airport&to_0=SEZ&to_type_0=airport&depart_date_0=2025-12-24&from_1=SEZ&from_type_1=airport&to_1=LOS&to_type_1=airport&depart_date_1=2025-12-27&is_flex_dates=false&trip_type=Roundtrip&adults=1&youngAdults=0&children=0&infants=0&currency=NGN&cpy_source=tsngweb&search=true&show_search_options=false&language=en&class=Economy&correlation_id=3dd650e8-0e1a-4b66-89db-7bdb89b07f4b

- Travelstart.com.ng (Hotel): https://www.travelstart.co.za/accommodation/in/frankfurt-am-main-germany?checkin=2025-12-18&checkout=2025-12-21&adults=1&children=0&infants=0