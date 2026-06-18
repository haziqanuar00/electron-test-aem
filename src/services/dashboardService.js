// dashboardService — fetches dashboard data from the live API.
//
// Mirrors the Angular web app exactly:
//   - GET /dashboard returns { success, chartDonut[], chartBar[], tableUsers[] }
//     where chart items are { name, value } and users are
//     { firstName, lastName, username }.
//   - Only the donut chart consumes live API data (chartDonut). The bar chart
//     and the user table are hard-coded to match the design spec, identical to
//     the Angular DashboardComponent defaults.
//
// Offline support: a successful fetch is cached in PouchDB. When the network is
// unreachable we serve that cached snapshot instead of failing outright, so the
// dashboard keeps working offline just like login does.

const { API_BASE } = require('../config');
const { usersDB } = require('./authService');

const DASHBOARD_ENDPOINT = `${API_BASE}/dashboard`;
const CACHE_DOC_ID = 'dashboard:cache';

// Hard-coded bar data — identical to Angular's barData (names A–G).
const STATIC_BAR = [
  { name: 'A', value: 55 },
  { name: 'B', value: 90 },
  { name: 'C', value: 80 },
  { name: 'D', value: 45 },
  { name: 'E', value: 70 },
  { name: 'F', value: 25 },
  { name: 'G', value: 90 }
];

// Hard-coded user table — identical to Angular's tableUsers.
const STATIC_TABLE = [
  { firstName: 'Mark', lastName: 'Otto', username: '@mdo' },
  { firstName: 'Jacob', lastName: 'Throton', username: '@fat' },
  { firstName: 'Larry', lastName: 'theBird', username: '@twitter' }
];

// Persist the latest successful donut data so it can be replayed offline.
async function cacheDashboard(chartDonut) {
  let existing = null;
  try {
    existing = await usersDB.get(CACHE_DOC_ID);
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const doc = {
    _id: CACHE_DOC_ID,
    type: 'dashboard-cache',
    chartDonut,
    updatedAt: new Date().toISOString()
  };
  if (existing) doc._rev = existing._rev;

  await usersDB.put(doc);
}

async function readCachedDashboard() {
  try {
    const doc = await usersDB.get(CACHE_DOC_ID);
    return Array.isArray(doc.chartDonut) ? doc.chartDonut : null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

function isNetworkError(err) {
  return (
    err instanceof TypeError ||
    /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(
      err.message || ''
    )
  );
}

function buildResponse(chartDonut, source) {
  return {
    success: true,
    source,
    // Live donut data straight from the API (array of { name, value }).
    chartDonut,
    // Bar chart and table use the fixed values per the design spec.
    chartBar: STATIC_BAR,
    tableUsers: STATIC_TABLE
  };
}

async function getDashboard(token) {
  let res;
  try {
    res = await fetch(DASHBOARD_ENDPOINT, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  } catch (err) {
    // Network unreachable — fall back to the cached snapshot if we have one.
    if (isNetworkError(err)) {
      const cached = await readCachedDashboard();
      if (cached) return buildResponse(cached, 'cache');
    }
    throw err;
  }

  if (res.status === 401) {
    // Token rejected/expired — signal the renderer to force re-authentication,
    // matching the Angular dashboard's 401 handling.
    return { success: false, status: 401 };
  }

  if (!res.ok) {
    // Server-side failure — serve cached data rather than an error if possible.
    const cached = await readCachedDashboard();
    if (cached) return buildResponse(cached, 'cache');
    return { success: false, status: res.status };
  }

  const data = await res.json();
  const chartDonut = Array.isArray(data.chartDonut) ? data.chartDonut : [];

  // Best-effort cache update; never let a cache write break a live response.
  try {
    await cacheDashboard(chartDonut);
  } catch {
    /* ignore cache write failures */
  }

  return buildResponse(chartDonut, 'api');
}

module.exports = { getDashboard };
