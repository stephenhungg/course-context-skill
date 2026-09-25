# Contributing

Run `npm test` on Node 22. Use synthetic fixtures only. Never commit real course snapshots, tokens, browser profiles, grades, submissions, peer information, or private calendar data. New source adapters should document their access boundary, allowable fields, completeness check, failure status, and course-policy constraints. Add tests for empty success, pagination, partial failure, stale evidence, and sanitization. Do not add remote writes to the read-only sync path.
