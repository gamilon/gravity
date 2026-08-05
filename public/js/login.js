(async function () {
  const { bootstrapCsrf, setCsrfToken, getCsrfToken } = Gravity;

  await bootstrapCsrf().catch(() => {});

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('error');
    err.textContent = '';
    const form = e.target;
    const body = new FormData(form);
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: JSON.stringify({ username: body.get('username'), password: body.get('password') }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      err.textContent = data.error || 'Login failed';
      return;
    }
    if (data.csrfToken) setCsrfToken(data.csrfToken);
    window.location.href = '/';
  });
})();
