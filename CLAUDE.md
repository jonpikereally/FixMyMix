# FixMyMix — notes for Claude

## Error codes (required)

Every error a person can see must carry a code, so it can be troubleshot by pasting it into an LLM.

- Codes live in one table, `public/js/errors.js` (shared by the server, the pages and the menu-bar app). Format `FMM-<area letter><two digits>`; never reuse or renumber a code, add a new one.
- Server: `throw new ApiError(status, message, 'slug')` or `new StoreError('slug', message)`; responses then carry `errorCode` and `help`.
- Pages: show errors with `showError(errorOrSlug)` from `net.js` (never `toast(..., { error: true })`), throw `codedError('slug')` (never `new Error()`), and put static error text through `withCode()`.
- Menu-bar app and log lines: `withCode(message, ERRORS.slug.code)` / `describeError(error)`.
- After changing the table, run `npm run errors:doc` to regenerate `docs/ERRORS.md`.
- `test/errors.test.js` fails on an unknown slug, an ApiError without a slug, an uncoded toast or `new Error()` in the pages/updater, or a stale `docs/ERRORS.md`.

## Working conventions

- `npm test` runs the unit tests (zero-dependency Node 22).
- Bump `version` in `package.json` (and `package-lock.json`) for each release; the release workflow tags `v<version>`.
