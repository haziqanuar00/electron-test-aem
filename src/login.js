// Renderer script for the sign-in screen. Talks only to window.api (preload).
// Validation mirrors the Angular SignInComponent:
//   - username: required, valid email
//   - password: required, min length 6

const form = document.getElementById('login-form');
const btn = document.getElementById('login-btn');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const usernameError = document.getElementById('username-error');
const passwordError = document.getElementById('password-error');
const errorEl = document.getElementById('error-message');
const noteEl = document.getElementById('status-note');

// Same email pattern Angular's Validators.email uses.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

let submitting = false;

function setLoading(loading) {
  submitting = loading;
  btn.disabled = loading;
  btn.textContent = loading ? 'SIGNING IN...' : 'SIGN IN';
}

function showFieldError(inputEl, errorEl, message) {
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    inputEl.classList.add('is-invalid');
  } else {
    errorEl.hidden = true;
    inputEl.classList.remove('is-invalid');
  }
}

// Returns the validation message for a field, or '' if valid.
function validateUsername() {
  const value = usernameEl.value.trim();
  if (!value) return 'Username is required.';
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address.';
  return '';
}

function validatePassword() {
  const value = passwordEl.value;
  if (!value) return 'Password is required.';
  if (value.length < 6) return 'Password must be at least 6 characters.';
  return '';
}

function clearFormError() {
  errorEl.hidden = true;
  noteEl.hidden = true;
}

// Re-validate on blur so the user gets feedback like the Angular touched state.
usernameEl.addEventListener('blur', () =>
  showFieldError(usernameEl, usernameError, validateUsername())
);
passwordEl.addEventListener('blur', () =>
  showFieldError(passwordEl, passwordError, validatePassword())
);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return;
  clearFormError();

  const usernameMsg = validateUsername();
  const passwordMsg = validatePassword();
  showFieldError(usernameEl, usernameError, usernameMsg);
  showFieldError(passwordEl, passwordError, passwordMsg);

  if (usernameMsg || passwordMsg) return;

  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  setLoading(true);
  try {
    const result = await window.api.login({ username, password });

    if (result.success) {
      if (result.source === 'offline') {
        noteEl.textContent = 'Signed in offline using cached credentials.';
        noteEl.hidden = false;
      }
      await window.api.navigate('dashboard');
    } else {
      // Mirror Angular's two-message scheme: only genuine credential errors
      // (400/401) get the generic "invalid email or password" message. Any
      // other failure — a 5xx from the API, an offline message, etc. — shows
      // the actual message so the user isn't misled into rechecking a correct
      // password during a server outage.
      errorEl.textContent =
        result.status === 400 || result.status === 401
          ? 'Invalid email or password. Please try again.'
          : result.message || 'Something went wrong. Please try again later.';
      errorEl.hidden = false;
    }
  } catch (err) {
    errorEl.textContent = 'Something went wrong. Please try again later.';
    errorEl.hidden = false;
  } finally {
    setLoading(false);
  }
});
