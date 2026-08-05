(async function () {
  const { apiFetch, bootstrapSession, escapeHtml } = Gravity;

  const deviceTbody = document.getElementById('device-tbody');
  const adminTbody = document.getElementById('admin-tbody');
  const adminSection = document.getElementById('admin-tokens-section');
  const deviceNameInput = document.getElementById('device-name');
  const adminNameInput = document.getElementById('admin-name');
  const createDeviceBtn = document.getElementById('create-device');
  const createAdminBtn = document.getElementById('create-admin');
  const newTokenBox = document.getElementById('new-token-box');
  const showAll = document.getElementById('show-all');

  let isAdmin = false;

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  function showNewToken(data) {
    newTokenBox.classList.remove('is-hidden');
    if (data.token) {
      newTokenBox.innerHTML =
        '<strong>Copy this token now;</strong> it won’t be shown again.<br><code>' +
        escapeHtml(data.token) +
        '</code>';
    } else if (data.error) {
      newTokenBox.innerHTML = '<span class="error">' + escapeHtml(data.error) + '</span>';
    }
  }

  async function revoke(id, reload) {
    if (!confirm('Revoke this token? It will stop working immediately.')) return;
    const res = await apiFetch('/api/tokens/' + id, { method: 'DELETE' });
    if (res && res.ok) reload();
  }

  async function loadDeviceTokens() {
    const res = await apiFetch('/api/tokens?kind=device');
    if (!res) return;
    const data = await res.json();
    if (!data.tokens || data.tokens.length === 0) {
      deviceTbody.innerHTML =
        '<tr><td colspan="4" class="empty">No device tokens yet. Create one above for each iSpindel.</td></tr>';
      return;
    }
    deviceTbody.innerHTML = data.tokens
      .map(
        (t) => `
      <tr>
        <td>${escapeHtml(t.name)}</td>
        <td><span class="prefix">${escapeHtml(t.token_prefix)}…</span></td>
        <td>${formatDate(t.last_used_at)}</td>
        <td><button type="button" class="revoke" data-id="${t.id}">Revoke</button></td>
      </tr>`
      )
      .join('');
    deviceTbody.querySelectorAll('.revoke').forEach((btn) => {
      btn.addEventListener('click', () => revoke(parseInt(btn.dataset.id, 10), loadDeviceTokens));
    });
  }

  async function loadAdminTable() {
    if (!isAdmin) return;
    const qs = showAll.checked ? '?all=1' : '?kind=admin';
    const res = await apiFetch('/api/tokens' + qs);
    if (!res) return;
    const data = await res.json();
    const rows = (data.tokens || []).filter((t) => showAll.checked || t.kind === 'admin');
    if (rows.length === 0) {
      adminTbody.innerHTML = '<tr><td colspan="6" class="empty">No tokens to show.</td></tr>';
      return;
    }
    adminTbody.innerHTML = rows
      .map(
        (t) => `
      <tr>
        <td>${escapeHtml(t.name)}</td>
        <td>${escapeHtml(t.owner_username || '—')}</td>
        <td>${escapeHtml(t.kind)}</td>
        <td><span class="prefix">${escapeHtml(t.token_prefix)}…</span></td>
        <td>${formatDate(t.last_used_at)}</td>
        <td><button type="button" class="revoke" data-id="${t.id}">Revoke</button></td>
      </tr>`
      )
      .join('');
    adminTbody.querySelectorAll('.revoke').forEach((btn) => {
      btn.addEventListener('click', () => revoke(parseInt(btn.dataset.id, 10), loadAdminTable));
    });
  }

  async function createToken(name, kind) {
    const res = await apiFetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind }),
    });
    if (!res) return null;
    return res.json();
  }

  createDeviceBtn.addEventListener('click', async () => {
    const name = deviceNameInput.value.trim();
    if (!name) return;
    createDeviceBtn.disabled = true;
    try {
      const data = await createToken(name, 'device');
      if (!data) return;
      deviceNameInput.value = '';
      showNewToken(data);
      if (data.token) {
        await loadDeviceTokens();
        if (isAdmin) await loadAdminTable();
      }
    } finally {
      createDeviceBtn.disabled = false;
    }
  });

  createAdminBtn.addEventListener('click', async () => {
    const name = adminNameInput.value.trim();
    if (!name) return;
    createAdminBtn.disabled = true;
    try {
      const data = await createToken(name, 'admin');
      if (!data) return;
      adminNameInput.value = '';
      showNewToken(data);
      if (data.token) await loadAdminTable();
    } finally {
      createAdminBtn.disabled = false;
    }
  });

  showAll.addEventListener('change', () => loadAdminTable());

  const session = await bootstrapSession();
  isAdmin = !!(session && session.user && (session.user.groups || []).includes('admin'));
  if (isAdmin) {
    adminSection.classList.remove('is-hidden');
  }

  await loadDeviceTokens().catch(() => {
    deviceTbody.innerHTML = '<tr><td colspan="4" class="empty">Failed to load.</td></tr>';
  });
  if (isAdmin) {
    await loadAdminTable().catch(() => {
      adminTbody.innerHTML = '<tr><td colspan="6" class="empty">Failed to load.</td></tr>';
    });
  }
})();
