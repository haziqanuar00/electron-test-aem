const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const authService = require('./src/services/authService');
const dashboardService = require('./src/services/dashboardService');

const isDev = process.argv.includes('--dev');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'login.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC handlers — the renderer never touches Node, the network, or PouchDB
// directly. Everything funnels through these channels.
// ---------------------------------------------------------------------------

ipcMain.handle('auth:login', async (_event, credentials) => {
  return authService.login(credentials);
});

ipcMain.handle('auth:logout', async () => {
  return authService.logout();
});

ipcMain.handle('auth:current', async () => {
  return authService.getCurrentSession();
});

ipcMain.handle('dashboard:data', async () => {
  const token = authService.getToken();
  try {
    return await dashboardService.getDashboard(token);
  } catch (err) {
    // Network/parse failure (e.g. offline). The renderer shows an error,
    // matching the Angular dashboard's error branch.
    return { success: false, status: 0, message: err.message };
  }
});

// Navigation requested by the renderer after a successful login / logout.
ipcMain.handle('app:navigate', async (_event, page) => {
  if (!mainWindow) return;
  const target = page === 'dashboard' ? 'dashboard.html' : 'login.html';
  await mainWindow.loadFile(path.join(__dirname, 'src', target));
});

app.whenReady().then(() => {
  // A strict Content Security Policy for the renderer.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'"
        ]
      }
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
