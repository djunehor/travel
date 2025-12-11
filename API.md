**API Documentation (derived from code)**

- **Purpose**: Machine-readable OpenAPI spec is in `openapi.yaml`. Use this to feed an LLM or UI generator. This `API.md` provides a short human-readable summary and update instructions.

- **Primary Endpoints**:
  - **POST /plan-vacation**: Create a vacation planning task. Request body is a `PlanVacationRequest`. Response returns `taskId` and `queuePosition`.
  - **POST /check-travel**: Quick visa eligibility and possible destinations (cached). Request body: `CheckTravelRequest`.
  - **GET /task/{taskId}**: Get task status, logs and result when complete.
  - **POST /task/{taskId}/cancel**: Cancel a pending or running task.
  - **GET /task/{taskId}/queue-position**: Get the queue position and whether active.
  - **GET /queue/status**: Get queue counts and queued tasks.
  - **GET /airports**: List airports.
  - **GET /health**: Health check.

- **How to update the spec regularly**:
  1. When you change/introduce endpoints, update the handler code in `server.js` and the request/response shapes in helper modules.
  2. Regenerate `openapi.yaml` manually (edit the file) or run a small script to introspect routes if you prefer automation.
  3. Commit the updated `openapi.yaml` to the repo and pass it to your UI generator or LLM.

- **Suggested small automation (manual run)**:
  - Add a script that runs a fast set of `curl` calls against each endpoint to verify behavior and then patches `openapi.yaml` with any discovered differences.

- **Notes and caveats**:
  - The `PlanVacation` flow is queued and long-running. The UI should poll `GET /task/{taskId}` and/or `GET /task/{taskId}/queue-position`.
  - `visaPreference` accepts values: `visa-free`, `visa-on-arrival`, `short-processing`, `any-processing`, and `any` (the server normalizes these internally).
  - Queue behavior (max concurrency) is enforced by the queue manager. UI should surface a queued state.

If you want, I can:
- Generate an OpenAPI JSON version.
- Add a small Node script that converts runtime route definitions into this spec automatically.
- Add a GitHub Action to regenerate `openapi.yaml` when server code changes.
