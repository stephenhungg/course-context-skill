# Upgrade decisions

This package distills a working personal course-index workflow into a reusable boundary. The original workflow already distinguished incomplete checks from empty results, kept last-successful evidence, and guarded calendar writes. The changes here target portability and safe onboarding, not a claim that all personal adapters are fully portable.

| Existing pain point | Public starter decision |
| --- | --- |
| Absolute semester paths, fixed course IDs, and a machine-specific Node binary | One private `config.json` per workspace; explicit Node 22 requirement instead of guessing the installed runtime. |
| Connector snapshots can be mistaken for a fresh run | Capture carries its own timestamp, completeness flag, one-use import, and 24-hour age limit. |
| Partial API failure can look like no assignments | Per-source statuses, checkpointed current attempt, and retained last-successful records. |
| Mixing personal calendar data with course facts | Separate `event_at` from `due_at`; no calendar write capability in this starter. |
| Canvas calendar listings default to today without dates | Require an explicit term window and test that every calendar request carries it. |
| A UTC-normalized deadline can appear on the wrong local day | Preserve the source time offset; keep all-day dates separate from timed events. |
| A private semester folder can be staged by an unrelated Git repo | Check that the private directory is ignored and has no tracked files before capture or sync. |
| Publishing a complex personal workflow risks exposing tokens and private data | Public code and examples only; `.course-context`, caches, secrets, and generated evidence stay private. |

The most useful next improvements would be opt-in, course-specific adapters with fixture tests; a content-signature verifier for instructor-provided downloads; and a private local scheduler wrapper that confirms source coverage before notification. Do not add broad browser scraping or automatic calendar creation merely to make the public package look comprehensive.

Canvas' [pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination) and [throttling](https://developerdocs.instructure.com/services/canvas/basics/file.throttling) docs informed the bounded sequential client. OpenAI's [skill packaging guidance](https://developers.openai.com/plugins/build/skills) informed the short `SKILL.md` with conditional references. GitHub's [secrets documentation](https://docs.github.com/en/actions/reference/security/secrets) is why the repo's CI runs fixture tests only, with no live course credentials or generated reports.
