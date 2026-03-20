// Alert module - polling-based with SSE upgrade
const AlertService = (function () {
  let eventSource = null;
  let pollInterval = null;
  let cities = {};
  const processedIds = new Set();
  const MAX_PROCESSED = 5000;
  let useSSE = false;
  let sseConnected = false;
  let historyLoaded = false;

  // Callbacks
  let onAlert = null;
  let onClear = null;
  let onConnectionChange = null;
  let onInit = null;

  async function loadCities() {
    try {
      const res = await fetch('/api/cities');
      cities = await res.json();
      console.log(`Loaded ${Object.keys(cities).length} city coordinates`);
    } catch (e) {
      console.error('Failed to load city data:', e);
    }
  }

  // Load alert history from oref history proxy
  async function loadHistory() {
    if (historyLoaded) return;
    try {
      const res = await fetch('/api/alerts/history-proxy');
      if (res.ok) {
        const history = await res.json();
        if (history && history.length > 0) {
          historyLoaded = true;
          if (onInit) onInit([], history);
        }
      }
    } catch (e) {
      console.log('History proxy unavailable, trying local history...');
      try {
        const res = await fetch('/api/alerts/history');
        if (res.ok) {
          const history = await res.json();
          if (history && history.length > 0) {
            historyLoaded = true;
            if (onInit) onInit([], history);
          }
        }
      } catch (e2) {
        // Both history sources failed, continue without history
      }
    }
  }

  // Try SSE connection (works on persistent servers, fails on serverless)
  function trySSE() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/api/alerts/sse');
    let sseTimeout = null;

    // If SSE doesn't connect within 5 seconds, give up and rely on polling
    sseTimeout = setTimeout(() => {
      if (!sseConnected) {
        console.log('SSE connection timeout, using polling mode');
        eventSource.close();
        eventSource = null;
      }
    }, 5000);

    eventSource.onopen = () => {
      sseConnected = true;
      useSSE = true;
      clearTimeout(sseTimeout);
      if (onConnectionChange) onConnectionChange('connected');
      console.log('SSE connected - using SSE mode');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'init':
            historyLoaded = true;
            if (onInit) onInit(data.alerts, data.history);
            break;

          case 'alert':
            handleNewAlerts(data.alerts);
            break;

          case 'clear':
            if (onClear) onClear();
            break;
        }
      } catch (e) {
        console.error('Error processing SSE message:', e);
      }
    };

    eventSource.onerror = () => {
      sseConnected = false;
      useSSE = false;
      // Don't show disconnected if polling is working
      if (!pollInterval) {
        if (onConnectionChange) onConnectionChange('disconnected');
      }
      // Close SSE and let polling handle it
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      clearTimeout(sseTimeout);
      console.log('SSE failed, polling mode active');
    };
  }

  // Poll /api/alerts/current every 2 seconds
  function startPolling() {
    let lastAlertIds = '';
    let consecutiveErrors = 0;
    let pollConnected = false;

    async function poll() {
      try {
        const res = await fetch('/api/alerts/current');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        consecutiveErrors = 0;

        // Mark as connected on first successful poll
        if (!pollConnected) {
          pollConnected = true;
          if (!sseConnected) {
            if (onConnectionChange) onConnectionChange('connected');
          }
        }

        if (data.alerts && data.alerts.length > 0) {
          // Check if alerts changed
          const alertIds = data.alerts.map(a => a.id).sort().join(',');
          if (alertIds !== lastAlertIds) {
            lastAlertIds = alertIds;
            handleNewAlerts(data.alerts);
          }
        } else {
          if (lastAlertIds !== '') {
            lastAlertIds = '';
            if (onClear) onClear();
          }
        }
      } catch (e) {
        consecutiveErrors++;
        if (consecutiveErrors > 5 && pollConnected) {
          pollConnected = false;
          if (!sseConnected) {
            if (onConnectionChange) onConnectionChange('disconnected');
          }
        }
      }
    }

    // Poll immediately, then every 2 seconds
    poll();
    pollInterval = setInterval(poll, 2000);
  }

  function handleNewAlerts(alerts) {
    if (!alerts || alerts.length === 0) return;

    const newAlerts = [];
    for (const alert of alerts) {
      if (processedIds.has(alert.id)) continue;
      processedIds.add(alert.id);

      // Clean up old IDs to prevent memory leak
      if (processedIds.size > MAX_PROCESSED) {
        const idsArray = Array.from(processedIds);
        for (let i = 0; i < 1000; i++) {
          processedIds.delete(idsArray[i]);
        }
      }

      newAlerts.push(alert);
    }

    if (newAlerts.length > 0 && onAlert) {
      onAlert(newAlerts);
    }
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  return {
    async init(callbacks) {
      onAlert = callbacks.onAlert;
      onClear = callbacks.onClear;
      onConnectionChange = callbacks.onConnectionChange;
      onInit = callbacks.onInit;

      await loadCities();

      // Start polling immediately (works everywhere)
      startPolling();

      // Load alert history from tzevaadom
      loadHistory();

      // Try SSE as an upgrade (works on persistent servers)
      trySSE();
    },

    disconnect,
    getCities() { return cities; }
  };
})();
