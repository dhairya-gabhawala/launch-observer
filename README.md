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

## Load in Chrome / Edge (Unpacked)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `launch-observer`.

## Load in Firefox (Temporary)
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from `launch-observer`.

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
- Requests are stored in `chrome.storage.local` and capped by `maxEntries`.
- Allowlist matches exact domain or any subdomain.
- The UI entrypoint is `pages/app/main.js` (loaded as an ES module).

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
