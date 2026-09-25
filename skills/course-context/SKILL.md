---
name: course-context
description: Build and refresh a private, source-backed course index for studying, assignments, and deadlines. Use for course-source audits, daily refreshes, or "what changed / what should I work on" requests; not for completing graded work.
---

# Course context

Keep a useful course index without confusing missing access with an empty source or treating planning events as deadlines.

1. Find the active semester workspace and read its local course policy, source registry, and most recent index. If multiple semesters could match, ask which one. If the workspace has a `course-index-workflow.md`, follow its stricter local rules. If it uses this repository's starter runner, read [the source contract](references/source-contract.md) before capturing connected sources.
2. Check the registered authoritative sources first: course LMS/API, instructor announcements, live assignment system, current syllabus, then course files. Check public and connected sources independently. Record each source as `checked`, `blocked`, or `not_attempted` with its *actual* check time; preserve the last successful evidence on failure.
3. For the starter runner, run `check` before `sync`, then inspect the private `report.md`, `index.md`, and current run checkpoint. Capture connected-source results through `capture` only when account, course, scope, and completeness were verified. Never import raw email, browser output, grades, uploaded answers, attendee lists, or credentials. Do not assume this starter replaces a workspace's existing runner.
4. Verify source provenance before promoting a date, policy, or status into a curated course hub. A calendar event is not an assignment deadline; an email receipt is historical evidence, not live submission status. Distinguish first-run baseline from newly published material. If sources conflict, show the conflict and the authoritative source rather than silently choosing.
5. Report urgent items due within seven days, meaningful changes, and access gaps. Claim an all-source no-change refresh only when every registered source was actually inspected. Indexing is read-only; calendar creation, messages, submissions, and other remote writes require a separate explicit workflow and authorization.

For credential handling, public-repo boundaries, and academic-integrity/recording rules, read [safety](references/safety.md) before configuring a new source or publishing any artifacts. The repository README has installation and onboarding commands.
