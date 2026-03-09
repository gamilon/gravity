const statusEl = document.getElementById('status');

fetch('/api/status')
  .then((res) => res.json())
  .then((data) => {
    statusEl.textContent = `Server OK · uptime ${Math.round(data.uptime)}s`;
    statusEl.classList.add('ok');
  })
  .catch(() => {
    statusEl.textContent = 'Could not reach server';
    statusEl.classList.add('err');
  });
