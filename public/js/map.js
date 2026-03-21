// Map module - Leaflet map with alert markers
const AlertMap = (function () {
  let map = null;
  let currentTileLayer = null;
  let currentStyleId = null;
  const markers = new Map(); // alertId -> { marker, timeout }
  const MARKER_LIFETIME = 5 * 60 * 1000; // 5 minutes

  const alertColors = {
    missiles: '#ef4444',
    hostile_aircraft: '#f97316',
    earthquake: '#3b82f6',
    infiltration: '#f97316',
    general: '#eab308',
    radiological: '#eab308',
    chemical: '#eab308',
    tsunami: '#eab308'
  };

  const alertLabels = {
    missiles: 'צבע אדום - רקטות וטילים',
    hostile_aircraft: 'חדירת כלי טיס עוין',
    earthquake: 'רעידת אדמה',
    infiltration: 'חדירת מחבלים',
    general: 'אירוע כללי',
    radiological: 'איום רדיולוגי',
    chemical: 'איום כימי',
    tsunami: 'צונאמי'
  };

  const alertLabelsEn = {
    missiles: 'Red Alert - Rockets & Missiles',
    hostile_aircraft: 'Hostile Aircraft Intrusion',
    earthquake: 'Earthquake',
    infiltration: 'Terrorist Infiltration',
    general: 'General Emergency',
    radiological: 'Radiological Threat',
    chemical: 'Chemical Threat',
    tsunami: 'Tsunami'
  };

  // Available map tile styles
  const tileStyles = [
    {
      id: 'carto-dark',
      name: 'Dark',
      theme: 'dark',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    },
    {
      id: 'carto-light',
      name: 'Light',
      theme: 'light',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    },
    {
      id: 'osm',
      name: 'OpenStreetMap',
      theme: 'light',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    },
    {
      id: 'google-streets',
      name: 'Google Streets',
      theme: 'light',
      url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      attribution: '&copy; Google',
      maxZoom: 20
    },
    {
      id: 'google-satellite',
      name: 'Google Satellite',
      theme: 'dark',
      url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      attribution: '&copy; Google',
      maxZoom: 20
    },
    {
      id: 'google-hybrid',
      name: 'Google Hybrid',
      theme: 'dark',
      url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      attribution: '&copy; Google',
      maxZoom: 20
    },
    {
      id: 'esri-satellite',
      name: 'Esri Satellite',
      theme: 'dark',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri',
      maxZoom: 18
    },
    {
      id: 'esri-topo',
      name: 'Esri Topographic',
      theme: 'light',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri',
      maxZoom: 18
    }
  ];

  function setTileStyle(styleId) {
    const style = tileStyles.find(s => s.id === styleId);
    if (!style) return;

    if (currentTileLayer) {
      map.removeLayer(currentTileLayer);
    }

    const opts = {
      attribution: style.attribution,
      maxZoom: style.maxZoom || 19
    };
    if (style.subdomains) opts.subdomains = style.subdomains;

    currentTileLayer = L.tileLayer(style.url, opts).addTo(map);
    currentStyleId = style.id;

    // Apply light/dark theme to the page
    document.documentElement.setAttribute('data-theme', style.theme);

    // Persist choice
    try { localStorage.setItem('mapStyle', style.id); } catch (e) {}

    return style;
  }

  function createStyleControl() {
    const control = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'map-style-control leaflet-bar');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        // Toggle button
        const btn = L.DomUtil.create('button', 'map-style-btn', container);
        btn.title = 'Map style';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

        // Dropdown
        const dropdown = L.DomUtil.create('div', 'map-style-dropdown', container);
        dropdown.style.display = 'none';

        for (const style of tileStyles) {
          const item = L.DomUtil.create('button', 'map-style-item', dropdown);
          item.textContent = style.name;
          item.dataset.styleId = style.id;
          if (style.id === currentStyleId) item.classList.add('active');

          item.addEventListener('click', () => {
            setTileStyle(style.id);
            dropdown.querySelectorAll('.map-style-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            dropdown.style.display = 'none';
          });
        }

        btn.addEventListener('click', () => {
          dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
        });

        // Close dropdown when clicking outside
        map.on('click', () => { dropdown.style.display = 'none'; });

        return container;
      }
    });
    new control().addTo(map);
  }

  function init() {
    map = L.map('map', {
      center: [31.5, 34.85],
      zoom: 8,
      zoomControl: true,
      attributionControl: true
    });

    // Load saved style or default to dark
    const savedStyle = (() => { try { return localStorage.getItem('mapStyle'); } catch (e) { return null; } })();
    setTileStyle(savedStyle || 'carto-dark');

    // Add style selector control
    createStyleControl();

    return map;
  }

  function addAlert(alert) {
    if (!alert.lat || !alert.lng) return;

    const id = alert.id;
    if (markers.has(id)) {
      removeMarker(id);
    }

    const color = alertColors[alert.type] || alertColors.general;

    // Simple static circle marker — no animations, no labels
    const marker = L.circleMarker([alert.lat, alert.lng], {
      radius: 7,
      color: color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2,
      opacity: 0.9
    }).addTo(map);

    // Popup on click only
    const time = new Date(alert.timestamp);
    const timeStr = time.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' });
    const countdownText = alert.countdown === 0 ? 'מיידי' : `${alert.countdown} שניות`;
    const areaHtml = alert.area ? `<div class="popup-area">${alert.area}</div>` : '';
    const popupHtml = `
      <div class="popup-content">
        <div class="popup-city">${alert.city}</div>
        ${areaHtml}
        <div class="popup-type popup-type-${alert.type}">
          ${alertLabels[alert.type] || alert.type}
        </div>
        <div class="popup-countdown">${countdownText}</div>
        <div class="popup-countdown-label">זמן למיגון</div>
        <div class="popup-time">${timeStr}</div>
      </div>
    `;

    marker.bindPopup(popupHtml, {
      className: 'alert-popup',
      maxWidth: 250
    });

    const timeout = setTimeout(() => removeMarker(id), MARKER_LIFETIME);
    markers.set(id, { marker, timeout });
  }

  function removeMarker(id) {
    const entry = markers.get(id);
    if (!entry) return;
    map.removeLayer(entry.marker);
    clearTimeout(entry.timeout);
    markers.delete(id);
  }

  function clearAll() {
    for (const [id] of markers) {
      removeMarker(id);
    }
  }

  function fitToAlerts(alerts) {
    if (!alerts || alerts.length === 0) return;
    const validAlerts = alerts.filter(a => a.lat && a.lng);
    if (validAlerts.length === 0) return;

    if (validAlerts.length === 1) {
      map.setView([validAlerts[0].lat, validAlerts[0].lng], 12, { animate: true });
    } else {
      const bounds = L.latLngBounds(validAlerts.map(a => [a.lat, a.lng]));
      map.fitBounds(bounds.pad(0.3), { animate: true, maxZoom: 12 });
    }
  }

  function getActiveCount() {
    return markers.size;
  }

  function panTo(lat, lng) {
    map.panTo([lat, lng], { animate: true });
  }

  // === History event preview (click on panel card) ===
  let historyMarkers = []; // array of L.circleMarker
  let activeHistoryEventId = null;

  function clearHistoryMarkers() {
    for (const m of historyMarkers) {
      map.removeLayer(m);
    }
    historyMarkers = [];
    activeHistoryEventId = null;
  }

  // Show markers for a history event's cities, fit map to them
  // Returns the eventId shown, or null if toggled off
  function showHistoryEvent(event) {
    // Toggle off if clicking the same event
    if (activeHistoryEventId === event.eventId) {
      clearHistoryMarkers();
      return null;
    }

    clearHistoryMarkers();
    activeHistoryEventId = event.eventId;

    const color = alertColors[event.type] || alertColors.general;
    const validCities = event.cities.filter(c => c.lat && c.lng);

    for (const city of validCities) {
      const timeStr = new Date(city.timeMs).toLocaleTimeString('he-IL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Jerusalem'
      });
      const countdownText = city.countdown === 0 ? 'מיידי' : `${city.countdown} שניות`;

      const m = L.circleMarker([city.lat, city.lng], {
        radius: 7,
        color: color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2,
        opacity: 0.9
      }).addTo(map);

      m.bindPopup(`
        <div class="popup-content">
          <div class="popup-city">${city.city}</div>
          <div class="popup-type popup-type-${event.type}">
            ${alertLabels[event.type] || event.type}
          </div>
          <div class="popup-countdown">${countdownText}</div>
          <div class="popup-countdown-label">זמן למיגון</div>
          <div class="popup-time">${timeStr}</div>
        </div>
      `, { className: 'alert-popup', maxWidth: 250 });

      historyMarkers.push(m);
    }

    // Fit map to the event's cities
    if (validCities.length === 1) {
      map.setView([validCities[0].lat, validCities[0].lng], 12, { animate: true });
    } else if (validCities.length > 1) {
      const bounds = L.latLngBounds(validCities.map(c => [c.lat, c.lng]));
      map.fitBounds(bounds.pad(0.3), { animate: true, maxZoom: 12 });
    }

    return event.eventId;
  }

  return { init, addAlert, removeMarker, clearAll, fitToAlerts, panTo, getActiveCount, showHistoryEvent, clearHistoryMarkers, alertLabels, alertLabelsEn };
})();
