// Main app initialization
(function () {
  const ISR_TZ = 'Asia/Jerusalem';

  // DOM elements
  const connectionStatus = document.getElementById('connection-status');
  const statusText = connectionStatus.querySelector('.status-text');
  const alertCountBadge = document.getElementById('alert-count');
  const panelAlertCount = document.getElementById('panel-alert-count');
  const alertList = document.getElementById('alert-list');
  const noAlerts = document.getElementById('no-alerts');
  const soundToggle = document.getElementById('sound-toggle');
  const soundIconOff = document.getElementById('sound-icon-off');
  const soundIconOn = document.getElementById('sound-icon-on');
  const panelToggle = document.getElementById('panel-toggle');
  const alertPanel = document.getElementById('alert-panel');
  const notifyToggle = document.getElementById('notify-toggle');
  const myAreaDisplay = document.getElementById('my-area-display');
  const myAreaName = document.getElementById('my-area-name');
  const myAreaCountdown = document.getElementById('my-area-countdown');

  let eventHistory = [];
  let knownEventIds = new Set();
  let myArea = null; // { name, countdown }
  let myAreaTimer = null;
  let myAreaAlertActive = false;
  let activeViewEventId = null;

  // Initialize map
  AlertMap.init();

  // ===== Tab Switching =====
  const panelTabs = document.querySelectorAll('.panel-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      panelTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + target).classList.add('active');

      if (target === 'stats') loadStats();
    });
  });

  // ===== Panel toggle =====
  panelToggle.addEventListener('click', () => {
    alertPanel.classList.toggle('panel-closed');
    alertPanel.classList.toggle('panel-open');

    const mapEl = document.getElementById('map');
    const mapGl = document.getElementById('map-gl');
    if (alertPanel.classList.contains('panel-closed')) {
      mapEl.style.right = '0';
      mapGl.style.right = '0';
    } else {
      const r = window.innerWidth <= 768 ? '0' : 'var(--panel-width)';
      mapEl.style.right = r;
      mapGl.style.right = r;
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
  });

  // ===== Sound toggle =====
  soundToggle.addEventListener('click', () => {
    const enabled = SoundManager.toggle();
    soundIconOff.classList.toggle('hidden', enabled);
    soundIconOn.classList.toggle('hidden', !enabled);
    soundToggle.classList.toggle('active', enabled);
  });

  // ===== Time formatting (Israel TZ) =====
  function formatTimeISR(isoOrMs) {
    const d = new Date(isoOrMs);
    return d.toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: ISR_TZ
    });
  }

  function formatRelativeTime(ms) {
    const diffMin = Math.round((Date.now() - ms) / 60000);
    if (diffMin < 1) return 'עכשיו';
    if (diffMin === 1) return 'לפני דקה';
    if (diffMin < 60) return `לפני ${diffMin} דקות`;
    const hours = Math.floor(diffMin / 60);
    if (hours === 1) return 'לפני שעה';
    return `לפני ${hours} שעות`;
  }

  function setConnectionStatus(status) {
    connectionStatus.className = `status-dot ${status}`;
    statusText.textContent = status === 'connected' ? 'מחובר' : 'מתחבר...';
  }

  function updateAlertCounts() {
    const activeCount = AlertMap.getActiveCount();
    if (activeCount > 0) {
      alertCountBadge.textContent = activeCount;
      alertCountBadge.classList.remove('hidden');
    } else {
      alertCountBadge.classList.add('hidden');
    }
    const totalCities = eventHistory.reduce((sum, ev) => sum + ev.cityCount, 0);
    panelAlertCount.textContent = `${totalCities} התרעות`;
  }

  // ===== Alert Cards =====
  function createEventCard(event) {
    const card = document.createElement('div');
    card.className = 'alert-card active';
    card.dataset.eventId = event.eventId;

    const timeRange = event.minTime === event.maxTime
      ? formatTimeISR(event.minTime)
      : `${formatTimeISR(event.minTime)}-${formatTimeISR(event.maxTime)}`;

    const relTime = formatRelativeTime(event.maxTime);
    const areasStr = event.areas.length > 0 ? event.areas.join(', ') : '';
    const cityNames = event.cities.map(c => c.city).join(', ');
    const icon = AlertMap.typeIcons[event.type] || '⚡';

    card.innerHTML = `
      <div class="alert-card-header">
        <span class="alert-card-type type-${event.type}">
          ${icon} ${AlertMap.alertLabels[event.type] || event.type}
        </span>
        <span class="alert-card-reltime">${relTime} (${timeRange})</span>
      </div>
      ${areasStr ? `<div class="alert-card-areas">${areasStr}</div>` : ''}
      <div class="alert-card-cities">${cityNames}</div>
      <div class="alert-card-meta">
        <span class="alert-card-count">${event.cityCount} יישובים</span>
      </div>
    `;

    // Click to show on map
    card.addEventListener('click', () => {
      const result = AlertMap.showHistoryEvent(event);
      // Toggle viewing state
      document.querySelectorAll('.alert-card.viewing').forEach(c => c.classList.remove('viewing'));
      if (result) {
        card.classList.add('viewing');
        activeViewEventId = event.eventId;
      } else {
        activeViewEventId = null;
      }
    });

    setTimeout(() => card.classList.remove('active'), 60000);
    return card;
  }

  function renderPanel() {
    alertList.innerHTML = '';
    if (eventHistory.length === 0) {
      noAlerts.style.display = '';
    } else {
      noAlerts.style.display = 'none';
      for (const event of eventHistory) {
        alertList.appendChild(createEventCard(event));
      }
    }
    updateAlertCounts();
  }

  function addEvents(events) {
    for (const event of events) {
      if (knownEventIds.has(event.eventId)) continue;
      knownEventIds.add(event.eventId);
      eventHistory.unshift(event);
    }
    if (eventHistory.length > 100) {
      eventHistory = eventHistory.slice(0, 100);
    }
    eventHistory.sort((a, b) => b.maxTime - a.maxTime);
    renderPanel();
  }

  // ===== Personal Area =====
  function initMyArea() {
    const saved = localStorage.getItem('myArea');
    if (saved) {
      try {
        myArea = JSON.parse(saved);
        myAreaName.textContent = myArea.name;
        myAreaDisplay.classList.remove('hidden');
        myAreaDisplay.classList.add('safe');
        myAreaCountdown.textContent = '✓ בטוח';
      } catch (e) { /* ignore */ }
    }
  }

  function checkMyAreaAlert(alerts) {
    if (!myArea) return;
    const match = alerts.find(a => a.area === myArea.name || a.city === myArea.name);
    if (match) {
      myAreaAlertActive = true;
      myAreaDisplay.classList.remove('hidden', 'safe');
      startMyAreaCountdown(match.countdown || myArea.countdown || 90);
    }
  }

  function startMyAreaCountdown(seconds) {
    if (myAreaTimer) clearInterval(myAreaTimer);
    let remaining = seconds;
    myAreaCountdown.textContent = `${remaining} שניות`;

    myAreaTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(myAreaTimer);
        myAreaTimer = null;
        myAreaAlertActive = false;
        myAreaDisplay.classList.add('safe');
        myAreaCountdown.textContent = '✓ בטוח';
        return;
      }
      myAreaCountdown.textContent = `${remaining} שניות`;
    }, 1000);
  }

  // Area select in settings
  async function loadAreas() {
    const select = document.getElementById('area-select');
    try {
      const res = await fetch('/api/areas');
      if (!res.ok) throw new Error('No areas endpoint');
      const areas = await res.json();
      for (const area of areas) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ name: area.name, countdown: area.countdown });
        opt.textContent = area.name;
        select.appendChild(opt);
      }
    } catch (e) {
      // Fallback: load from cities
      const cities = AlertService.getCities();
      const areaMap = new Map();
      for (const [, city] of Object.entries(cities)) {
        if (city.areaHe && !areaMap.has(city.areaHe)) {
          areaMap.set(city.areaHe, city.countdown || 90);
        }
      }
      const sorted = Array.from(areaMap.entries()).sort((a, b) => a[0].localeCompare(b[0], 'he'));
      for (const [name, countdown] of sorted) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ name, countdown });
        opt.textContent = name;
        select.appendChild(opt);
      }
    }

    // Restore saved area
    if (myArea) {
      const options = select.options;
      for (let i = 0; i < options.length; i++) {
        try {
          const val = JSON.parse(options[i].value);
          if (val.name === myArea.name) {
            select.selectedIndex = i;
            break;
          }
        } catch (e) { /* skip */ }
      }
    }

    select.addEventListener('change', () => {
      if (!select.value) {
        myArea = null;
        localStorage.removeItem('myArea');
        myAreaDisplay.classList.add('hidden');
        return;
      }
      myArea = JSON.parse(select.value);
      localStorage.setItem('myArea', select.value);
      myAreaName.textContent = myArea.name;
      myAreaDisplay.classList.remove('hidden');
      myAreaDisplay.classList.add('safe');
      myAreaCountdown.textContent = '✓ בטוח';
    });
  }

  // ===== Push Notifications =====
  function initNotifications() {
    const notifyBtn = document.getElementById('notify-enable-btn');
    const notifyStatus = document.getElementById('notify-status');

    function updateNotifyUI() {
      if (!('Notification' in window)) {
        notifyBtn.textContent = 'לא נתמך';
        notifyBtn.disabled = true;
        notifyStatus.textContent = 'הדפדפן אינו תומך בהתראות דחיפה';
        return;
      }
      if (Notification.permission === 'granted') {
        notifyBtn.textContent = 'התראות מופעלות';
        notifyBtn.classList.add('active');
        notifyToggle.classList.add('active');
        notifyStatus.textContent = 'תקבל התראות על אירועים חדשים';
      } else if (Notification.permission === 'denied') {
        notifyBtn.textContent = 'חסום';
        notifyBtn.disabled = true;
        notifyStatus.textContent = 'התראות חסומות בדפדפן. שנה בהגדרות הדפדפן.';
      } else {
        notifyBtn.textContent = 'הפעל התראות';
        notifyStatus.textContent = '';
      }
    }

    notifyBtn.addEventListener('click', async () => {
      if (Notification.permission === 'granted') return;
      const perm = await Notification.requestPermission();
      updateNotifyUI();
    });

    notifyToggle.addEventListener('click', async () => {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') return;
      const perm = await Notification.requestPermission();
      updateNotifyUI();
    });

    updateNotifyUI();
  }

  function sendNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, {
        body,
        icon: '🚨',
        tag: 'alert-' + Date.now(),
        requireInteraction: true
      });
    } catch (e) { /* ignore */ }
  }

  // ===== Sound toggle in settings =====
  function initSoundSetting() {
    const btn = document.getElementById('sound-toggle-setting');
    function updateBtn() {
      const enabled = SoundManager.enabled;
      btn.textContent = enabled ? 'צליל מופעל' : 'הפעל צליל';
      btn.classList.toggle('active', enabled);
    }
    btn.addEventListener('click', () => {
      const enabled = SoundManager.toggle();
      soundIconOff.classList.toggle('hidden', enabled);
      soundIconOn.classList.toggle('hidden', !enabled);
      soundToggle.classList.toggle('active', enabled);
      updateBtn();
    });
    updateBtn();
  }

  // ===== Statistics =====
  let statsLoaded = false;

  async function loadStats() {
    if (statsLoaded) return;
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('No stats');
      const stats = await res.json();
      renderStats(stats);
      statsLoaded = true;
    } catch (e) {
      // Build stats from eventHistory
      renderLocalStats();
      statsLoaded = true;
    }
  }

  function renderStats(stats) {
    document.getElementById('stat-events').textContent = stats.eventCount || 0;
    document.getElementById('stat-cities').textContent = stats.cityCount || 0;
    document.getElementById('stat-alerts').textContent = stats.alertCount || 0;
    document.getElementById('stat-peak').textContent = stats.peakHour || '—';

    // Types
    const typesEl = document.getElementById('stats-types');
    typesEl.innerHTML = '';
    if (stats.types && stats.types.length > 0) {
      const maxCount = Math.max(...stats.types.map(t => t.count));
      for (const t of stats.types) {
        const color = AlertMap.alertColors[t.type] || '#eab308';
        const icon = AlertMap.typeIcons[t.type] || '⚡';
        const pct = maxCount > 0 ? (t.count / maxCount * 100) : 0;
        typesEl.innerHTML += `<div class="stats-type-row">
          <span class="stats-type-icon">${icon}</span>
          <span class="stats-type-name">${AlertMap.alertLabels[t.type] || t.type}</span>
          <div class="stats-type-bar-bg"><div class="stats-type-bar" style="width:${pct}%;background:${color}"></div></div>
          <span class="stats-type-count">${t.count}</span>
        </div>`;
      }
    }

    // Areas
    const areasEl = document.getElementById('stats-areas');
    areasEl.innerHTML = '';
    if (stats.areas && stats.areas.length > 0) {
      for (const a of stats.areas.slice(0, 10)) {
        areasEl.innerHTML += `<div class="stats-area-row">
          <span class="stats-area-name">${a.name}</span>
          <span class="stats-area-count">${a.count}</span>
        </div>`;
      }
    }

    // Hourly chart
    renderHourlyChart(stats.hourly || []);
  }

  function renderLocalStats() {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const recent = eventHistory.filter(e => e.maxTime > now - day);

    document.getElementById('stat-events').textContent = recent.length;
    const allCities = new Set();
    let totalAlerts = 0;
    const typeCounts = {};
    const areaCounts = {};
    const hourlyCounts = new Array(24).fill(0);

    for (const ev of recent) {
      totalAlerts += ev.cityCount;
      typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1;
      for (const a of ev.areas) {
        areaCounts[a] = (areaCounts[a] || 0) + ev.cityCount;
      }
      for (const c of ev.cities) {
        allCities.add(c.city);
        const h = new Date(c.timeMs).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: ISR_TZ });
        hourlyCounts[parseInt(h)] = (hourlyCounts[parseInt(h)] || 0) + 1;
      }
    }

    document.getElementById('stat-cities').textContent = allCities.size;
    document.getElementById('stat-alerts').textContent = totalAlerts;

    // Peak hour
    let peakH = 0, peakV = 0;
    hourlyCounts.forEach((v, h) => { if (v > peakV) { peakV = v; peakH = h; } });
    document.getElementById('stat-peak').textContent = peakV > 0 ? `${String(peakH).padStart(2, '0')}:00` : '—';

    // Types
    const typesEl = document.getElementById('stats-types');
    typesEl.innerHTML = '';
    const typeArr = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const maxType = typeArr.length > 0 ? typeArr[0][1] : 1;
    for (const [type, count] of typeArr) {
      const color = AlertMap.alertColors[type] || '#eab308';
      const icon = AlertMap.typeIcons[type] || '⚡';
      const pct = (count / maxType * 100);
      typesEl.innerHTML += `<div class="stats-type-row">
        <span class="stats-type-icon">${icon}</span>
        <span class="stats-type-name">${AlertMap.alertLabels[type] || type}</span>
        <div class="stats-type-bar-bg"><div class="stats-type-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="stats-type-count">${count}</span>
      </div>`;
    }

    // Areas
    const areasEl = document.getElementById('stats-areas');
    areasEl.innerHTML = '';
    const areaArr = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [name, count] of areaArr) {
      areasEl.innerHTML += `<div class="stats-area-row">
        <span class="stats-area-name">${name}</span>
        <span class="stats-area-count">${count}</span>
      </div>`;
    }

    renderHourlyChart(hourlyCounts);
  }

  function renderHourlyChart(hourly) {
    const container = document.getElementById('stats-hourly');
    container.innerHTML = '';
    if (!hourly || hourly.length === 0) return;

    const max = Math.max(...hourly, 1);
    const peakH = hourly.indexOf(Math.max(...hourly));

    const barsDiv = document.createElement('div');
    barsDiv.className = 'stats-hourly-chart';

    for (let h = 0; h < 24; h++) {
      const val = hourly[h] || 0;
      const pct = (val / max * 100);
      const bar = document.createElement('div');
      bar.className = 'stats-hourly-bar' + (h === peakH && val > 0 ? ' peak' : '');
      bar.style.height = Math.max(pct, 3) + '%';
      bar.title = `${String(h).padStart(2, '0')}:00 — ${val}`;
      barsDiv.appendChild(bar);
    }
    container.appendChild(barsDiv);

    const labelsDiv = document.createElement('div');
    labelsDiv.className = 'stats-hourly-labels';
    for (let h = 0; h < 24; h++) {
      const lbl = document.createElement('span');
      lbl.className = 'stats-hourly-label';
      lbl.textContent = h % 3 === 0 ? String(h).padStart(2, '0') : '';
      labelsDiv.appendChild(lbl);
    }
    container.appendChild(labelsDiv);
  }

  // ===== Handle Alerts =====
  function handleAlerts(alerts, events) {
    if (alerts && alerts.length > 0) {
      for (const alert of alerts) {
        AlertMap.addAlert(alert);
      }
    }

    if (events && events.length > 0) {
      addEvents(events);

      const hasMissiles = events.some(e => e.type === 'missiles');
      SoundManager.play(hasMissiles ? 'missiles' : events[0].type);

      const totalCities = events.reduce((sum, e) => sum + e.cityCount, 0);
      flashTitle(totalCities);

      // Push notification
      const types = [...new Set(events.map(e => AlertMap.alertLabels[e.type] || e.type))];
      sendNotification(
        `⚠️ ${totalCities} התרעות חדשות`,
        types.join(', ')
      );

      // Check personal area
      if (alerts && alerts.length > 0) {
        checkMyAreaAlert(alerts);
      }

      // Reset stats cache so next view is fresh
      statsLoaded = false;
    }

    updateAlertCounts();
  }

  // Flash page title
  let titleInterval = null;
  function flashTitle(count) {
    if (titleInterval) clearInterval(titleInterval);
    const original = document.title;
    let on = true;
    titleInterval = setInterval(() => {
      document.title = on ? `⚠️ ${count} התרעות חדשות!` : original;
      on = !on;
    }, 1000);
    setTimeout(() => {
      clearInterval(titleInterval);
      document.title = original;
      titleInterval = null;
    }, 10000);
  }

  function handleInit(currentAlerts, events) {
    if (events && events.length > 0) {
      addEvents(events);
    }
    updateAlertCounts();
  }

  function handleClear() {
    AlertMap.clearAll();
    updateAlertCounts();

    if (myAreaAlertActive) {
      myAreaAlertActive = false;
      if (myAreaTimer) { clearInterval(myAreaTimer); myAreaTimer = null; }
      myAreaDisplay.classList.add('safe');
      myAreaCountdown.textContent = '✓ בטוח';
    }
  }

  // Update relative times every 30 seconds
  setInterval(() => {
    const cards = alertList.querySelectorAll('.alert-card');
    cards.forEach((card, i) => {
      if (i < eventHistory.length) {
        const relTimeEl = card.querySelector('.alert-card-reltime');
        if (relTimeEl) {
          const event = eventHistory[i];
          const timeRange = event.minTime === event.maxTime
            ? formatTimeISR(event.minTime)
            : `${formatTimeISR(event.minTime)}-${formatTimeISR(event.maxTime)}`;
          relTimeEl.textContent = `${formatRelativeTime(event.maxTime)} (${timeRange})`;
        }
      }
    });
  }, 30000);

  // ===== Initialize =====
  initMyArea();
  initNotifications();
  initSoundSetting();
  loadAreas();

  AlertService.init({
    onAlert: handleAlerts,
    onClear: handleClear,
    onConnectionChange: setConnectionStatus,
    onInit: handleInit
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    const mapEl = document.getElementById('map');
    const mapGl = document.getElementById('map-gl');
    if (window.innerWidth <= 768) {
      mapEl.style.right = '0';
      mapGl.style.right = '0';
    } else if (!alertPanel.classList.contains('panel-closed')) {
      mapEl.style.right = 'var(--panel-width)';
      mapGl.style.right = 'var(--panel-width)';
    }
  });

  console.log('Israel Alert Map initialized');
})();
