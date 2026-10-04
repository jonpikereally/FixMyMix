# FixMyMix — notes for Claude

## Error codes (required)

Every error a person can see must carry a code, so it can be troubleshot by pasting it into an LLM.

- Codes live in one table, `public/js/errors.js` (shared by the server, the pages and the menu-bar app). Format `FMM-<area letter><two digits>`; never reuse or renumber a code, add a new one.
- Server: `throw new ApiError(status, message, 'slug')` or `new StoreError('slug', message)`; responses then carry `errorCode` and `help`.
- Every error text also has hover text (`title`) pointing to the error list page, plus a visible Help link to `/errors#<code>` for touch screens.
- Pages: show errors with `showError(errorOrSlug)` (popups) or `renderError(element, errorOrSlug)` (inline text) from `net.js`; both add the code, the hover text and the Help link. Never `toast(..., { error: true })`, never format an error by hand with `withCode()`/`describeError()` in a page, throw `codedError('slug')` (never `new Error()`). Static error text in HTML needs `data-error-code`, `title=errorTitle(code)` and a Help link.
- Menu-bar app and log lines: `withCode(message, ERRORS.slug.code)` / `describeError(error)`; menu items showing an error get a `toolTip` pointing to the list.
- The list is public: `docs/ERRORS.md` in this public repo (`ERRORS_DOC_URL`), one heading per code so `helpUrl(code)` links to it. The app serves the same list offline at `/errors`. Never put the admin passcode or other secrets in error text or help.
- After changing the table, run `npm run errors:doc` to regenerate `docs/ERRORS.md`.
- `test/errors.test.js` fails on an unknown slug, an ApiError without a slug, an uncoded toast, hand-formatted or hover-less error text in the pages or HTML, `new Error()` in the pages/updater, or a stale `docs/ERRORS.md`.

## Working conventions

- `npm test` runs the unit tests (zero-dependency Node 22).
- Bump `version` in `package.json` (and `package-lock.json`) for each release; the release workflow tags `v<version>`.
