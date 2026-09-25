# Source contract

The starter runner stores data under `<workspace>/.course-context/`, not in the public repository. Its `config.json` registers Canvas courses, public URLs, and optional connected sources. `sync` makes only GET requests to configured HTTPS origins; `capture` reads one JSON envelope from stdin. The assistant, not the CLI, must verify connected-app identity and completeness.

Captured envelope:

```json
{
  "source_id": "example101.gradescope",
  "checked_at": "2026-09-24T17:30:00-07:00",
  "status": "checked",
  "complete": true,
  "records": [
    {"id": "hw1", "kind": "assignment", "title": "Homework 1", "url": "https://example.edu/assignment/1", "due_at": "2026-10-01T23:59:00-07:00"}
  ]
}
```

`checked` requires `complete: true`, including for a genuinely empty result. Use `blocked` after attempting a source but failing to inspect it, and `not_attempted` when a dependency prevented the attempt. Neither may claim an empty success. A failed capture retains old records and their last-successful timestamp. Do not backdate a run to make stale evidence appear fresh.

Only stable source IDs, course material titles, safe HTTPS URLs, source update time, due time, and event time are allowed in records. `event_at` is planning context and never a due date. Do not include descriptions, message bodies, scores, grades, feedback, submission identifiers, peer information, or private calendar details. Capture only course-scoped evidence and exclude unrelated items.

Each source's current status, last attempt, last success, and prior records are separate. The generated index is evidence, not a curated claim of completion. The assistant should put reviewed interpretation in a human-maintained hub outside the generated files.
