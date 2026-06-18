// authService — owns authentication. Lives in the main process only.

const crypto = require('crypto');
const PouchDB = require('pouchdb');
const path = require('path');
const { app, safeStorage } = require('electron');
const { API_BASE } = require('../config');

const LOGIN_ENDPOINT = `${API_BASE}/account/login`;

// PBKDF2 tuning. 210k SHA-256 iterations follows current OWASP guidance.
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SALT_BYTES = 16;

// Persist the database under Electron's userData dir so it survives restarts.
const dbPath = path.join(app.getPath('userData'), 'aem-users-db');
const usersDB = new PouchDB(dbPath);

// In-memory session for the running app instance.
let session = { token: null, username: null };

// --- Password hashing (PBKDF2 + random per-user salt) 

function derive(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
}


function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = derive(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

// Constant-time verification against a stored hash string.
function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actual = crypto
    .pbkdf2Sync(password, salt, iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');

  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Token encryption at rest (Electron safeStorage) -----------------------

function encryptToken(token) {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      token: safeStorage.encryptString(token).toString('base64'),
      tokenEnc: 'safeStorage'
    };
  }
  // No OS-backed encryption (rare; e.g. some headless Linux). Store plaintext
  // but flag it so we never try to decrypt something that wasn't encrypted.
  return { token, tokenEnc: 'plain' };
}

function decryptToken(doc) {
  if (!doc || !doc.token) return null;
  if (doc.tokenEnc === 'safeStorage') {
    try {
      return safeStorage.decryptString(Buffer.from(doc.token, 'base64'));
    } catch {
      return null;
    }
  }
  return doc.token;
}

// --- JWT expiry -------------------------------------------------------------

// Decode the JWT payload without verifying the signature (we only need `exp`).
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// True when the token carries an `exp` claim that is already in the past.
function isTokenExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return false; // no exp => can't judge
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp <= nowSeconds;
}

// --- PouchDB helpers --------------------------------------------------------

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

  const { token: storedToken, tokenEnc } = encryptToken(token);
  const doc = {
    _id,
    type: 'user',
    username,
    passwordHash: hashPassword(password),
    token: storedToken,
    tokenEnc,
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

  if (!verifyPassword(password, doc.passwordHash)) {
    return { ok: false, reason: 'BAD_PASSWORD' };
  }

  const token = decryptToken(doc);
  if (!token) {
    return { ok: false, reason: 'NO_TOKEN' };
  }
  if (isTokenExpired(token)) {
    // An expired token would pass the password check, then 401 on the first
    // API call and force an immediate logout. Reject it up front instead.
    return { ok: false, reason: 'TOKEN_EXPIRED' };
  }

  return { ok: true, token, username };
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
      // Surface the real HTTP status so the renderer can distinguish a
      // credential error (400/401) from a server-side failure (5xx).
      return {
        success: false,
        status: res.status,
        message:
          res.status === 400 || res.status === 401
            ? 'Invalid username or password.'
            : `Login failed (server returned ${res.status}).`,
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
        : offline.reason === 'TOKEN_EXPIRED'
        ? 'Your offline session has expired. Please reconnect to sign in again.'
        : 'Invalid username or password (offline).';
    return { success: false, message, source: 'offline' };
  }
}

// Remove a user's cached credentials and token from PouchDB. Used by logout so
// "Sign Out" is a true "forget me" on this device.
async function clearCachedUser(username) {
  if (!username) return;
  try {
    const doc = await usersDB.get(userDocId(username));
    await usersDB.remove(doc);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

async function logout() {
  const { username } = session;
  session = { token: null, username: null };
  try {
    await clearCachedUser(username);
  } catch {
    // Best-effort: an in-memory session is already cleared, so a failed
    // cache purge must not block the user from signing out.
  }
  return { success: true };
}

function getToken() {
  return session.token;
}

function getCurrentSession() {
  return { username: session.username, authenticated: Boolean(session.token) };
}

module.exports = { login, logout, getToken, getCurrentSession, usersDB };
