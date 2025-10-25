# Vacation Planner API Contract

## Request Format

### Endpoint
`POST /api/plan-vacation`

### Request Body
```json
{
  "travelers": [
    {
      "name": "Adult 1",
      "type": "adult|child|infant",
      "nationality": "NG",
      "residence": "NG",
      "visas": ["USA", "UK", "Schengen"]
    }
  ],
  "budget": "under-500|500-1000|1000-2000|2000-5000|over-5000",
  "timeframe": "1-month|1-3-months|3-6-months|6-plus-months",
  "duration": "3-5-days|5-7-days|1-2-weeks|2-plus-weeks",
  "departureCountry": "NG",
  "visaPreference": "visa-free|visa-on-arrival|short-processing|any-processing",
  "travelStyles": ["beach-relaxation", "adventure-nature", "culture-history"]
}
```

## Response Format

### Success Response (200 OK)
```json
{
  "destinations": [
    {
      "name": "Dubai, UAE",
      "visaStatus": "visa-on-arrival|visa-free|e-visa|standard-visa",
      "visaProcessingTime": "15 minutes at airport",
      "visaRequirements": [
        "Valid passport",
        "Return ticket",
        "Hotel booking"
      ],
      "estimatedCost": {
        "flights": 850,
        "accommodation": 600,
        "activities": 400,
        "total": 1850
      },
      "flightDetails": {
        "airline": "Emirates",
        "duration": "6h 30m",
        "layovers": 0
      },
      "accommodationSuggestion": "Rove Downtown Dubai",
      "topActivities": [
        "Burj Khalifa Visit",
        "Dubai Mall Shopping",
        "Desert Safari",
        "Dubai Marina Cruise"
      ],
      "timeline": {
        "visaApplication": "Get visa on arrival",
        "bookingDeadline": "2 weeks before departure",
        "departureDate": "Based on your selected timeframe"
      }
    }
  ]
}
```

## Field Descriptions

### Traveler Object
- `name`: Optional display name (defaults to "Adult 1", "Child 1", etc.)
- `type`: One of "adult", "child", or "infant"
- `nationality`: ISO 2-letter country code
- `residence`: ISO 2-letter country code
- `visas`: Array of countries where traveler holds valid visas

### Budget Values
- `under-500`: Under $500
- `500-1000`: $500 - $1,000
- `1000-2000`: $1,000 - $2,000
- `2000-5000`: $2,000 - $5,000
- `over-5000`: Over $5,000

### Timeframe Values
- `1-month`: Within 1 month
- `1-3-months`: 1-3 months from now
- `3-6-months`: 3-6 months from now
- `6-plus-months`: 6+ months from now

### Duration Values
- `3-5-days`: 3-5 days
- `5-7-days`: 5-7 days
- `1-2-weeks`: 1-2 weeks
- `2-plus-weeks`: 2+ weeks

### Visa Preference Values
- `visa-free`: Only show destinations that don't require visa
- `visa-on-arrival`: Include destinations with visa-on-arrival
- `short-processing`: Willing to apply for visa (2-4 weeks processing)
- `any-processing`: Any processing time acceptable

### Travel Style Values
- `beach-relaxation`
- `adventure-nature`
- `culture-history`
- `shopping-nightlife`
- `food-culinary`

### Visa Status Values (in response)
- `visa-free`: No visa required
- `visa-on-arrival`: Get visa at airport
- `e-visa`: Apply online, quick approval
- `standard-visa`: Traditional embassy/consulate application

## Notes for Backend Implementation

1. **Visa Requirements**: Backend should check visa requirements for each traveler based on their nationality, residence, and existing visas.

2. **Multiple Travelers**: If travelers have different nationalities, find destinations that work for ALL travelers.

3. **Budget Calculation**: Total costs should be for the entire group (all travelers combined).

4. **Flight Pricing**: Use Google Flights API or similar to get real flight prices from departure country.

5. **Accommodation**: Use Booking.com API to find hotels within budget.

6. **Activities**: Use GetYourGuide API to suggest relevant activities based on travel styles.

7. **Timeline**: Calculate realistic timeline including:
   - Visa processing time (if applicable)
   - Booking recommendations
   - Best travel dates based on timeframe

8. **Sorting**: Return destinations sorted by match score (considering budget, visa ease, and travel styles).