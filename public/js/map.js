// Map module - Leaflet map with alert markers
const AlertMap = (function () {
  let map = null;
  const markers = new Map(); // alertId -> { marker, circle, timeout }
  const directionArrows = new Map(); // eventId -> { line, arrowhead, timeout }
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
    // Remove existing marker for same alert
    if (markers.has(id)) {
      removeMarker(id);
    }

    const color = alertColors[alert.type] || alertColors.general;

    // Create pulsing circle marker
    const size = 16;
    const pulseIcon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative; width:${size}px; height:${size}px;">
          <div class="alert-marker alert-marker-${alert.type}"
               style="width:${size}px; height:${size}px; position:absolute; top:0; left:0;"></div>
          <div class="alert-marker alert-marker-${alert.type}"
               style="width:${size}px; height:${size}px; position:absolute; top:0; left:0; animation-delay:0.5s;"></div>
          <div style="width:8px; height:8px; border-radius:50%; background:white;
                      position:absolute; top:4px; left:4px; z-index:10;"></div>
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });

    const marker = L.marker([alert.lat, alert.lng], { icon: pulseIcon }).addTo(map);

    // Permanent Hebrew city name label on the map
    marker.bindTooltip(alert.city, {
      permanent: true,
      direction: 'top',
      offset: [0, -12],
      className: 'city-tooltip'
    });

    // Popup content
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

    // Also add a larger transparent circle for area effect
    const circle = L.circle([alert.lat, alert.lng], {
      radius: 2000,
      color: color,
      fillColor: color,
      fillOpacity: 0.08,
      weight: 1,
      opacity: 0.3
    }).addTo(map);

    // Auto-remove after MARKER_LIFETIME
    const timeout = setTimeout(() => removeMarker(id), MARKER_LIFETIME);

    markers.set(id, { marker, circle, timeout });
  }

  function removeMarker(id) {
    const entry = markers.get(id);
    if (!entry) return;
    map.removeLayer(entry.marker);
    map.removeLayer(entry.circle);
    clearTimeout(entry.timeout);
    markers.delete(id);
  }

  function clearAll() {
    for (const [id] of markers) {
      removeMarker(id);
    }
    for (const [eid] of directionArrows) {
      removeDirection(eid);
    }
  }

  // === Missile Direction Arrows ===

  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }

  // Haversine distance in km
  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Bearing in degrees (0=N, 90=E, 180=S, 270=W)
  function computeBearing(lat1, lng1, lat2, lng2) {
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // 8-direction compass in Hebrew
  function bearingToHebrew(deg) {
    const dirs = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];
    return dirs[Math.round(deg / 45) % 8];
  }

  function centroid(cities) {
    const n = cities.length;
    return {
      lat: cities.reduce((s, c) => s + c.lat, 0) / n,
      lng: cities.reduce((s, c) => s + c.lng, 0) / n
    };
  }

  function removeDirection(eventId) {
    const entry = directionArrows.get(eventId);
    if (!entry) return;
    map.removeLayer(entry.line);
    map.removeLayer(entry.arrowhead);
    clearTimeout(entry.timeout);
    directionArrows.delete(eventId);
  }

  function updateDirection(event) {
    if (event.type !== 'missiles' && event.type !== 'hostile_aircraft') return;

    const validCities = event.cities.filter(c => c.lat && c.lng);
    if (validCities.length < 3) return;

    // Sort: earliest time first, then lowest countdown (closest to origin)
    validCities.sort((a, b) => (a.timeMs - b.timeMs) || (a.countdown - b.countdown));

    const mid = Math.ceil(validCities.length / 2);
    const earlyHalf = validCities.slice(0, mid);
    const lateHalf = validCities.slice(mid);

    const origin = centroid(earlyHalf);
    const dest = centroid(lateHalf);

    const dist = distanceKm(origin.lat, origin.lng, dest.lat, dest.lng);
    if (dist < 2) return; // too close, no meaningful direction

    // Remove existing arrow for this event
    if (directionArrows.has(event.eventId)) {
      removeDirection(event.eventId);
    }

    const bearing = computeBearing(origin.lat, origin.lng, dest.lat, dest.lng);
    const color = alertColors[event.type] || alertColors.missiles;

    // Extend arrow 20% beyond destination centroid
    const extLat = dest.lat + (dest.lat - origin.lat) * 0.2;
    const extLng = dest.lng + (dest.lng - origin.lng) * 0.2;

    // Draw dashed arrow line
    const line = L.polyline(
      [[origin.lat, origin.lng], [extLat, extLng]],
      {
        color: color,
        weight: 3,
        opacity: 0.7,
        dashArray: '8, 12',
        lineCap: 'round'
      }
    ).addTo(map);

    // Arrowhead: rotated triangle at the tip
    const arrowSize = 18;
    const arrowIcon = L.divIcon({
      className: '',
      html: `<div class="direction-arrowhead" style="transform: rotate(${bearing}deg);">
        <svg width="${arrowSize}" height="${arrowSize}" viewBox="0 0 24 24">
          <path d="M12 2 L22 22 L12 17 L2 22 Z" fill="${color}" opacity="0.9"/>
        </svg>
      </div>`,
      iconSize: [arrowSize, arrowSize],
      iconAnchor: [arrowSize / 2, arrowSize / 2]
    });

    const arrowhead = L.marker([extLat, extLng], { icon: arrowIcon, interactive: true }).addTo(map);

    // Direction label: "from → to" in Hebrew
    const fromDir = bearingToHebrew((bearing + 180) % 360);
    const toDir = bearingToHebrew(bearing);
    arrowhead.bindTooltip(`${fromDir} → ${toDir}`, {
      permanent: true,
      direction: 'top',
      offset: [0, -14],
      className: 'direction-label'
    });

    const timeout = setTimeout(() => removeDirection(event.eventId), MARKER_LIFETIME);
    directionArrows.set(event.eventId, { line, arrowhead, timeout });
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

  return { init, addAlert, removeMarker, clearAll, fitToAlerts, panTo, getActiveCount, updateDirection, alertLabels, alertLabelsEn };
})();
