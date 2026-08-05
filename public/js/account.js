(async function () {
  const { apiFetch, bootstrapSession } = Gravity;

  const usernameEl = document.getElementById('acct-username');
  const groupsEl = document.getElementById('acct-groups');
  const statusEl = document.getElementById('acct-status');
  const pwForm = document.getElementById('pw-form');
  const pwCurrent = document.getElementById('pw-current');
  const pwNew = document.getElementById('pw-new');
  const pwMessage = document.getElementById('pw-message');

  async function loadAccount() {
    const res = await apiFetch('/api/account');
    if (!res) return;
    const data = await res.json();
    if (data.csrfToken) Gravity.setCsrfToken(data.csrfToken);
    const u = data.user;
    usernameEl.textContent = u.username;
    const groups = u.groups && u.groups.length ? u.groups : ['none'];
    groupsEl.textContent = groups.join(', ');
    statusEl.textContent = u.disabled ? 'Disabled' : 'Active';
  }

  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwMessage.textContent = '';
    pwMessage.className = 'muted';
    const currentPassword = pwCurrent.value;
    const newPassword = pwNew.value;
    if (!currentPassword || !newPassword) {
      pwMessage.textContent = 'Both current and new password are required.';
      pwMessage.className = 'error';
      return;
    }
    try {
      const res = await apiFetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        pwMessage.textContent = body.error || 'Failed to update password.';
        pwMessage.className = 'error';
        return;
      }
      pwCurrent.value = '';
      pwNew.value = '';
      pwMessage.textContent = 'Password updated.';
      pwMessage.className = 'success';
    } catch (_e) {
      pwMessage.textContent = 'Failed to update password.';
      pwMessage.className = 'error';
    }
  });

  await bootstrapSession().catch(() => {});
  await loadAccount().catch(() => {
    usernameEl.textContent = 'Error loading account';
  });
})();
