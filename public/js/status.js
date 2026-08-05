(async function () {
  const { apiFetch } = Gravity;
  const statusEl = document.getElementById('status');
  const dbStatusEl = document.getElementById('db-status');

  try {
    const res = await apiFetch('/api/status');
    if (!res) return;
    const data = await res.json();
    statusEl.textContent = `Server OK · uptime ${Math.round(data.uptime)}s`;
    statusEl.classList.add('ok');
    dbStatusEl.textContent = `Database: ${data.database || 'unknown'}`;
    dbStatusEl.classList.add(data.database === 'connected' ? 'ok' : 'err');
  } catch (_e) {
    statusEl.textContent = 'Could not reach server';
    statusEl.classList.add('err');
    dbStatusEl.textContent = '';
  }
})();
