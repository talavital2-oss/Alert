// Alert module - polling-based with SSE upgrade
const AlertService = (function () {
  let eventSource = null;
  let pollInterval = null;
  let cities = {};
  let useSSE = false;
  let sseConnected = false;
  let historyLoaded = false;

  // Callbacks: onAlert(alerts, events), onClear(), onConnectionChange(status), onInit(alerts, events)
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

  // Load alert history
  async function loadHistory() {
    if (historyLoaded) return;
    try {
      const res = await fetch('/api/alerts/history-proxy');
      if (res.ok) {
        const data = await res.json();
        const events = data.events || [];
        const alerts = data.alerts || [];
        if (events.length > 0 || alerts.length > 0) {
          historyLoaded = true;
          if (onInit) onInit(alerts, events);
        }
      }
    } catch (e) {
      console.log('History proxy unavailable');
    }
  }

  // Try SSE connection (works on persistent servers, fails on serverless)
  function trySSE() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/api/alerts/sse');
    let sseTimeout = null;

    sseTimeout = setTimeout(() => {
      if (!sseConnected) {
        console.log('SSE connection timeout, using polling mode');
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
      }
    }, 5000);

    eventSource.onopen = () => {
      sseConnected = true;
      useSSE = true;
      clearTimeout(sseTimeout);
      if (onConnectionChange) onConnectionChange('connected');
      console.log('SSE connected');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'init':
            historyLoaded = true;
            if (onInit) onInit(data.alerts || [], data.events || data.history || []);
            break;

          case 'alert':
            if (onAlert) onAlert(data.alerts || [], data.events || []);
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
      if (!pollInterval) {
        if (onConnectionChange) onConnectionChange('disconnected');
      }
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
    let lastEventIds = '';
    let consecutiveErrors = 0;
    let pollConnected = false;
    let forceNext = false;

    async function poll() {
      try {
        const res = await fetch('/api/alerts/current');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        consecutiveErrors = 0;

        if (!pollConnected) {
          pollConnected = true;
          if (!sseConnected) {
            if (onConnectionChange) onConnectionChange('connected');
          }
        }

        const events = data.events || [];
        const alerts = data.alerts || [];

        if (events.length > 0) {
          const eventIds = events.map(e => e.eventId).sort().join(',');
          if (eventIds !== lastEventIds || forceNext) {
            lastEventIds = eventIds;
            forceNext = false;
            if (onAlert) onAlert(alerts, events);
          }
        } else {
          if (lastEventIds !== '' || forceNext) {
            lastEventIds = '';
            forceNext = false;
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

    // When tab becomes visible again, force an immediate poll
    // Browsers throttle setInterval to ~1/min for background tabs,
    // so alerts can be missed while the tab is hidden
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('Tab visible again, forcing poll');
        forceNext = true;
        poll();
      }
    });

    poll();
    pollInterval = setInterval(poll, 2000);
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
