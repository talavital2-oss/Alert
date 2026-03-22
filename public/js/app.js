// Main app initialization
(function () {
  const ISR_TZ = 'Asia/Jerusalem';

  // DOM elements
  const connectionStatus = document.getElementById('connection-status');
  const statusText = connectionStatus.querySelector('.status-text');
  const alertCountBadge = document.getElementById('alert-count');
  const panelAlertCount = document.getElementById('panel-alert-count');
  const panelTitle = document.getElementById('panel-title');
  const alertList = document.getElementById('alert-list');
  const impactList = document.getElementById('impact-list');
  const noAlerts = document.getElementById('no-alerts');
  const noImpacts = document.getElementById('no-impacts');
  const soundToggle = document.getElementById('sound-toggle');
  const soundIconOff = document.getElementById('sound-icon-off');
  const soundIconOn = document.getElementById('sound-icon-on');
  const panelToggle = document.getElementById('panel-toggle');
  const alertPanel = document.getElementById('alert-panel');
  const menuToggle = document.getElementById('menu-toggle');
  const menuOverlay = document.getElementById('menu-overlay');
  const menuDrawer = document.getElementById('menu-drawer');
  const menuClose = document.getElementById('menu-close');
  const menuItems = document.querySelectorAll('.menu-item');

  let eventHistory = []; // array of event objects
  let knownEventIds = new Set(); // track event IDs to prevent duplicates
  let activeSection = 'alerts'; // 'alerts' or 'impacts'
  let impactHistoryMarkers = []; // temporary markers shown when clicking impact cards

  // Initialize map
  AlertMap.init();

  // Panel toggle
  panelToggle.addEventListener('click', () => {
    alertPanel.classList.toggle('panel-closed');
    alertPanel.classList.toggle('panel-open');

    const mapEl = document.getElementById('map');
    const mapGl = document.getElementById('map-gl');
    const rightVal = alertPanel.classList.contains('panel-closed') ? '0' :
      (window.innerWidth <= 768 ? '0' : 'var(--panel-width)');
    mapEl.style.right = rightVal;
    mapGl.style.right = rightVal;
    setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
  });

  // ── Hamburger Menu ──
  function openMenu() {
    menuDrawer.classList.remove('menu-closed');
    menuOverlay.classList.remove('hidden');
  }
  function closeMenu() {
    menuDrawer.classList.add('menu-closed');
    menuOverlay.classList.add('hidden');
  }
  menuToggle.addEventListener('click', openMenu);
  menuClose.addEventListener('click', closeMenu);
  menuOverlay.addEventListener('click', closeMenu);

  // Menu section switching
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      switchSection(section);
      closeMenu();
    });
  });

  function switchSection(section) {
    activeSection = section;
    // Update menu active state
    menuItems.forEach(i => i.classList.toggle('active', i.dataset.section === section));

    // Clear any impact history markers from map
    clearImpactHistoryMarkers();

    if (section === 'alerts') {
      panelTitle.textContent = 'התרעות אחרונות';
      alertList.classList.remove('hidden');
      impactList.classList.add('hidden');
      noImpacts.classList.add('hidden');
      noAlerts.style.display = eventHistory.length === 0 ? '' : 'none';
      updateAlertCounts();
    } else if (section === 'impacts') {
      panelTitle.textContent = 'היסטוריית פגיעות';
      alertList.classList.add('hidden');
      noAlerts.style.display = 'none';
      impactList.classList.remove('hidden');
      loadImpactHistory();
    }

    // Open panel if closed
    if (alertPanel.classList.contains('panel-closed')) {
      alertPanel.classList.remove('panel-closed');
      alertPanel.classList.add('panel-open');
      const rightVal = window.innerWidth <= 768 ? '0' : 'var(--panel-width)';
      document.getElementById('map').style.right = rightVal;
      document.getElementById('map-gl').style.right = rightVal;
      setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
    }
  }

  // Set initial active menu item
  menuItems.forEach(i => i.classList.toggle('active', i.dataset.section === 'alerts'));

  // ── Impact History ──
  async function loadImpactHistory() {
    impactList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);">טוען...</div>';
    noImpacts.classList.add('hidden');

    try {
      const res = await fetch('/api/impacts/history');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const impacts = data.impacts || [];

      impactList.innerHTML = '';
      if (impacts.length === 0) {
        noImpacts.classList.remove('hidden');
        panelAlertCount.textContent = '0 פגיעות';
        return;
      }

      noImpacts.classList.add('hidden');
      panelAlertCount.textContent = `${impacts.length} פגיעות`;

      for (const impact of impacts) {
        const card = createImpactCard(impact);
        impactList.appendChild(card);
      }
    } catch (e) {
      impactList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red-alert);">שגיאה בטעינת נתונים</div>';
    }
  }

  function createImpactCard(impact) {
    const card = document.createElement('div');
    card.className = 'impact-card';
    card.dataset.impactId = impact.id;

    const timeStr = new Date(impact.timeMs).toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: ISR_TZ
    });
    const relTime = formatRelativeTime(impact.timeMs);

    // Truncate text for card display
    const displayText = impact.text.length > 120 ? impact.text.substring(0, 120) + '...' : impact.text;

    card.innerHTML = `
      <div class="impact-card-header">
        <span class="impact-card-location">📍 ${impact.location}</span>
        <span class="impact-card-time">${relTime} (${timeStr})</span>
      </div>
      <div class="impact-card-text">${displayText}</div>
    `;

    // Click to show this impact on the map
    card.addEventListener('click', () => {
      // Toggle selection
      const wasSelected = card.classList.contains('selected');
      impactList.querySelectorAll('.impact-card').forEach(c => c.classList.remove('selected'));
      clearImpactHistoryMarkers();

      if (!wasSelected && impact.lat && impact.lng) {
        card.classList.add('selected');
        showImpactOnMap(impact);
      }
    });

    return card;
  }

  function showImpactOnMap(impact) {
    // Add a temporary blue dot on the map for this impact
    AlertMap.addImpact(impact);
    impactHistoryMarkers.push(impact.id);

    // Pan to the impact location
    AlertMap.panTo(impact.lat, impact.lng, 13);
  }

  function clearImpactHistoryMarkers() {
    for (const id of impactHistoryMarkers) {
      AlertMap.removeImpact(id);
    }
    impactHistoryMarkers = [];
  }

  // Sound toggle
  soundToggle.addEventListener('click', () => {
    const enabled = SoundManager.toggle();
    soundIconOff.classList.toggle('hidden', enabled);
    soundIconOn.classList.toggle('hidden', !enabled);
    soundToggle.classList.toggle('active', enabled);
  });

  // Format time in Israel timezone (always Israel, regardless of user's location)
  function formatTimeISR(isoOrMs) {
    const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
    return d.toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: ISR_TZ
    });
  }

  // Format relative time in Hebrew
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
    // Count total cities across all events
    const totalCities = eventHistory.reduce((sum, ev) => sum + ev.cityCount, 0);
    panelAlertCount.textContent = `${totalCities} התרעות`;
  }

  // Create event card for panel (grouped - like the real app)
  function createEventCard(event) {
    const card = document.createElement('div');
    card.className = 'alert-card active';
    card.dataset.eventId = event.eventId;

    const timeRange = event.minTime === event.maxTime
      ? formatTimeISR(event.minTime)
      : `${formatTimeISR(event.minTime)}-${formatTimeISR(event.maxTime)}`;

    const relTime = formatRelativeTime(event.maxTime);
    const areasStr = event.areas.length > 0 ? event.areas.join(', ') : '';

    // List city names (Hebrew)
    const cityNames = event.cities.map(c => c.city).join(', ');

    card.innerHTML = `
      <div class="alert-card-header">
        <span class="alert-card-type type-${event.type}">
          ${AlertMap.alertLabels[event.type] || event.type}
        </span>
        <span class="alert-card-reltime">${relTime} (${timeRange})</span>
      </div>
      ${areasStr ? `<div class="alert-card-areas">${areasStr}</div>` : ''}
      <div class="alert-card-cities">${cityNames}</div>
      <div class="alert-card-meta">
        <span class="alert-card-count">${event.cityCount} יישובים</span>
      </div>
    `;

    // Remove active state after 60 seconds
    setTimeout(() => card.classList.remove('active'), 60000);

    // Click to show event cities on map
    card.addEventListener('click', () => {
      const shown = AlertMap.showHistoryEvent(event);
      // Toggle selected state on cards
      alertList.querySelectorAll('.alert-card').forEach(c => c.classList.remove('selected'));
      if (shown) {
        card.classList.add('selected');
      }
    });

    return card;
  }

  // Rebuild the entire panel from eventHistory (sorted newest first)
  function renderPanel() {
    alertList.innerHTML = '';
    if (eventHistory.length === 0) {
      noAlerts.style.display = '';
    } else {
      noAlerts.style.display = 'none';
      for (const event of eventHistory) {
        const card = createEventCard(event);
        alertList.appendChild(card);
      }
    }
    updateAlertCounts();
  }

  // Add new events to panel (inserts at top, maintains sort)
  function addEvents(events) {
    for (const event of events) {
      if (knownEventIds.has(event.eventId)) continue;
      knownEventIds.add(event.eventId);
      eventHistory.unshift(event);
    }
    // Keep max 100 events
    if (eventHistory.length > 100) {
      eventHistory = eventHistory.slice(0, 100);
    }
    // Re-sort newest first
    eventHistory.sort((a, b) => b.maxTime - a.maxTime);
    renderPanel();
  }

  // Handle new alerts from polling
  function handleAlerts(alerts, events) {
    // Add markers to map for each city
    if (alerts && alerts.length > 0) {
      for (const alert of alerts) {
        AlertMap.addAlert(alert);
      }
    }

    // Add grouped events to panel
    if (events && events.length > 0) {
      addEvents(events);

      // Play sound for highest priority alert type
      const hasMissiles = events.some(e => e.type === 'missiles');
      SoundManager.play(hasMissiles ? 'missiles' : events[0].type);

      // Flash page title
      const totalCities = events.reduce((sum, e) => sum + e.cityCount, 0);
      flashTitle(totalCities);
    }

    updateAlertCounts();
  }

  // Flash page title on alert
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

  // Handle init (history load) - only populate panel, NOT the map
  // Map markers come from polling /api/alerts/current only
  function handleInit(currentAlerts, events) {
    if (events && events.length > 0) {
      addEvents(events);
    }
    updateAlertCounts();
  }

  // Handle clear
  function handleClear() {
    AlertMap.clearAll();
    updateAlertCounts();
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

  // Initialize alert service
  AlertService.init({
    onAlert: handleAlerts,
    onClear: handleClear,
    onConnectionChange: setConnectionStatus,
    onInit: handleInit
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    const rightVal = (window.innerWidth <= 768 || alertPanel.classList.contains('panel-closed'))
      ? '0' : 'var(--panel-width)';
    document.getElementById('map').style.right = rightVal;
    document.getElementById('map-gl').style.right = rightVal;
  });

  // ── Pre-Alert tracking (Pikud HaOref Category 14 — predicted areas) ──
  let currentPreAlertIds = new Set();
  let preAlertPollInterval = null;

  async function fetchPreAlerts() {
    try {
      const res = await fetch('/api/pre-alerts');
      if (!res.ok) return;
      const data = await res.json();
      const preAlerts = data.preAlerts || [];

      // Remove expired pre-alerts no longer in the data
      const newIds = new Set(preAlerts.map(p => p.id));
      for (const oldId of currentPreAlertIds) {
        if (!newIds.has(oldId)) {
          AlertMap.removePreAlert(oldId);
        }
      }

      // Add new pre-alerts
      for (const preAlert of preAlerts) {
        AlertMap.addPreAlert(preAlert);
      }
      currentPreAlertIds = newIds;

      if (preAlerts.length > 0) {
        console.log(`[Pre-Alerts] ${preAlerts.length} predicted areas: ${preAlerts.map(p => p.region).join(', ')}`);
      }
    } catch (e) {
      // Silently handle fetch errors
    }
  }

  // Poll pre-alerts every 15 seconds (they're time-critical)
  preAlertPollInterval = setInterval(fetchPreAlerts, 15000);
  fetchPreAlerts(); // initial fetch

  // ── Impact tracking (Telegram missile impact reports) ──
  // Start catching 2 min after red alerts, poll for 10 min
  // Display blue dots immediately when received, keep for 20 min
  let lastAlertTimes = [];
  let impactPollTimer = null;
  let impactPollingInterval = null;
  let impactPollingStop = null;

  // Called when new alerts arrive — schedule impact fetching 2 min later
  function recordAlertTime(events) {
    if (!events || events.length === 0) return;
    const now = Date.now();
    for (const ev of events) {
      lastAlertTimes.push(ev.maxTime || now);
    }
    // Keep only last 2 hours of alert times
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    lastAlertTimes = lastAlertTimes.filter(t => t > twoHoursAgo);

    // Schedule impact fetch 2 minutes after this alert
    if (!impactPollTimer) {
      impactPollTimer = setTimeout(() => {
        impactPollTimer = null;
        fetchImpacts();
        startImpactPolling();
      }, 2 * 60 * 1000);
    }
  }

  function startImpactPolling() {
    if (impactPollingInterval) return;
    impactPollingInterval = setInterval(fetchImpacts, 30000); // every 30s
    // Stop polling after 10 minutes
    impactPollingStop = setTimeout(() => {
      if (impactPollingInterval) {
        clearInterval(impactPollingInterval);
        impactPollingInterval = null;
      }
    }, 10 * 60 * 1000);
  }

  async function fetchImpacts() {
    try {
      const res = await fetch('/api/impacts');
      if (!res.ok) return;
      const data = await res.json();
      const impacts = data.impacts || [];

      if (impacts.length === 0) return;

      // Display all impacts immediately — no client-side time filtering
      for (const impact of impacts) {
        AlertMap.addImpact(impact);
      }

      console.log(`[Impacts] ${impacts.length} impact locations from Telegram`);
    } catch (e) {
      // Silently handle fetch errors
    }
  }

  // Hook into the existing handleAlerts to also record alert times
  const origHandleAlerts = handleAlerts;
  function handleAlertsWithImpacts(alerts, events) {
    origHandleAlerts(alerts, events);
    recordAlertTime(events);
  }

  // Re-init AlertService with the wrapped handler
  // (AlertService.init was already called, so we patch the callback)
  AlertService.disconnect();
  AlertService.init({
    onAlert: handleAlertsWithImpacts,
    onClear: handleClear,
    onConnectionChange: setConnectionStatus,
    onInit: handleInit
  });

  console.log('Israel Alert Map initialized');
})();
