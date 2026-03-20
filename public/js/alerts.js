// Alert module - SSE connection and alert processing
const AlertService = (function () {
  let eventSource = null;
  let reconnectAttempts = 0;
  let cities = {};
  const processedIds = new Set();
  const MAX_PROCESSED = 5000;

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

  function connect() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/api/alerts/sse');

    eventSource.onopen = () => {
      reconnectAttempts = 0;
      if (onConnectionChange) onConnectionChange('connected');
      console.log('SSE connected');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'init':
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
      if (onConnectionChange) onConnectionChange('disconnected');

      // EventSource auto-reconnects, but we track attempts
      reconnectAttempts++;
      if (reconnectAttempts > 10) {
        console.log('Too many reconnection attempts, backing off...');
        eventSource.close();
        setTimeout(connect, 5000);
      }
    };
  }

  function handleNewAlerts(alerts) {
    if (!alerts || alerts.length === 0) return;

    const newAlerts = [];
    for (const alert of alerts) {
      // Deduplicate
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
  }

  return {
    async init(callbacks) {
      onAlert = callbacks.onAlert;
      onClear = callbacks.onClear;
      onConnectionChange = callbacks.onConnectionChange;
      onInit = callbacks.onInit;

      await loadCities();
      connect();
    },

    disconnect,
    getCities() { return cities; }
  };
})();
