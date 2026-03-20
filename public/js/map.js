// Map module - Leaflet map with alert markers
const AlertMap = (function () {
  let map = null;
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

  function init() {
    map = L.map('map', {
      center: [31.5, 34.85],
      zoom: 8,
      zoomControl: true,
      attributionControl: true
    });

    // CartoDB Dark Matter tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

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

  return { init, addAlert, removeMarker, clearAll, fitToAlerts, panTo, getActiveCount, alertLabels, alertLabelsEn };
})();
