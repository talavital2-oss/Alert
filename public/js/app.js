// Main app initialization
(function () {
  const ISR_TZ = 'Asia/Jerusalem';

  // DOM elements
  const connectionStatus = document.getElementById('connection-status');
  const statusText = connectionStatus.querySelector('.status-text');
  const alertCountBadge = document.getElementById('alert-count');
  // panel-alert-count removed — counts now in tab badges
  // panel-title removed — section indicated by active tab
  const alertList = document.getElementById('alert-list');
  const impactList = document.getElementById('impact-list');
  const noAlerts = document.getElementById('no-alerts');
  const noImpacts = document.getElementById('no-impacts');
  const soundToggle = document.getElementById('sound-toggle');
  const soundIconOff = document.getElementById('sound-icon-off');
  const soundIconOn = document.getElementById('sound-icon-on');
  const panelToggle = document.getElementById('panel-toggle');
  const alertPanel = document.getElementById('alert-panel');
  const panelTabs = document.querySelectorAll('.panel-tab');
  const tabAlertCount = document.getElementById('tab-alert-count');
  const tabImpactCount = document.getElementById('tab-impact-count');
  const citiesSection = document.getElementById('cities-section');
  const citySearch = document.getElementById('city-search');
  const cityClearBtn = document.getElementById('city-clear-btn');
  const citySelected = document.getElementById('city-selected');
  const cityResults = document.getElementById('city-results');

  let eventHistory = []; // array of event objects
  let knownEventIds = new Set(); // track event IDs to prevent duplicates
  let activeSection = 'alerts'; // 'alerts' or 'impacts' or 'cities'
  let impactHistoryMarkers = []; // temporary markers shown when clicking impact cards
  let allCities = []; // loaded from server
  let selectedCity = null; // currently highlighted city

  // Initialize map
  AlertMap.init();

  // Panel toggle
  panelToggle.addEventListener('click', () => {
    alertPanel.classList.toggle('panel-closed');
    alertPanel.classList.toggle('panel-open');
  });

  // ── Panel Tab Switching ──
  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section;
      switchSection(section);
    });
  });

  function switchSection(section) {
    activeSection = section;
    // Update tab active state
    panelTabs.forEach(t => t.classList.toggle('active', t.dataset.section === section));

    // Clear any impact history markers from map
    clearImpactHistoryMarkers();

    // Hide all sections first
    alertList.classList.add('hidden');
    impactList.classList.add('hidden');
    citiesSection.classList.add('hidden');
    noAlerts.style.display = 'none';
    noImpacts.classList.add('hidden');

    if (section === 'alerts') {
      alertList.classList.remove('hidden');
      noAlerts.style.display = eventHistory.length === 0 ? '' : 'none';
      updateAlertCounts();
    } else if (section === 'impacts') {
      impactList.classList.remove('hidden');
      loadImpactHistory();
    } else if (section === 'cities') {
      citiesSection.classList.remove('hidden');
      if (allCities.length === 0) loadCities();
      citySearch.focus();
    }

    // Open panel if closed
    if (alertPanel.classList.contains('panel-closed')) {
      alertPanel.classList.remove('panel-closed');
      alertPanel.classList.add('panel-open');
    }
  }

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
      tabImpactCount.textContent = impacts.length;
      if (impacts.length === 0) {
        noImpacts.classList.remove('hidden');
        return;
      }

      noImpacts.classList.add('hidden');

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
    tabAlertCount.textContent = totalCities;
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

  // Handle clear — don't remove map markers, let them expire naturally via their own timeouts
  function handleClear() {
    updateAlertCounts();
  }

  // Update relative times every 10 seconds
  setInterval(() => {
    if (activeSection !== 'alerts') return;
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
    updateAlertCounts();
  }, 10000);

  // Initialize alert service
  AlertService.init({
    onAlert: handleAlerts,
    onClear: handleClear,
    onConnectionChange: setConnectionStatus,
    onInit: handleInit
  });

  // Map is always full-width (sidebar overlays on top with transparency)

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

  // Poll pre-alerts every 5 seconds (show immediately when available)
  preAlertPollInterval = setInterval(fetchPreAlerts, 5000);
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

    // Start impact polling immediately (every 10s)
    if (!impactPollingInterval) {
      fetchImpacts(); // immediate first fetch
      impactPollingInterval = setInterval(fetchImpacts, 10000);
    }

    // Reset the stop timer — 20 min from last alert
    if (impactPollingStop) clearTimeout(impactPollingStop);
    impactPollingStop = setTimeout(() => {
      if (impactPollingInterval) {
        clearInterval(impactPollingInterval);
        impactPollingInterval = null;
      }
    }, 20 * 60 * 1000);
  }

  async function fetchImpacts() {
    try {
      const res = await fetch('/api/impacts');
      if (!res.ok) return;
      const data = await res.json();
      const impacts = data.impacts || [];

      if (impacts.length === 0) return;

      // Show all impacts the server returns — the server already does
      // contextual filtering (missile-related only, no car accidents etc.)
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

  // ── City Search & Selection ──
  async function loadCities() {
    try {
      const res = await fetch('/api/cities');
      const data = await res.json();
      // Convert object {name: {lat, lng, he, en, countdown}} to array
      allCities = Object.entries(data).map(([name, c]) => ({
        name,
        he: c.he || name,
        en: c.en || '',
        lat: c.lat,
        lng: c.lng,
        countdown: c.countdown
      }));
      allCities.sort((a, b) => a.he.localeCompare(b.he, 'he'));
      renderCityResults(''); // show all initially
    } catch (e) {
      cityResults.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red-alert);">שגיאה בטעינת ערים</div>';
    }
  }

  function renderCityResults(query) {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? allCities.filter(c =>
          c.he.includes(q) || c.en.toLowerCase().includes(q) || c.name.includes(q)
        )
      : allCities;

    // Limit to 100 results for performance
    const shown = filtered.slice(0, 100);
    const extra = filtered.length - shown.length;

    cityResults.innerHTML = shown.map(c => `
      <div class="city-result-item" data-city="${encodeURIComponent(c.name)}" data-lat="${c.lat}" data-lng="${c.lng}">
        <div>
          <div class="city-result-name">${c.he}</div>
          ${c.en ? `<div class="city-result-en">${c.en}</div>` : ''}
        </div>
        ${c.countdown ? `<div class="city-result-countdown">${c.countdown}s</div>` : ''}
      </div>
    `).join('') + (extra > 0 ? `<div style="text-align:center;padding:8px;color:var(--text-dim);font-size:12px;">+${extra} ערים נוספות — חפש לסנן</div>` : '');

    // Click handlers
    cityResults.querySelectorAll('.city-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const name = decodeURIComponent(el.dataset.city);
        const lat = parseFloat(el.dataset.lat);
        const lng = parseFloat(el.dataset.lng);
        const city = allCities.find(c => c.name === name);
        selectCity(city || { name, he: name, en: '', lat, lng });
      });
    });
  }

  function selectCity(city) {
    selectedCity = city;
    citySelected.classList.remove('hidden');
    citySelected.innerHTML = `
      <span class="city-selected-name">📍 ${city.he}</span>
      ${city.en ? `<span class="city-selected-en">${city.en}</span>` : ''}
    `;
    cityClearBtn.classList.remove('hidden');
    citySearch.value = '';
    renderCityResults('');

    // Highlight on map
    AlertMap.highlightCity(city.he, city.lat, city.lng);
  }

  function clearCitySelection() {
    selectedCity = null;
    citySelected.classList.add('hidden');
    citySelected.innerHTML = '';
    cityClearBtn.classList.add('hidden');
    citySearch.value = '';
    renderCityResults('');
    AlertMap.clearHighlight();
  }

  // Wire up search input
  citySearch.addEventListener('input', () => {
    renderCityResults(citySearch.value);
  });

  cityClearBtn.addEventListener('click', clearCitySelection);

  console.log('Israel Alert Map initialized');
})();
