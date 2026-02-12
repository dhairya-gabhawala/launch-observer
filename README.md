# Launch Observer

Browser extension for observing analytics network calls with fully decoded payloads.

## Features
- Allowlist-based capture (default: Adobe Edge).
- Sessions grouped by site with optional tab locking.
- Full request details: domain, URL, method, status, timing, headers, payload.
- Decoded query parameters and request bodies without altering key/value casing.
- JSON payload tree with search, copy path/value, and expand controls.
- URL-encoded payloads displayed as key/value tables.
- Popular services allowlist with custom domain mapping to services.
- UAT assertions per site with pass/fail status, assertions viewer, and PDF-ready report export.

## Load in Chrome / Edge (Unpacked)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `launch-observer`.

## Build Chrome / Edge ZIP
```
npm run build:chrome
```

This generates `dist/chrome.zip` for Chrome Web Store or Edge Add-ons.

## Load in Firefox (Stable)
Firefox Stable requires a Manifest V2 build.

```
npm run build:firefox
```

Then load the generated build:
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist/firefox/manifest.json`.

If you plan to publish to AMO, set a permanent add-on ID in `manifest.firefox.json` under `browser_specific_settings.gecko.id`.

For manual AMO upload, use the generated zip at `dist/firefox.zip` (manifest at zip root).

### Firefox limitations
- Firefox (MV2) does not support `scripting.executeScript` into the MAIN world.
- Some sites with strict CSP can block hook injection, which may prevent capturing `sendBeacon`/204 payload bodies.
- For the most reliable payload capture (especially Adobe WebSDK), use the Chrome/Edge build.

## Build CSS (Tailwind)
```
npm install
npm run build:css
```

## Code Layout
UI code is modularized under `pages/app/`:
- `main.js` — wiring, event listeners, runtime messages
- `state.js` — shared state + DOM element refs
- `allowlist.js` — allowlist UI + services
- `requests.js` — request list + details
- `sessions.js` — sessions UI + behavior
- `payload.js` — JSON rendering + parsing helpers
- `ui.js` — tabs, sidebar, toasts
- `utils.js` — formatting + helpers

Background and content scripts:
- `background/service-worker.js`
- `content/content.js`
- `content/inject.js`

## Notes
- Requests are stored in `chrome.storage.local` and capped by `maxEntries` (default: 2000).
- Allowlist matches exact domain or any subdomain.
- The UI entrypoint is `pages/app/main.js` (loaded as an ES module).
- Hook debug logging can be toggled from the extension page console:
  - `LaunchObserverDebug.enableHookLogging(true)`
  - `LaunchObserverDebug.disableHookLogging()`
  - `LaunchObserverDebug.isHookLoggingEnabled()`

## UAT Assertions
- Import one JSON file per site via the **UAT Assertions** dialog.
- Enable **Perform UAT validations** when starting a session.
- Use **See Assertions** to view and download the current assertion config.
- UAT results appear in request details and in the session UAT report.

### UAT Schema Notes
- `siteId` (required): string identifier for the site.
- `siteName` (optional): human-friendly site label (string).
- `global` (optional): global gates for UAT applicability.
- `global.includeServices` (optional): service IDs to include.
- `global.excludeServices` (optional): service IDs to exclude.
- `global.includeConditions` (optional): conditions that must all pass to run UAT.
- `global.excludeConditions` (optional): conditions that skip UAT when matched.
- `assertions` (required): array of assertion objects.
- `assertion.id` (required): unique string.
- `assertion.title` (optional): string shown in the UI.
- `assertion.description` (optional): string shown in the UI.
- `assertion.conditionsLogic` (optional): `all` or `any` for applicability (default: `all`).
- `assertion.scope` (optional): `request` or `page` (default: `request`).
- `assertion.conditions` (optional): array of applicability condition objects.
- `assertion.validations` (required): array of validation objects (all must pass).
- Validations always use `all` logic (no override).
- `assertion.count` (required only for `scope=page`): `exactly`, `at_least`, or `at_most`.
- `assertion.value` (required only for `scope=page`): number.
- `condition.source` (optional): `payload`, `query`, `headers`, or `raw` (default: `payload`).
- `condition.path` (required unless `source=raw`): string path.
- `condition.operator` (required): string operator.
- `condition.expected` (required for comparison operators): string, number, or array.

## Documentation Site
The GitHub Pages site lives in `docs/` with the landing page at `docs/index.html`
and the privacy policy at `docs/privacy.html`.

## Publishing
This repo includes a GitHub Actions workflow to build and publish a release package.
You must add the required secrets to your GitHub repository before publishing.

### Secrets (Chrome)
- `CHROME_EXTENSION_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

### Secrets (Firefox)
- `FIREFOX_API_KEY`
- `FIREFOX_API_SECRET`

### Secrets (Edge)
Edge publishing requires Microsoft Partner Center API credentials.
Add your chosen secrets and update the Edge step in the workflow accordingly.

### Release
Push a tag like `v0.1.1` or run the workflow manually from GitHub Actions.
