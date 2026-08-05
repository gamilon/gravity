(async function () {
  const { bootstrapSession, apiFetch } = Gravity;

  const data = await bootstrapSession().catch(() => null);
  const userLabel = document.getElementById('user-label');
  const adminLink = document.getElementById('admin-link');
  const tokensLink = document.getElementById('tokens-link');

  if (data && data.user) {
    userLabel.textContent = 'Logged in as ' + data.user.username;
    if ((data.user.groups || []).includes('admin')) {
      adminLink.classList.remove('is-hidden');
      tokensLink.classList.remove('is-hidden');
    }
  } else {
    userLabel.textContent = '';
  }

  document.getElementById('logout').addEventListener('click', (e) => {
    e.preventDefault();
    apiFetch('/api/logout', { method: 'POST' }).then(() => {
      window.location.href = '/login';
    });
  });
})();
