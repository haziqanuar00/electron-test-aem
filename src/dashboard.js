// Renderer script for the dashboard. Pulls data via window.api and renders
// three widgets, mirroring the Angular DashboardComponent:
//   - a live donut (pie) chart from the API's chartDonut
//   - a hard-coded bar chart (names A–G)
//   - a hard-coded user table (First Name / Last Name / User Name)

const logoutBtn = document.getElementById('logout-btn');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const contentEl = document.getElementById('dashboard-content');

// Gray ordinal scheme, same domain as Angular's colorScheme.
const COLOR_DOMAIN = ['#9e9e9e', '#bdbdbd', '#8a8a8a', '#cfcfcf', '#a8a8a8', '#b8b8b8'];

async function logout() {
  await window.api.logout();
  await window.api.navigate('login');
}

logoutBtn.addEventListener('click', logout);

function renderDonut(items) {
  const ctx = document.getElementById('donut-chart');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.name),
      datasets: [
        {
          data: items.map((i) => i.value),
          backgroundColor: items.map((_, idx) => COLOR_DOMAIN[idx % COLOR_DOMAIN.length]),
          borderWidth: 1,
          borderColor: '#ffffff'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '50%', // arcWidth 0.35 ≈ doughnut hole
      plugins: { legend: { position: 'bottom', labels: { color: '#555555' } } }
    }
  });
}

function renderBar(items) {
  const ctx = document.getElementById('bar-chart');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map((i) => i.name),
      datasets: [
        {
          data: items.map((i) => i.value),
          backgroundColor: items.map((_, idx) => COLOR_DOMAIN[idx % COLOR_DOMAIN.length]),
          borderRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, grid: { display: false } }
      }
    }
  });
}

function renderTable(rows) {
  const tbody = document.getElementById('user-table-body');
  tbody.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="empty">No users found.</td>';
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((u, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-index">${i + 1}</td>
      <td>${u.firstName}</td>
      <td>${u.lastName}</td>
      <td>${u.username}</td>`;
    tbody.appendChild(tr);
  });
}

function showError(message) {
  loadingEl.hidden = true;
  contentEl.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function init() {
  const session = await window.api.currentSession();
  if (!session.authenticated) {
    // Guard: never show the dashboard without a session.
    await window.api.navigate('login');
    return;
  }

  const data = await window.api.getDashboard();

  if (!data.success) {
    if (data.status === 401) {
      // Token rejected/expired — force re-authentication, like Angular.
      await logout();
      return;
    }
    showError('Failed to load dashboard data. Please try again.');
    return;
  }

  loadingEl.hidden = true;
  contentEl.hidden = false;

  renderDonut(data.chartDonut);
  renderBar(data.chartBar);
  renderTable(data.tableUsers);
}

init();
