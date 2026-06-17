// dashboardService — fetches dashboard data from the live API.
//
// Mirrors the Angular web app exactly:
//   - GET /dashboard returns { success, chartDonut[], chartBar[], tableUsers[] }
//     where chart items are { name, value } and users are
//     { firstName, lastName, username }.
//   - Only the donut chart consumes live API data (chartDonut). The bar chart
//     and the user table are hard-coded to match the design spec, identical to
//     the Angular DashboardComponent defaults.

const API_BASE = 'http://test-demo.aemenersol.com/api';
const DASHBOARD_ENDPOINT = `${API_BASE}/dashboard`;

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

async function getDashboard(token) {
  const res = await fetch(DASHBOARD_ENDPOINT, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (res.status === 401) {
    // Token rejected/expired — signal the renderer to force re-authentication,
    // matching the Angular dashboard's 401 handling.
    return { success: false, status: 401 };
  }

  if (!res.ok) {
    return { success: false, status: res.status };
  }

  const data = await res.json();

  return {
    success: true,
    // Live donut data straight from the API (array of { name, value }).
    chartDonut: Array.isArray(data.chartDonut) ? data.chartDonut : [],
    // Bar chart and table use the fixed values per the design spec.
    chartBar: STATIC_BAR,
    tableUsers: STATIC_TABLE
  };
}

module.exports = { getDashboard };
