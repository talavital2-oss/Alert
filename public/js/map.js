// Map module - Leaflet map with alert markers + Mapbox GL 3D mode
const AlertMap = (function () {
  // ── Mapbox token ──
  // Replace with your token from https://account.mapbox.com/access-tokens/
  const MAPBOX_TOKEN = 'YOUR_MAPBOX_TOKEN_HERE';

  let map = null;           // Leaflet map
  let glMap = null;          // Mapbox GL map
  let useGL = false;         // true when showing Mapbox GL
  let currentTileLayer = null;
  let currentStyleId = null;
  let styleControlContainer = null; // floating control (shared)
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

  // ── Tile styles (Leaflet-based) ──
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

  // ── Mapbox GL styles ──
  const glStyles = [
    { id: 'mapbox-3d-dark', name: '3D Dark', theme: 'dark', mapboxStyle: 'mapbox://styles/mapbox/dark-v11' },
    { id: 'mapbox-3d-light', name: '3D Light', theme: 'light', mapboxStyle: 'mapbox://styles/mapbox/light-v11' },
    { id: 'mapbox-3d-streets', name: '3D Streets', theme: 'light', mapboxStyle: 'mapbox://styles/mapbox/streets-v12' },
    { id: 'mapbox-3d-satellite', name: '3D Satellite', theme: 'dark', mapboxStyle: 'mapbox://styles/mapbox/satellite-streets-v12' }
  ];

  // All styles for the dropdown
  const allStyles = [
    ...tileStyles.map(s => ({ ...s, renderer: 'leaflet' })),
    ...glStyles.map(s => ({ ...s, renderer: 'mapbox' }))
  ];

  // ── Mapbox GL helpers ──
  function hasMapboxToken() {
    return MAPBOX_TOKEN && MAPBOX_TOKEN !== 'YOUR_MAPBOX_TOKEN_HERE';
  }

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

  // Add a marker to the GL map
  function addGLMarker(id, lat, lng, color, popupHtml) {
    if (!glMap) return null;
    const el = createGLMarkerEl(color);
    const popup = new mapboxgl.Popup({ offset: 12, maxWidth: '250px' }).setHTML(popupHtml);
    const glMarker = new mapboxgl.Marker(el).setLngLat([lng, lat]).setPopup(popup).addTo(glMap);
    return glMarker;
  }

  // Sync all current markers to GL map
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
    // Also sync history markers
    syncHistoryMarkersToGL();
  }

  // Remove all GL markers
  function clearGLMarkers() {
    for (const [, entry] of markers) {
      if (entry.glMarker) { entry.glMarker.remove(); entry.glMarker = null; }
    }
    clearGLHistoryMarkers();
  }

  // ── Switch between Leaflet and Mapbox GL ──
  function activateLeaflet() {
    document.getElementById('map').style.display = '';
    document.getElementById('map-gl').style.display = 'none';
    useGL = false;
    if (glMap) {
      // Sync view from GL to Leaflet
      const center = glMap.getCenter();
      const zoom = glMap.getZoom();
      map.setView([center.lat, center.lng], Math.round(zoom), { animate: false });
    }
    clearGLMarkers();
    map.invalidateSize();
  }

  function activateGL(mapboxStyle) {
    if (!hasMapboxToken()) {
      console.warn('Mapbox token not set. Add your token in map.js MAPBOX_TOKEN.');
      alert('Set your Mapbox token in public/js/map.js to use 3D maps.\nGet a free token at: https://account.mapbox.com/access-tokens/');
      return false;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const leafletCenter = map.getCenter();
    const leafletZoom = map.getZoom();

    document.getElementById('map').style.display = 'none';
    document.getElementById('map-gl').style.display = '';

    if (glMap) {
      glMap.setStyle(mapboxStyle);
    } else {
      glMap = new mapboxgl.Map({
        container: 'map-gl',
        style: mapboxStyle,
        center: [leafletCenter.lng, leafletCenter.lat],
        zoom: leafletZoom,
        pitch: 45,
        bearing: -10,
        antialias: true
      });

      glMap.addControl(new mapboxgl.NavigationControl(), 'top-left');

      glMap.on('style.load', () => {
        // Add 3D terrain
        if (!glMap.getSource('mapbox-dem')) {
          glMap.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
          glMap.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        }

        // Add 3D buildings layer
        const layers = glMap.getStyle().layers;
        const labelLayer = layers.find(l => l.type === 'symbol' && l.layout && l.layout['text-field']);
        if (!glMap.getLayer('3d-buildings')) {
          glMap.addLayer({
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': '#aaa',
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.6
            }
          }, labelLayer ? labelLayer.id : undefined);
        }

        // Sync markers after style loads
        syncMarkersToGL();
      });
    }

    useGL = true;

    // If GL map already loaded, sync markers immediately
    if (glMap.isStyleLoaded()) {
      syncMarkersToGL();
    }

    return true;
  }

  // ── Set style (unified for both renderers) ──
  function setTileStyle(styleId) {
    const style = allStyles.find(s => s.id === styleId);
    if (!style) return;

    if (style.renderer === 'mapbox') {
      const ok = activateGL(style.mapboxStyle);
      if (!ok) return; // token not set
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

  // ── Style control (Leaflet control + floating for GL) ──
  function createStyleControl() {
    // Create a floating control div that works over both maps
    styleControlContainer = document.createElement('div');
    styleControlContainer.className = 'map-style-control-float';

    const btn = document.createElement('button');
    btn.className = 'map-style-btn';
    btn.title = 'Map style';
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

    const dropdown = document.createElement('div');
    dropdown.className = 'map-style-dropdown';
    dropdown.style.display = 'none';

    // Group: Leaflet styles
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

    // Group: Mapbox GL styles
    const glLabel = document.createElement('div');
    glLabel.className = 'map-style-group-label';
    glLabel.textContent = '3D Maps (Mapbox)';
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

    // Close dropdown on outside click
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

    // Hide GL container initially
    document.getElementById('map-gl').style.display = 'none';

    // Load saved style or default to dark
    const savedStyle = (() => { try { return localStorage.getItem('mapStyle'); } catch (e) { return null; } })();
    setTileStyle(savedStyle || 'carto-dark');

    // Add floating style selector
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

    // GL marker (if GL mode active)
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
    for (const [id] of markers) {
      removeMarker(id);
    }
  }

  function fitToAlerts(alerts) {
    if (!alerts || alerts.length === 0) return;
    const validAlerts = alerts.filter(a => a.lat && a.lng);
    if (validAlerts.length === 0) return;

    if (useGL && glMap) {
      if (validAlerts.length === 1) {
        glMap.flyTo({ center: [validAlerts[0].lng, validAlerts[0].lat], zoom: 12 });
      } else {
        const bounds = new mapboxgl.LngLatBounds();
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

  // ── History event preview (click on panel card) ──
  let historyMarkers = [];       // Leaflet circle markers
  let glHistoryMarkers = [];     // Mapbox GL markers
  let activeHistoryEventId = null;
  let activeHistoryEvent = null;  // keep reference for GL sync

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
    if (useGL && glMap) {
      syncHistoryMarkersToGL();
    }

    // Fit view
    if (useGL && glMap) {
      if (validCities.length === 1) {
        glMap.flyTo({ center: [validCities[0].lng, validCities[0].lat], zoom: 12 });
      } else if (validCities.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
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
