# `@sharkflows/sketchup-export`

Local, development-only HTTP bridge between Sharkflows and a SketchUp plugin.
Tasks and result bytes are held in memory and are lost when the process exits.

## Start

```bash
npm run dev
```

`SKETCHUP_BRIDGE_PORT` selects a port (`0` chooses an available port).
`SKETCHUP_BRIDGE_ORIGINS` is a comma-separated exact allowlist, for example
`http://localhost:3000`. The startup JSON contains the loopback URL and a new
256-bit bearer token. Treat that line as a secret.

Every non-preflight request requires `Authorization: Bearer <token>`. Browser
requests with an `Origin` additionally require an exact allowlist match.

## Protocol

- `POST /v1/tasks` — create a task. Requires `Idempotency-Key`; body is
  `{ "configuration": SpaceConfiguration }`.
- `GET /v1/tasks/:id` — inspect task state and reports.
- `GET /v1/plugin/tasks/next?waitMs=25000` — atomically pull the oldest queued
  task, waiting up to the configured maximum. A timeout returns `204`.
- `PATCH /v1/plugin/tasks/:id` — report status, monotonic progress, structured
  error, versions, and component counts.
- `POST /v1/plugin/tasks/:id/result` — while `EXPORTING`, submit
  `{ filename, contentType, dataBase64 }`. The bridge computes size and SHA-256,
  stores bytes under an opaque ID, and completes the task.
- `GET /v1/tasks/:id/result` — download the stored result.
- `GET /v1/audit` — retrieve lifecycle audit events.

State transitions are enforced:

```text
QUEUED → DOWNLOADED → MODEL_BUILDING → MODEL_VALIDATING
  → LAYOUT_REFRESH_REQUIRED → MODEL_BUILDING …
  → EXPORTING → COMPLETED
```

Any non-terminal state may transition to `FAILED` only where allowed by the
state machine. Queue and processing deadlines also produce `FAILED`.

This package is not a production queue or object store. Put a durable,
access-controlled adapter behind the same boundary before multi-user or remote
deployment.
