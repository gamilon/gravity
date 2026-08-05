(async function () {
  const { apiFetch, bootstrapSession, escapeHtml } = Gravity;

  const tbody = document.getElementById('users-tbody');
  const groupsList = document.getElementById('groups-list');
  const groupForm = document.getElementById('group-form');
  const groupNameInput = document.getElementById('group-name');
  const groupError = document.getElementById('group-error');
  const userForm = document.getElementById('user-form');
  const userUsernameInput = document.getElementById('user-username');
  const userPasswordInput = document.getElementById('user-password');
  const userAdminInput = document.getElementById('user-admin');
  const userError = document.getElementById('user-error');

  const editPanel = document.getElementById('edit-panel');
  const editUsername = document.getElementById('edit-username');
  const editGroups = document.getElementById('edit-groups');
  const editDisabled = document.getElementById('edit-disabled');
  const editError = document.getElementById('edit-error');
  const editForm = document.getElementById('edit-form');
  const editCancel = document.getElementById('edit-cancel');
  let editingUserId = null;

  function hideEditPanel() {
    editingUserId = null;
    editPanel.hidden = true;
    editError.textContent = '';
  }

  function showEditPanel(user) {
    editingUserId = user.id;
    editUsername.textContent = user.username;
    editGroups.value = (user.groups || []).join(', ');
    editDisabled.checked = !!user.disabled;
    editError.textContent = '';
    editPanel.hidden = false;
    editGroups.focus();
  }

  async function loadUsers() {
    const res = await apiFetch('/api/admin/users');
    if (!res) return;
    const data = await res.json();
    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No users found.</td></tr>';
      return;
    }
    tbody.innerHTML = data.users.map((u) => {
      const groups = u.groups || [];
      const groupsHtml = groups.length
        ? groups.map((g) => '<span class="badge ' + (g === 'admin' ? 'badge-admin' : '') + '">' + escapeHtml(g) + '</span>').join(' ')
        : '<span class="muted">none</span>';
      const status = u.disabled ? ' <span class="muted">(disabled)</span>' : '';
      return '<tr><td>' + u.id + '</td><td>' + escapeHtml(u.username) + status + '</td><td>' + groupsHtml +
        '</td><td><button type="button" class="edit" data-id="' + u.id + '">Edit</button> ' +
        '<button type="button" class="revoke" data-id="' + u.id + '">Delete</button></td></tr>';
    }).join('');

    tbody.querySelectorAll('button.revoke').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        if (!Number.isInteger(id)) return;
        if (!confirm('Delete this user?')) return;
        const delRes = await apiFetch('/api/admin/users/' + id, { method: 'DELETE' });
        if (!delRes) return;
        const body = await delRes.json().catch(() => ({}));
        if (!delRes.ok) {
          userError.textContent = ' ' + (body.error || 'Failed to delete user');
          return;
        }
        if (editingUserId === id) hideEditPanel();
        loadUsers();
      });
    });

    tbody.querySelectorAll('button.edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        if (!Number.isInteger(id)) return;
        const user = data.users.find((u) => u.id === id);
        if (!user) return;
        showEditPanel(user);
      });
    });
  }

  async function loadGroups() {
    const res = await apiFetch('/api/admin/groups');
    if (!res) return;
    const data = await res.json();
    const groups = data.groups || [];
    if (groups.length === 0) {
      groupsList.innerHTML = '<li class="muted">No groups yet. The seed created <code>admin</code> once a user exists.</li>';
      return;
    }
    groupsList.innerHTML = groups
      .map((g) => {
        const canDelete = g.name !== 'admin';
        const btn = canDelete
          ? ' <button type="button" data-id="' + g.id + '" class="revoke">Delete</button>'
          : '';
        return '<li><span class="badge ' + (g.name === 'admin' ? 'badge-admin' : '') + '">' +
          escapeHtml(g.name) + '</span>' + btn + '</li>';
      })
      .join('');
    groupsList.querySelectorAll('button.revoke').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        if (!Number.isInteger(id)) return;
        if (!confirm('Delete this group?')) return;
        const delRes = await apiFetch('/api/admin/groups/' + id, { method: 'DELETE' });
        if (!delRes) return;
        const body = await delRes.json().catch(() => ({}));
        if (!delRes.ok) {
          groupError.textContent = ' ' + (body.error || 'Failed to delete group');
          return;
        }
        loadGroups();
      });
    });
  }

  editCancel.addEventListener('click', () => hideEditPanel());

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!Number.isInteger(editingUserId)) return;
    editError.textContent = '';
    const groups = editGroups.value.split(',').map((g) => g.trim()).filter((g) => g.length > 0);
    const res = await apiFetch('/api/admin/users/' + editingUserId + '/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups, disabled: !!editDisabled.checked }),
    });
    if (!res) return;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      editError.textContent = body.error || 'Failed to update user';
      return;
    }
    hideEditPanel();
    loadUsers();
  });

  groupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    groupError.textContent = '';
    const name = groupNameInput.value.trim();
    if (!name) {
      groupError.textContent = ' Name is required.';
      return;
    }
    const res = await apiFetch('/api/admin/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res) return;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      groupError.textContent = ' ' + (body.error || 'Failed to create group');
      return;
    }
    groupNameInput.value = '';
    loadGroups();
  });

  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    userError.textContent = '';
    const username = userUsernameInput.value.trim();
    const password = userPasswordInput.value;
    const isAdmin = !!userAdminInput.checked;
    if (!username || !password) {
      userError.textContent = ' Username and password are required.';
      return;
    }
    const res = await apiFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, isAdmin }),
    });
    if (!res) return;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      userError.textContent = ' ' + (body.error || 'Failed to create user');
      return;
    }
    userUsernameInput.value = '';
    userPasswordInput.value = '';
    userAdminInput.checked = false;
    loadUsers();
  });

  try {
    await bootstrapSession();
    await Promise.all([loadUsers(), loadGroups()]);
  } catch (_e) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Failed to load.</td></tr>';
  }
})();
