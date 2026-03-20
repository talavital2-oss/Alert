// Main app initialization
(function () {
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

  let alertHistory = [];

  // Initialize map
  AlertMap.init();

  // Panel toggle
  panelToggle.addEventListener('click', () => {
    alertPanel.classList.toggle('panel-closed');
    alertPanel.classList.toggle('panel-open');

    // Adjust map size when panel toggles
    const mapEl = document.getElementById('map');
    if (alertPanel.classList.contains('panel-closed')) {
      mapEl.style.right = '0';
    } else {
      mapEl.style.right = window.innerWidth <= 768 ? '0' : 'var(--panel-width)';
    }
    // Trigger Leaflet resize
    setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
  });

  // Sound toggle
  soundToggle.addEventListener('click', () => {
    const enabled = SoundManager.toggle();
    soundIconOff.classList.toggle('hidden', enabled);
    soundIconOn.classList.toggle('hidden', !enabled);
    soundToggle.classList.toggle('active', enabled);
  });

  // Update connection status UI
  function setConnectionStatus(status) {
    connectionStatus.className = `status-dot ${status}`;
    statusText.textContent = status === 'connected' ? 'מחובר' : 'מתחבר...';
  }

  // Update alert count displays
  function updateAlertCounts() {
    const activeCount = AlertMap.getActiveCount();
    if (activeCount > 0) {
      alertCountBadge.textContent = activeCount;
      alertCountBadge.classList.remove('hidden');
    } else {
      alertCountBadge.classList.add('hidden');
    }
    panelAlertCount.textContent = `${alertHistory.length} התרעות`;
  }

  // Create alert card for panel
  function createAlertCard(alert) {
    const card = document.createElement('div');
    card.className = 'alert-card active';
    card.dataset.alertId = alert.id;

    const time = new Date(alert.timestamp);
    const timeStr = time.toLocaleTimeString('he-IL');

    card.innerHTML = `
      <div class="alert-card-header">
        <span class="alert-card-city">${alert.city}</span>
        <span class="alert-card-type type-${alert.type}">
          ${AlertMap.alertLabels[alert.type] || alert.type}
        </span>
      </div>
      <div class="alert-card-city-en">${alert.cityEn}</div>
      <div class="alert-card-countdown">⏱ ${alert.countdown} שניות למיגון</div>
      <div class="alert-card-time">${timeStr}</div>
    `;

    // Click to zoom to location
    card.addEventListener('click', () => {
      if (alert.lat && alert.lng) {
        AlertMap.fitToAlerts([alert]);
      }
    });

    // Remove active state after 30 seconds
    setTimeout(() => card.classList.remove('active'), 30000);

    return card;
  }

  // Add alerts to panel
  function addToPanel(alerts) {
    noAlerts.style.display = 'none';

    for (const alert of alerts) {
      alertHistory.unshift(alert);
      const card = createAlertCard(alert);
      alertList.insertBefore(card, alertList.firstChild);
    }

    // Trim old entries from panel (keep 200)
    while (alertList.children.length > 200) {
      alertList.removeChild(alertList.lastChild);
    }
    alertHistory = alertHistory.slice(0, 200);

    updateAlertCounts();
  }

  // Handle new alerts
  function handleAlerts(alerts) {
    // Add markers to map
    for (const alert of alerts) {
      AlertMap.addAlert(alert);
    }

    // Add to panel
    addToPanel(alerts);

    // Zoom to alerts
    AlertMap.fitToAlerts(alerts);

    // Play sound for highest priority alert type
    const hasMissiles = alerts.some(a => a.type === 'missiles');
    SoundManager.play(hasMissiles ? 'missiles' : alerts[0].type);

    // Flash page title
    flashTitle(alerts.length);

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

  // Handle init (restore state)
  function handleInit(currentAlerts, history) {
    if (history && history.length > 0) {
      addToPanel(history);
    }
    if (currentAlerts && currentAlerts.length > 0) {
      for (const alert of currentAlerts) {
        AlertMap.addAlert(alert);
      }
      AlertMap.fitToAlerts(currentAlerts);
    }
    updateAlertCounts();
  }

  // Handle clear
  function handleClear() {
    AlertMap.clearAll();
    updateAlertCounts();
  }

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
