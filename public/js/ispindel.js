(async function () {
  const { apiFetch, bootstrapSession, escapeHtml } = Gravity;

  const devicesEl = document.getElementById('devices');

  function formatNum(n, digits) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toFixed(digits);
  }

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  async function loadHistory(tokenId, container) {
    container.textContent = 'Loading…';
    const res = await apiFetch('/api/ispindel/readings?token_id=' + tokenId + '&limit=50');
    if (!res) return;
    const data = await res.json();
    const readings = data.readings || [];
    if (readings.length === 0) {
      container.innerHTML = '<p class="muted">No readings yet.</p>';
      return;
    }
    container.innerHTML =
      '<table><thead><tr><th>Time</th><th>Gravity</th><th>Temp</th><th>Angle</th><th>Battery</th><th>RSSI</th></tr></thead><tbody>' +
      readings
        .map(
          (r) => `<tr>
          <td>${escapeHtml(formatDate(r.created_at))}</td>
          <td>${escapeHtml(formatNum(r.gravity, 4))}</td>
          <td>${escapeHtml(formatNum(r.temperature, 1))}${r.temp_units ? ' ' + escapeHtml(r.temp_units) : ''}</td>
          <td>${escapeHtml(formatNum(r.angle, 1))}</td>
          <td>${escapeHtml(formatNum(r.battery, 2))}</td>
          <td>${escapeHtml(formatNum(r.rssi, 0))}</td>
        </tr>`
        )
        .join('') +
      '</tbody></table>';
  }

  async function loadDevices() {
    const res = await apiFetch('/api/ispindel/devices');
    if (!res) return;
    const data = await res.json();
    const devices = data.devices || [];
    if (devices.length === 0) {
      devicesEl.innerHTML =
        '<p class="muted">No device tokens yet. <a href="/tokens">Create a device token</a> for each iSpindel.</p>';
      return;
    }

    devicesEl.innerHTML = devices
      .map((d) => {
        const latest = d.latest;
        const summary = latest
          ? `<dl class="reading-summary">
              <div><dt>Gravity</dt><dd>${escapeHtml(formatNum(latest.gravity, 4))}</dd></div>
              <div><dt>Temp</dt><dd>${escapeHtml(formatNum(latest.temperature, 1))} ${escapeHtml(latest.temp_units || 'C')}</dd></div>
              <div><dt>Angle</dt><dd>${escapeHtml(formatNum(latest.angle, 1))}°</dd></div>
              <div><dt>Battery</dt><dd>${escapeHtml(formatNum(latest.battery, 2))} V</dd></div>
              <div><dt>Reported</dt><dd>${escapeHtml(formatDate(latest.created_at))}</dd></div>
              <div><dt>Payload name</dt><dd>${escapeHtml(latest.device_name || '—')}</dd></div>
            </dl>`
          : '<p class="muted">No readings received yet.</p>';

        return `<section class="device-card" data-id="${d.id}">
          <h2>${escapeHtml(d.name)} <span class="muted">(${escapeHtml(d.token_prefix)}…)</span></h2>
          ${d.owner_username ? `<p class="muted">Owner: ${escapeHtml(d.owner_username)}</p>` : ''}
          ${summary}
          <button type="button" class="toggle-history" data-id="${d.id}">Show recent history</button>
          <div class="history is-hidden" id="history-${d.id}"></div>
        </section>`;
      })
      .join('');

    devicesEl.querySelectorAll('.toggle-history').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const box = document.getElementById('history-' + id);
        if (!box) return;
        if (!box.classList.contains('is-hidden') && box.dataset.loaded === '1') {
          box.classList.add('is-hidden');
          btn.textContent = 'Show recent history';
          return;
        }
        box.classList.remove('is-hidden');
        btn.textContent = 'Hide history';
        if (box.dataset.loaded !== '1') {
          await loadHistory(id, box);
          box.dataset.loaded = '1';
        }
      });
    });
  }

  await bootstrapSession();
  await loadDevices().catch(() => {
    devicesEl.innerHTML = '<p class="error">Failed to load devices.</p>';
  });
})();
