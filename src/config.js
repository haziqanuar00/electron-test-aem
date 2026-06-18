// Shared configuration. Keeping environment-specific values in one place means
// switching the API host (e.g. staging vs production) is a single-line change
// instead of hunting through every service file.

const API_BASE =
  process.env.AEM_API_BASE || 'http://test-demo.aemenersol.com/api';

module.exports = { API_BASE };
