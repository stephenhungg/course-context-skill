# Course Context

A Codex skill and small local runner for a source-backed school index. It helps answer “what changed?”, “what is due?”, and “which sources could not be checked?” without publishing your coursework, grades, or credentials.

The public repository is a **portable starter**, not a copy of anyone's private semester folder. It reads Canvas course metadata, assignments, announcements, modules, pages, files, quizzes, discussions, and course calendar events; checks configured public URLs for content changes; and accepts tightly scoped captures from connected tools. It does **not** log in to Gmail, Gradescope, Drive, or a browser by itself, extract lecture transcripts, submit work, or create calendar events.

## Five-minute onboarding

1. Install Node.js 22 and clone this repository. The runner is dependency-free. Run `npm test` in the clone.
2. Install the skill by linking or copying `skills/course-context` into your Codex skills directory (normally `~/.codex/skills/course-context`). Restart/reload Codex if needed for discovery. Invoke it as `$course-context` or ask to refresh your course index.
3. Make a private semester workspace outside the public repository. Run:

   ```bash
   node /path/to/course-context-skill/src/cli.mjs init /path/to/private-semester
   ```

4. Edit `/path/to/private-semester/.course-context/config.json`: replace the example Canvas origin and course ID; add every course slug and each public/connected source you want tracked. Keep the config and all generated files private. The example values cannot be used for a live sync.
5. Supply a Canvas token locally as `CANVAS_TOKEN` through your shell or secret manager, then run:

   ```bash
   node /path/to/course-context-skill/src/cli.mjs sync /path/to/private-semester
   ```

   The command only sends authenticated **GET** requests to the configured Canvas origin. It never puts the token in a URL or output file. Do not paste tokens into chat, commands, GitHub issues, or config files. Without a token, Canvas sources are marked `not_attempted` while public sources still run.
6. Review the private `.course-context/report.md`, `index.md`, and `runs/<run-id>/state.json`. Exit `0` means all registered sources checked; `2` means a completed partial run; `1` means local setup or processing failed. On `1`, inspect the current run checkpoint—do not assume the prior `state.json` is this attempt.

The generated index is evidence, not a polished study plan. Keep your own notes and confirmed deadlines in a separate curated hub; do not edit generated files. On the first run, “added” means a baseline, not necessarily newly released material.

## Connected-source captures

Register a source under `connected_sources`, then verify the signed-in account, exact course, and complete result through your authorized tool. Send only the minimal JSON envelope to the runner's standard input:

```bash
node /path/to/course-context-skill/src/cli.mjs capture /path/to/private-semester < /path/to/private-capture.json
node /path/to/course-context-skill/src/cli.mjs sync /path/to/private-semester
```

The [capture contract](skills/course-context/references/source-contract.md) has the field schema and status rules. The runner rejects extra fields, including grades, feedback, message bodies, and submission IDs. It stores a sanitized private snapshot and imports it only once. A reused or older-than-24-hour capture becomes `not_attempted`, not a fresh check. Genuine empty success requires `status: "checked"` and `complete: true`.

Use connected tools, not browser cookies or undocumented API endpoints, for authenticated sources. Email receipts are historical evidence only. Calendar event times remain `event_at`; they cannot become assignment due dates.

## Daily operation

After the first manual run, schedule the same read-only `sync` command **locally** in a trusted environment where your secret manager can supply `CANVAS_TOKEN`. Keep connected-source capture as a separate authenticated step before the sync. If it cannot run, the source stays explicitly stale. Do not put a student-data refresh in a public GitHub Actions schedule or publish generated reports as artifacts.

The skill should inspect the report, verify any new deadline against the live source, update a curated private hub, then tell you only urgent items, meaningful changes, and access gaps. This repository deliberately does not auto-book time: a separate calendar workflow needs verified account identity, fresh busy/free coverage, and explicit authorization.

## Design and limits

- Per-source checkpoints and last-successful records survive an endpoint failure; `blocked` and `not_attempted` are distinct from a checked empty result.
- Canvas follows `Link` pagination, limits pages, rejects cross-origin pagination and redirects, and retries only transient network/429/5xx failures. It sends requests sequentially to avoid unnecessary throttling.
- Public URL checks hash the fetched response and record only its title/URL/hash. They do **not** recursively crawl links or certify that PDFs, images, videos, or every page were deeply read.
- The runner indexes metadata, not assignment descriptions, answers, scores, peer work, or transcripts. Any broader adapter needs a separate privacy and course-policy review.
- Source timestamps reflect captures, not the time the report was rendered. A calendar event is planning context, not an official deadline.
- A course may disable some Canvas endpoints. Those are recorded as access gaps while other sources continue.

See [upgrade decisions](docs/upgrade-decisions.md) for the research-backed changes from the original personal workflow and [contributing](CONTRIBUTING.md) before proposing a new connector.

## Sources behind the design

- [OpenAI: Build skills](https://developers.openai.com/plugins/build/skills) — skill directory, `SKILL.md`, optional references and scripts.
- [Instructure: Canvas pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination) — follow opaque `Link` headers.
- [Instructure: Canvas throttling](https://developerdocs.instructure.com/services/canvas/basics/file.throttling) — retry rate limits and avoid excess parallelism.
- [GitHub: Actions secrets](https://docs.github.com/en/actions/reference/security/secrets) — secrets are not a reason to publish private course output in a public workflow.

MIT licensed. Not affiliated with UC Berkeley, Canvas, Gradescope, or OpenAI.
