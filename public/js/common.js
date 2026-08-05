(function (global) {
  let csrfToken = '';

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function getCsrfToken() {
    return csrfToken;
  }

  function setCsrfToken(token) {
    csrfToken = token || '';
  }

  function handleAuthStatus(res) {
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (res.status === 403) {
      window.location.href = '/';
      return null;
    }
    return res;
  }

  async function apiFetch(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const res = await fetch(url, Object.assign({}, opts, {
      credentials: 'include',
      headers,
    }));
    if (handleAuthStatus(res) === null) return null;
    return res;
  }

  async function bootstrapSession() {
    const res = await apiFetch('/api/me');
    if (!res) return null;
    const data = await res.json();
    setCsrfToken(data.csrfToken);
    return data;
  }

  async function bootstrapCsrf() {
    const res = await fetch('/api/csrf-token', { credentials: 'include' });
    const data = await res.json();
    setCsrfToken(data.csrfToken);
    return data.csrfToken;
  }

  global.Gravity = {
    escapeHtml,
    getCsrfToken,
    setCsrfToken,
    handleAuthStatus,
    apiFetch,
    bootstrapSession,
    bootstrapCsrf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
