(async function () {
  const { apiFetch, bootstrapSession, escapeHtml } = Gravity;

  const tbody = document.getElementById('tokens-tbody');
  const nameInput = document.getElementById('name');
  const createBtn = document.getElementById('create');
  const newTokenBox = document.getElementById('new-token-box');

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  async function loadTokens() {
    const res = await apiFetch('/api/tokens');
    if (!res) return;
    const data = await res.json();
    if (!data.tokens || data.tokens.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">No tokens yet. Create one above.</td></tr>';
      return;
    }
    tbody.innerHTML = data.tokens.map((t) => `
      <tr>
        <td>${escapeHtml(t.name)}</td>
        <td><span class="prefix">${escapeHtml(t.token_prefix)}…</span></td>
        <td>${formatDate(t.last_used_at)}</td>
        <td><button type="button" class="revoke" data-id="${t.id}">Revoke</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.revoke').forEach((btn) => {
      btn.addEventListener('click', () => revoke(parseInt(btn.dataset.id, 10)));
    });
  }

  async function revoke(id) {
    if (!confirm('Revoke this token? It will stop working immediately.')) return;
    const res = await apiFetch('/api/tokens/' + id, { method: 'DELETE' });
    if (res && res.ok) loadTokens();
  }

  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      const res = await apiFetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res) return;
      const data = await res.json();
      nameInput.value = '';
      newTokenBox.classList.remove('is-hidden');
      if (data.token) {
        newTokenBox.innerHTML = '<strong>Copy this token now;</strong> it won’t be shown again.<br><code>' + escapeHtml(data.token) + '</code>';
        loadTokens();
      } else if (data.error) {
        newTokenBox.innerHTML = '<span class="error">' + escapeHtml(data.error) + '</span>';
      }
    } finally {
      createBtn.disabled = false;
    }
  });

  await bootstrapSession();
  await loadTokens().catch(() => {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Failed to load.</td></tr>';
  });
})();
