# Course Context

A Codex skill and small local runner for a source-backed school index. It helps answer “what changed?”, “what is due?”, and “which sources could not be checked?” without publishing your coursework, grades, or credentials.

The public repository is a **portable starter**, not a copy of anyone's private semester folder. It reads Canvas course metadata, assignments, announcements, modules, pages, files, quizzes, discussions, and course calendar events; checks configured public URLs for content changes; and accepts tightly scoped captures from connected tools. It does **not** log in to Gmail, Gradescope, Drive, or a browser by itself, extract lecture transcripts, submit work, or create calendar events.

## Five-minute onboarding

1. Install Node.js 22. On macOS/Linux, clone and test the repository:

   ```bash
   git clone https://github.com/stephenhungg/course-context-skill.git
   cd course-context-skill
   node --version
   npm test
   ```

   Confirm the version starts with `v22.` before continuing. The runner has no package dependencies.
2. Install the skill by linking the cloned folder into your Codex skills directory:

   ```bash
   mkdir -p ~/.codex/skills
   ln -s "$PWD/skills/course-context" ~/.codex/skills/course-context
   ```

   If the destination already exists, inspect it rather than overwriting it. On another platform, copy the `skills/course-context` folder to the corresponding Codex skills directory. Restart/reload Codex if needed for discovery. Invoke it as `$course-context` or ask to refresh your course index.
3. Make a private semester workspace outside the public repository. Run:

   ```bash
   node /path/to/course-context-skill/src/cli.mjs init /path/to/private-semester
   ```

4. Edit `/path/to/private-semester/.course-context/config.json`: replace the example Canvas origin and course ID (the number in a Canvas `/courses/12345` URL); set the term's first and last dates, inclusive; add every course slug and each public/connected source you want tracked. Keep the config and all generated files private. The example values cannot be used for a live sync.
5. Run `node /path/to/course-context-skill/src/cli.mjs check /path/to/private-semester`. This validates the config without network access, checks file permissions, and confirms `.course-context/` is Git-ignored and untracked when the workspace is in another repository. If it reports `private_dir_not_gitignored`, add `.course-context/` to that workspace's `.gitignore` before continuing. If it reports `private_dir_tracked_in_git`, stop and inspect that repository's index/history before doing anything else; an ignore rule cannot undo an earlier commit. Keep the ignore rule in place.
6. Supply a Canvas token locally as `CANVAS_TOKEN` through your shell or secret manager, then run:

   ```bash
   node /path/to/course-context-skill/src/cli.mjs sync /path/to/private-semester
   ```

   The command only sends authenticated **GET** requests to the configured Canvas origin. It never puts the token in a URL or output file. Do not paste tokens into chat, commands, GitHub issues, or config files. Without a token, Canvas sources are marked `not_attempted` while public sources still run.
7. Review the private `.course-context/report.md`, `index.md`, and `runs/<run-id>/state.json`. For `sync`, exit `0` means all registered sources checked; `2` means a completed partial run; `1` means local setup or processing failed. On `1`, inspect the current run checkpoint—do not assume the prior `state.json` is this attempt. For `check`, exit `2` means a privacy warning that must be fixed before capture or sync.

The generated index is evidence, not a polished study plan. Keep your own notes and confirmed deadlines in a separate curated hub; do not edit generated files. On the first run, “added” means a baseline, not necessarily newly released material.

If you configured this starter before version 0.2, add `term_window` to your private config before the next sync, for example `"term_window": { "start_date": "2026-08-15", "end_date": "2026-12-31" }`. The runner will reject a missing window rather than treating Canvas's today-only calendar default as semester coverage.

### Already have a course-index workflow?

You do not need to replace it with this starter runner. Install the skill, open your existing semester workspace, and ask Codex to use `$course-context` for a refresh. The skill reads a local `course-index-workflow.md` first and follows that workspace's stricter source registry, connector procedures, and runner. Keep its private caches and credentials where they are. The generic `init`/`sync` commands above are for a new portable workspace; they do not migrate or recreate an existing multi-connector setup automatically.

## Connected-source captures

Register a source under `connected_sources`, then verify the signed-in account, exact course, and complete result through your authorized tool. Send only the minimal JSON envelope to the runner's standard input:

```bash
node /path/to/course-context-skill/src/cli.mjs capture /path/to/private-semester < /path/to/private-capture.json
node /path/to/course-context-skill/src/cli.mjs sync /path/to/private-semester
```

The [capture contract](skills/course-context/references/source-contract.md) has the field schema and status rules. The runner rejects extra fields, including grades, feedback, message bodies, and submission IDs. It stores a sanitized private snapshot and imports it only once. A reused or older-than-24-hour capture becomes `not_attempted`, not a fresh check. Genuine empty success requires `status: "checked"` and `complete: true`.

Use connected tools, not browser cookies or undocumented API endpoints, for authenticated sources. Email receipts are historical evidence only. Timed calendar events retain the source offset in `event_at`; all-day events use `event_date`. Neither becomes an assignment due date.

## Daily operation

After the first manual run, schedule the same read-only `sync` command **locally** in a trusted environment where your secret manager can supply `CANVAS_TOKEN`. Keep connected-source capture as a separate authenticated step before the sync. If it cannot run, the source stays explicitly stale. Do not put a student-data refresh in a public GitHub Actions schedule or publish generated reports as artifacts.

The skill should inspect the report, verify any new deadline against the live source, update a curated private hub, then tell you only urgent items, meaningful changes, and access gaps. This repository deliberately does not auto-book time: a separate calendar workflow needs verified account identity, fresh busy/free coverage, and explicit authorization.

## Design and limits

- Per-source checkpoints and last-successful records survive an endpoint failure; `blocked` and `not_attempted` are distinct from a checked empty result.
- Canvas follows `Link` pagination, limits each source to 75 seconds, 100 pages, 10,000 items, and 2 MB per response, rejects cross-origin pagination and redirects, and retries only transient network/429/5xx failures. It stops the source when a rate-limit response asks for a delay beyond its bounded wait. Requests are sequential to avoid unnecessary throttling.
- Canvas calendar events use the configured semester window. Without it, Canvas defaults the listing to today, so the runner refuses an incomplete term configuration.
- Public URL checks hash the fetched response and record only its title/URL/hash. They do **not** recursively crawl links or certify that PDFs, images, videos, or every page were deeply read.
- The runner indexes metadata, not assignment descriptions, answers, scores, peer work, or transcripts. Any broader adapter needs a separate privacy and course-policy review.
- Source timestamps reflect captures, not the time the report was rendered. Assignment due values can have section or individual overrides; verify the live assignment page before treating one as your personal deadline. A calendar event is planning context, not an official deadline.
- A course may disable some Canvas endpoints. Those are recorded as access gaps while other sources continue.

See [upgrade decisions](docs/upgrade-decisions.md) for the research-backed changes from the original personal workflow and [contributing](CONTRIBUTING.md) before proposing a new connector.

## Sources behind the design

- [OpenAI: Build skills](https://developers.openai.com/plugins/build/skills) — skill directory, `SKILL.md`, optional references and scripts.
- [Instructure: Canvas pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination) — follow opaque `Link` headers.
- [Instructure: Canvas throttling](https://developerdocs.instructure.com/services/canvas/basics/file.throttling) — retry rate limits and avoid excess parallelism.
- [GitHub: Actions secrets](https://docs.github.com/en/actions/reference/security/secrets) — secrets are not a reason to publish private course output in a public workflow.

MIT licensed. Not affiliated with UC Berkeley, Canvas, Gradescope, or OpenAI.
