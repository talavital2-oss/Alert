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

  let eventHistory = []; // array of event objects
  let knownEventIds = new Set(); // track event IDs to prevent duplicates

  // Initialize map
  AlertMap.init();

  // Panel toggle
  panelToggle.addEventListener('click', () => {
    alertPanel.classList.toggle('panel-closed');
    alertPanel.classList.toggle('panel-open');

    const mapEl = document.getElementById('map');
    if (alertPanel.classList.contains('panel-closed')) {
      mapEl.style.right = '0';
    } else {
      mapEl.style.right = window.innerWidth <= 768 ? '0' : 'var(--panel-width)';
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
  });

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

    // Add grouped events to panel + compute direction arrows
    if (events && events.length > 0) {
      addEvents(events);

      // Update missile direction arrows for relevant events
      for (const event of events) {
        AlertMap.updateDirection(event);
      }

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
    if (window.innerWidth <= 768) {
      document.getElementById('map').style.right = '0';
    } else if (!alertPanel.classList.contains('panel-closed')) {
      document.getElementById('map').style.right = 'var(--panel-width)';
    }
  });

  console.log('Israel Alert Map initialized');
})();
