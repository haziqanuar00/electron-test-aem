# AEM Enersol — Electron Interview Test

A native desktop application built with [Electron](https://www.electronjs.org/).
The user must log in before the application opens. Credentials are authenticated
against the live AEM test API, with [PouchDB](https://pouchdb.com/) providing an
offline-validation fallback.

## Features

- **Login gate** — the dashboard is unreachable until the user authenticates.
- **Live API auth** — `POST http://test-demo.aemenersol.com/api/account/login`
  with `{ username, password }`; the returned JWT (a quoted plain-text string)
  is unwrapped and held in the main process.
- **PouchDB offline fallback** — every successful login caches the user and a
  salted SHA-256 password hash. If the API is unreachable, the entered
  credentials are validated against this local cache so the user can still sign in.
- **Dashboard** with three widgets:
  - **Donut chart** — live data from `GET /dashboard` (Bearer token), with a
    local fallback if offline.
  - **Bar chart** — hard-coded to match the wireframes.
  - **User table** — hard-coded to match the wireframes.
- **Secure architecture** — `contextIsolation: true`, `nodeIntegration: false`,
  a strict Content Security Policy, and all network/DB access confined to the
  main process behind a minimal `preload` bridge.

## Project structure

```
aem-electron-test/
├── main.js                     Electron main process + IPC handlers
├── preload.js                  Secure contextBridge API
├── package.json
└── src/
    ├── login.html / login.js   Login screen
    ├── dashboard.html / .js     Dashboard screen
    ├── styles.css
    ├── vendor/chart.umd.js      Local Chart.js (CSP blocks CDNs)
    └── services/
        ├── authService.js       Login + PouchDB caching/fallback
        └── dashboardService.js  Dashboard data (live donut + static rest)
```

## Getting started

```bash
npm install
npm start
```

For development tools (DevTools auto-open):

```bash
npm run dev
```

To package a Windows installer:

```bash
npm run dist
```

## How authentication flows

1. The renderer calls `window.api.login({ username, password })` (preload bridge).
2. `authService.login()` posts to `/account/login`.
   - **Success** → strip the quotes off the JWT, store it in the in-memory
     session, and cache the user in PouchDB. Navigate to the dashboard.
   - **Invalid credentials** (HTTP 4xx) → show an error.
   - **Network error** → validate against the PouchDB cache (offline fallback).
3. The dashboard route checks the session on load and redirects to login if
   there is no token (auth guard).

## Notes

- The bar chart and user table are intentionally hard-coded to match the
  wireframes; only the donut chart renders live `/dashboard` data.
- The PouchDB database is stored under Electron's `userData` directory and
  persists across restarts.
