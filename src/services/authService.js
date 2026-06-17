// authService — owns authentication. Lives in the main process only.
//
// Login strategy (per project requirements):
//   1. Try the live AEM API:  POST /account/login -> JWT string.
//   2. On success, cache the user + a password hash in PouchDB so the same
//      user can log in again while offline.
//   3. If the network is unreachable, validate the entered credentials
//      against the PouchDB cache instead (offline fallback).

const crypto = require('crypto');
const PouchDB = require('pouchdb');
const path = require('path');
const { app } = require('electron');

const API_BASE = 'http://test-demo.aemenersol.com/api';
const LOGIN_ENDPOINT = `${API_BASE}/account/login`;

// Persist the database under Electron's userData dir so it survives restarts.
const dbPath = path.join(app.getPath('userData'), 'aem-users-db');
const usersDB = new PouchDB(dbPath);

// In-memory session for the running app instance.
let session = { token: null, username: null };

function hashPassword(password) {
  // Deterministic salted hash so offline validation can compare without
  // ever storing the plaintext password.
  return crypto
    .createHash('sha256')
    .update(`aem::${password}`)
    .digest('hex');
}

function userDocId(username) {
  return `user:${username.toLowerCase()}`;
}

// Store / refresh a user's cached credentials after a successful API login.
async function cacheUser(username, password, token) {
  const _id = userDocId(username);
  let existing = null;
  try {
    existing = await usersDB.get(_id);
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const doc = {
    _id,
    type: 'user',
    username,
    passwordHash: hashPassword(password),
    token,
    updatedAt: new Date().toISOString()
  };
  if (existing) doc._rev = existing._rev;

  await usersDB.put(doc);
}

// Offline fallback: check entered credentials against the PouchDB cache.
async function validateOffline(username, password) {
  let doc;
  try {
    doc = await usersDB.get(userDocId(username));
  } catch (err) {
    if (err.status === 404) {
      return { ok: false, reason: 'NO_CACHED_USER' };
    }
    throw err;
  }

  if (doc.passwordHash === hashPassword(password)) {
    return { ok: true, token: doc.token, username };
  }
  return { ok: false, reason: 'BAD_PASSWORD' };
}

function isNetworkError(err) {
  // fetch throws a TypeError ("Failed to fetch" / ENOTFOUND / timeout) when
  // the host can't be reached — treat those as "go offline".
  return (
    err instanceof TypeError ||
    /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(
      err.message || ''
    )
  );
}

async function login({ username, password }) {
  if (!username || !password) {
    return { success: false, message: 'Username and password are required.' };
  }

  try {
    const res = await fetch(LOGIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      // 400/401 from the API => genuinely invalid credentials.
      return {
        success: false,
        message: 'Invalid username or password.',
        source: 'api'
      };
    }

    // The API returns the JWT as a quoted plain-text string.
    const raw = (await res.text()).trim();
    const token = raw.replace(/^"|"$/g, '');

    session = { token, username };
    await cacheUser(username, password, token);

    return { success: true, token, username, source: 'api' };
  } catch (err) {
    if (!isNetworkError(err)) {
      return { success: false, message: `Login failed: ${err.message}` };
    }

    // ---- Offline path: validate against PouchDB ----
    const offline = await validateOffline(username, password);
    if (offline.ok) {
      session = { token: offline.token, username };
      return {
        success: true,
        token: offline.token,
        username,
        source: 'offline'
      };
    }

    const message =
      offline.reason === 'NO_CACHED_USER'
        ? 'You are offline and this account has not been used on this device before.'
        : 'Invalid username or password (offline).';
    return { success: false, message, source: 'offline' };
  }
}

function logout() {
  session = { token: null, username: null };
  return { success: true };
}

function getToken() {
  return session.token;
}

function getCurrentSession() {
  return { username: session.username, authenticated: Boolean(session.token) };
}

module.exports = { login, logout, getToken, getCurrentSession };
