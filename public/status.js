const statusEl = document.getElementById('status');
const dbStatusEl = document.getElementById('db-status');

fetch('/api/status', { credentials: 'include' })
  .then((res) => {
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    return res.json();
  })
  .then((data) => {
    if (!data) return;
    statusEl.textContent = `Server OK · uptime ${Math.round(data.uptime)}s`;
    statusEl.classList.add('ok');
    dbStatusEl.textContent = `Database: ${data.database || 'unknown'}`;
    dbStatusEl.classList.add(data.database === 'connected' ? 'ok' : 'err');
  })
  .catch(() => {
    statusEl.textContent = 'Could not reach server';
    statusEl.classList.add('err');
    dbStatusEl.textContent = '';
  });
