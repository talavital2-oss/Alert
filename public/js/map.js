// Map module - Leaflet map with alert markers + MapLibre GL 3D mode
// 3D mode uses MapLibre GL JS (free, open source) + OpenFreeMap tiles (free, no API key)
// Enable RTL text (Hebrew/Arabic) in MapLibre GL
maplibregl.setRTLTextPlugin(
  'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
  true // lazy-load
);

const AlertMap = (function () {
  let map = null;           // Leaflet map
  let glMap = null;          // MapLibre GL map
  let useGL = false;         // true when showing MapLibre GL
  let currentTileLayer = null;
  let currentStyleId = null;
  let styleControlContainer = null;
  const markers = new Map(); // alertId -> { marker, glMarker, timeout, data }
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

  // ── Leaflet tile styles (2D) ──
  const tileStyles = [
    {
      id: 'carto-dark', name: 'Dark', theme: 'dark',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20
    },
    {
      id: 'carto-light', name: 'Light', theme: 'light',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20
    },
    {
      id: 'osm', name: 'OpenStreetMap', theme: 'light',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    },
    {
      id: 'google-streets', name: 'Google Streets', theme: 'light',
      url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      attribution: '&copy; Google', maxZoom: 20
    },
    {
      id: 'google-satellite', name: 'Google Satellite', theme: 'dark',
      url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      attribution: '&copy; Google', maxZoom: 20
    },
    {
      id: 'google-hybrid', name: 'Google Hybrid', theme: 'dark',
      url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      attribution: '&copy; Google', maxZoom: 20
    },
    {
      id: 'esri-satellite', name: 'Esri Satellite', theme: 'dark',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri', maxZoom: 18
    },
    {
      id: 'esri-topo', name: 'Esri Topographic', theme: 'light',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri', maxZoom: 18
    }
  ];

  // ── MapLibre GL 3D styles (free, no API key) ──
  const glStyles = [
    { id: 'gl-3d-liberty', name: '3D Liberty', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/liberty' },
    { id: 'gl-3d-bright', name: '3D Bright', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/bright' },
    { id: 'gl-3d-positron', name: '3D Positron', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/positron' }
  ];

  // All styles for the dropdown
  const allStyles = [
    ...tileStyles.map(s => ({ ...s, renderer: 'leaflet' })),
    ...glStyles.map(s => ({ ...s, renderer: 'maplibre' }))
  ];

  // ── MapLibre GL helpers ──
  function createGLMarkerEl(color) {
    const el = document.createElement('div');
    el.className = 'gl-marker';
    el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid ${color};opacity:0.9;box-shadow:0 0 6px ${color};cursor:pointer;`;
    return el;
  }

  function buildPopupHtml(cityName, alertType, countdownText, timeStr) {
    return `
      <div class="popup-content" style="font-family:'Assistant',sans-serif;text-align:center;direction:rtl;padding:4px;">
        <div style="font-size:16px;font-weight:700;margin-bottom:2px;">${cityName}</div>
        <div style="font-size:12px;padding:2px 10px;border-radius:6px;display:inline-block;margin:6px 0;font-weight:600;background:rgba(239,68,68,0.2);color:${alertColors[alertType] || '#eab308'}">
          ${alertLabels[alertType] || alertType}
        </div>
        <div style="font-size:24px;font-weight:800;color:#ef4444;">${countdownText}</div>
        <div style="font-size:11px;color:#9ca3af;">זמן למיגון</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px;">${timeStr}</div>
      </div>
    `;
  }

  function addGLMarker(id, lat, lng, color, popupHtml) {
    if (!glMap) return null;
    const el = createGLMarkerEl(color);
    const popup = new maplibregl.Popup({ offset: 12, maxWidth: '250px' }).setHTML(popupHtml);
    const glMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).setPopup(popup).addTo(glMap);
    return glMarker;
  }

  function syncMarkersToGL() {
    if (!glMap) return;
    for (const [id, entry] of markers) {
      if (entry.glMarker) { entry.glMarker.remove(); entry.glMarker = null; }
      const a = entry.data;
      if (!a.lat || !a.lng) continue;
      const color = alertColors[a.type] || alertColors.general;
      const timeStr = new Date(a.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' });
      const countdownText = a.countdown === 0 ? 'מיידי' : `${a.countdown} שניות`;
      const popupHtml = buildPopupHtml(a.city, a.type, countdownText, timeStr);
      entry.glMarker = addGLMarker(id, a.lat, a.lng, color, popupHtml);
    }
    syncHistoryMarkersToGL();
  }

  function clearGLMarkers() {
    for (const [, entry] of markers) {
      if (entry.glMarker) { entry.glMarker.remove(); entry.glMarker = null; }
    }
    clearGLHistoryMarkers();
  }

  // ── Add 3D buildings layer to the GL map ──
  function add3DBuildings() {
    if (!glMap) return;
    const style = glMap.getStyle();
    if (!style || !style.layers) return;

    // Remove existing 3d-buildings layer if present
    if (glMap.getLayer('3d-buildings')) return;

    // Find a suitable source with building data
    // OpenFreeMap uses openmaptiles schema — building data is in the 'building' source-layer
    const sources = style.sources;
    let vectorSourceId = null;
    for (const [srcId, src] of Object.entries(sources)) {
      if (src.type === 'vector') {
        vectorSourceId = srcId;
        break;
      }
    }
    if (!vectorSourceId) return;

    // Find label layer to insert buildings below
    const labelLayer = style.layers.find(l => l.type === 'symbol' && l.layout && l.layout['text-field']);

    glMap.addLayer({
      id: '3d-buildings',
      source: vectorSourceId,
      'source-layer': 'building',
      filter: ['all', ['!=', 'hide_3d', true]],
      type: 'fill-extrusion',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['get', 'render_height'],
          0, '#e8e8e8',
          50, '#d4d4d4',
          100, '#bbb'
        ],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          14, ['get', 'render_height']
        ],
        'fill-extrusion-base': ['case',
          ['has', 'render_min_height'], ['get', 'render_min_height'],
          0
        ],
        'fill-extrusion-opacity': 0.7
      }
    }, labelLayer ? labelLayer.id : undefined);
  }

  // ── Switch between Leaflet and MapLibre GL ──
  function activateLeaflet() {
    document.getElementById('map').style.display = '';
    document.getElementById('map-gl').style.display = 'none';
    useGL = false;
    if (glMap) {
      const center = glMap.getCenter();
      const zoom = glMap.getZoom();
      map.setView([center.lat, center.lng], Math.round(zoom), { animate: false });
    }
    clearGLMarkers();
    map.invalidateSize();
  }

  function activateGL(styleUrl) {
    const leafletCenter = map.getCenter();
    const leafletZoom = map.getZoom();

    document.getElementById('map').style.display = 'none';
    document.getElementById('map-gl').style.display = '';

    if (glMap) {
      // Change style on existing map
      glMap.setStyle(styleUrl);
    } else {
      glMap = new maplibregl.Map({
        container: 'map-gl',
        style: styleUrl,
        center: [leafletCenter.lng, leafletCenter.lat],
        zoom: leafletZoom,
        pitch: 50,
        bearing: -10,
        antialias: true,
        maxPitch: 70
      });

      glMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    }

    // Add 3D buildings and markers after each style load
    glMap.once('style.load', () => {
      add3DBuildings();
      syncMarkersToGL();
    });

    useGL = true;

    // If style already loaded, add buildings now
    if (glMap.isStyleLoaded()) {
      add3DBuildings();
      syncMarkersToGL();
    }

    return true;
  }

  // ── Set style (unified for both renderers) ──
  function setTileStyle(styleId) {
    const style = allStyles.find(s => s.id === styleId);
    if (!style) return;

    if (style.renderer === 'maplibre') {
      activateGL(style.styleUrl);
    } else {
      activateLeaflet();
      if (currentTileLayer) map.removeLayer(currentTileLayer);
      const opts = { attribution: style.attribution, maxZoom: style.maxZoom || 19 };
      if (style.subdomains) opts.subdomains = style.subdomains;
      currentTileLayer = L.tileLayer(style.url, opts).addTo(map);
    }

    currentStyleId = style.id;
    document.documentElement.setAttribute('data-theme', style.theme);
    try { localStorage.setItem('mapStyle', style.id); } catch (e) {}

    return style;
  }

  // ── Style control (floating, works over both maps) ──
  function createStyleControl() {
    styleControlContainer = document.createElement('div');
    styleControlContainer.className = 'map-style-control-float';

    const btn = document.createElement('button');
    btn.className = 'map-style-btn';
    btn.title = 'Map style';
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

    const dropdown = document.createElement('div');
    dropdown.className = 'map-style-dropdown';
    dropdown.style.display = 'none';

    // 2D Maps group
    const leafletLabel = document.createElement('div');
    leafletLabel.className = 'map-style-group-label';
    leafletLabel.textContent = '2D Maps';
    dropdown.appendChild(leafletLabel);

    for (const style of tileStyles) {
      const item = document.createElement('button');
      item.className = 'map-style-item';
      item.textContent = style.name;
      item.dataset.styleId = style.id;
      if (style.id === currentStyleId) item.classList.add('active');
      item.addEventListener('click', () => {
        setTileStyle(style.id);
        dropdown.querySelectorAll('.map-style-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(item);
    }

    // 3D Maps group
    const glLabel = document.createElement('div');
    glLabel.className = 'map-style-group-label';
    glLabel.textContent = '3D Maps';
    dropdown.appendChild(glLabel);

    for (const style of glStyles) {
      const item = document.createElement('button');
      item.className = 'map-style-item';
      item.textContent = style.name;
      item.dataset.styleId = style.id;
      if (style.id === currentStyleId) item.classList.add('active');
      item.addEventListener('click', () => {
        setTileStyle(style.id);
        dropdown.querySelectorAll('.map-style-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(item);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!styleControlContainer.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    styleControlContainer.appendChild(btn);
    styleControlContainer.appendChild(dropdown);
    document.body.appendChild(styleControlContainer);
  }

  // ── Init ──
  function init() {
    map = L.map('map', {
      center: [31.5, 34.85],
      zoom: 8,
      zoomControl: true,
      attributionControl: true
    });

    document.getElementById('map-gl').style.display = 'none';

    const savedStyle = (() => { try { return localStorage.getItem('mapStyle'); } catch (e) { return null; } })();
    setTileStyle(savedStyle || 'carto-dark');

    createStyleControl();

    return map;
  }

  // ── Alert markers ──
  function addAlert(alert) {
    if (!alert.lat || !alert.lng) return;
    const id = alert.id;
    if (markers.has(id)) removeMarker(id);

    const color = alertColors[alert.type] || alertColors.general;

    // Leaflet marker
    const marker = L.circleMarker([alert.lat, alert.lng], {
      radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2, opacity: 0.9
    }).addTo(map);

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
    marker.bindPopup(popupHtml, { className: 'alert-popup', maxWidth: 250 });

    // GL marker (if 3D mode active)
    let glMarker = null;
    if (useGL && glMap) {
      const glPopupHtml = buildPopupHtml(alert.city, alert.type, countdownText, timeStr);
      glMarker = addGLMarker(id, alert.lat, alert.lng, color, glPopupHtml);
    }

    const timeout = setTimeout(() => removeMarker(id), MARKER_LIFETIME);
    markers.set(id, { marker, glMarker, timeout, data: alert });
  }

  function removeMarker(id) {
    const entry = markers.get(id);
    if (!entry) return;
    map.removeLayer(entry.marker);
    if (entry.glMarker) entry.glMarker.remove();
    clearTimeout(entry.timeout);
    markers.delete(id);
  }

  function clearAll() {
    for (const [id] of markers) removeMarker(id);
  }

  function fitToAlerts(alerts) {
    if (!alerts || alerts.length === 0) return;
    const validAlerts = alerts.filter(a => a.lat && a.lng);
    if (validAlerts.length === 0) return;

    if (useGL && glMap) {
      if (validAlerts.length === 1) {
        glMap.flyTo({ center: [validAlerts[0].lng, validAlerts[0].lat], zoom: 12 });
      } else {
        const bounds = new maplibregl.LngLatBounds();
        validAlerts.forEach(a => bounds.extend([a.lng, a.lat]));
        glMap.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      }
    } else {
      if (validAlerts.length === 1) {
        map.setView([validAlerts[0].lat, validAlerts[0].lng], 12, { animate: true });
      } else {
        const bounds = L.latLngBounds(validAlerts.map(a => [a.lat, a.lng]));
        map.fitBounds(bounds.pad(0.3), { animate: true, maxZoom: 12 });
      }
    }
  }

  function getActiveCount() {
    return markers.size;
  }

  function panTo(lat, lng) {
    if (useGL && glMap) {
      glMap.flyTo({ center: [lng, lat], zoom: glMap.getZoom() });
    } else {
      map.panTo([lat, lng], { animate: true });
    }
  }

  // ── History event preview ──
  let historyMarkers = [];
  let glHistoryMarkers = [];
  let activeHistoryEventId = null;
  let activeHistoryEvent = null;

  function clearHistoryMarkers() {
    for (const m of historyMarkers) map.removeLayer(m);
    historyMarkers = [];
    clearGLHistoryMarkers();
    activeHistoryEventId = null;
    activeHistoryEvent = null;
  }

  function clearGLHistoryMarkers() {
    for (const m of glHistoryMarkers) m.remove();
    glHistoryMarkers = [];
  }

  function syncHistoryMarkersToGL() {
    clearGLHistoryMarkers();
    if (!activeHistoryEvent || !glMap) return;
    const event = activeHistoryEvent;
    const color = alertColors[event.type] || alertColors.general;
    const validCities = event.cities.filter(c => c.lat && c.lng);

    for (const city of validCities) {
      const timeStr = new Date(city.timeMs).toLocaleTimeString('he-IL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem'
      });
      const countdownText = city.countdown === 0 ? 'מיידי' : `${city.countdown} שניות`;
      const popupHtml = buildPopupHtml(city.city, event.type, countdownText, timeStr);
      const glM = addGLMarker('hist-' + city.city, city.lat, city.lng, color, popupHtml);
      if (glM) glHistoryMarkers.push(glM);
    }
  }

  function showHistoryEvent(event) {
    if (activeHistoryEventId === event.eventId) {
      clearHistoryMarkers();
      return null;
    }

    clearHistoryMarkers();
    activeHistoryEventId = event.eventId;
    activeHistoryEvent = event;

    const color = alertColors[event.type] || alertColors.general;
    const validCities = event.cities.filter(c => c.lat && c.lng);

    // Leaflet markers
    for (const city of validCities) {
      const timeStr = new Date(city.timeMs).toLocaleTimeString('he-IL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem'
      });
      const countdownText = city.countdown === 0 ? 'מיידי' : `${city.countdown} שניות`;
      const m = L.circleMarker([city.lat, city.lng], {
        radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2, opacity: 0.9
      }).addTo(map);
      m.bindPopup(`
        <div class="popup-content">
          <div class="popup-city">${city.city}</div>
          <div class="popup-type popup-type-${event.type}">${alertLabels[event.type] || event.type}</div>
          <div class="popup-countdown">${countdownText}</div>
          <div class="popup-countdown-label">זמן למיגון</div>
          <div class="popup-time">${timeStr}</div>
        </div>
      `, { className: 'alert-popup', maxWidth: 250 });
      historyMarkers.push(m);
    }

    // GL markers
    if (useGL && glMap) syncHistoryMarkersToGL();

    // Fit view
    if (useGL && glMap) {
      if (validCities.length === 1) {
        glMap.flyTo({ center: [validCities[0].lng, validCities[0].lat], zoom: 12 });
      } else if (validCities.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        validCities.forEach(c => bounds.extend([c.lng, c.lat]));
        glMap.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      }
    } else {
      if (validCities.length === 1) {
        map.setView([validCities[0].lat, validCities[0].lng], 12, { animate: true });
      } else if (validCities.length > 1) {
        const bounds = L.latLngBounds(validCities.map(c => [c.lat, c.lng]));
        map.fitBounds(bounds.pad(0.3), { animate: true, maxZoom: 12 });
      }
    }

    return event.eventId;
  }

  return { init, addAlert, removeMarker, clearAll, fitToAlerts, panTo, getActiveCount, showHistoryEvent, clearHistoryMarkers, alertLabels, alertLabelsEn };
})();
