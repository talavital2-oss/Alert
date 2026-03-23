// Map module - Leaflet map with alert markers + MapLibre GL 3D mode
// 3D mode uses MapLibre GL JS (free, open source) + OpenFreeMap tiles (free, no API key)
// Enable RTL text (Hebrew/Arabic) in MapLibre GL
maplibregl.setRTLTextPlugin(
  'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
  true // lazy-load
);

const AlertMap = (function () {
  let mapClickCallback = null; // one-time click handler for manual location
  let map = null;           // Leaflet map
  let glMap = null;          // MapLibre GL map
  let useGL = false;         // true when showing MapLibre GL
  let currentTileLayer = null;
  let currentStyleId = null;
  let styleControlContainer = null;
  const markers = new Map(); // alertId -> { marker, glMarker, timeout, data }
  const MARKER_LIFETIME = 10 * 60 * 1000; // 10 minutes

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
    { id: 'gl-carto-dark', name: '3D CARTO Dark', theme: 'dark', styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
    { id: 'gl-3d-liberty', name: '3D Liberty', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/liberty' },
    { id: 'gl-3d-dark', name: '3D Liberty Dark', theme: 'dark', styleUrl: 'https://tiles.openfreemap.org/styles/dark' },
    { id: 'gl-3d-fiord', name: '3D Fiord', theme: 'dark', styleUrl: 'https://tiles.openfreemap.org/styles/fiord' },
    { id: 'gl-3d-bright', name: '3D Bright', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/bright' },
    { id: 'gl-3d-positron', name: '3D Positron', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/positron' },
    { id: 'gl-carto-positron', name: '3D CARTO Light', theme: 'light', styleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
    { id: 'gl-carto-voyager', name: '3D CARTO Voyager', theme: 'light', styleUrl: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' }
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
    // Also sync impact markers to GL
    syncImpactsToGL();
  }

  function syncImpactsToGL() {
    if (!glMap) return;
    for (const [id, entry] of impactMarkers) {
      if (entry.glMarker) { entry.glMarker.remove(); entry.glMarker = null; }
      const latlng = entry.leafletMarker.getLatLng();
      const el = createImpactGLEl();
      entry.glMarker = new maplibregl.Marker({ element: el })
        .setLngLat([latlng.lng, latlng.lat])
        .addTo(glMap);
    }
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

    // Skip if we already added our layer
    if (glMap.getLayer('3d-buildings')) return;

    // Skip if the style already has a fill-extrusion building layer (e.g. Liberty's 'building-3d')
    const existingExtrusion = style.layers.find(l =>
      l.type === 'fill-extrusion' && (l['source-layer'] === 'building' || (l.id && l.id.includes('building')))
    );
    if (existingExtrusion) return;

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

    // Map click handler for manual location setting
    map.on('click', (e) => {
      if (mapClickCallback) {
        mapClickCallback(e.latlng.lat, e.latlng.lng);
        mapClickCallback = null;
        map.getContainer().style.cursor = '';
      }
    });

    return map;
  }

  // ── Alert markers ──
  function addAlert(alert) {
    if (!alert.lat || !alert.lng) return;
    const id = alert.id;

    // Skip if this marker already exists — don't reset the expiry timer
    if (markers.has(id)) return;

    // Remove any pre-alert markers near this real alert (within ~10km)
    clearNearbyPreAlerts(alert.lat, alert.lng);

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

    // Expire based on alert's actual timestamp, not "now"
    const alertAge = Date.now() - time.getTime();
    const remainingMs = Math.max(0, MARKER_LIFETIME - alertAge);
    const timeout = setTimeout(() => removeMarker(id), remainingMs);
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

  function panTo(lat, lng, zoom) {
    if (useGL && glMap) {
      glMap.flyTo({ center: [lng, lat], zoom: zoom || glMap.getZoom() });
    } else {
      if (zoom) {
        map.flyTo([lat, lng], zoom, { animate: true });
      } else {
        map.panTo([lat, lng], { animate: true });
      }
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

  // ── Impact markers (blue dots from Telegram reports) ──
  const impactMarkers = new Map(); // id -> { leafletMarker, glMarker, timeout }
  const IMPACT_DISPLAY_LIFETIME = 20 * 60 * 1000; // 20 minutes

  function createImpactGLEl() {
    const el = document.createElement('div');
    el.className = 'impact-gl-marker';
    el.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #60a5fa;opacity:0.95;box-shadow:0 0 8px rgba(59,130,246,0.7);cursor:pointer;';
    return el;
  }

  function addImpact(impact) {
    if (!impact.lat || !impact.lng) return;
    if (impactMarkers.has(impact.id)) return; // already shown

    const color = '#3b82f6';

    // Leaflet marker
    const marker = L.circleMarker([impact.lat, impact.lng], {
      radius: 6, color, fillColor: color, fillOpacity: 0.9, weight: 2, opacity: 0.95
    }).addTo(map);

    // Permanent label showing location name
    marker.bindTooltip(impact.location, {
      permanent: true,
      direction: 'right',
      offset: [8, 0],
      className: 'impact-label'
    });

    // Popup with full message text + dismiss button
    const timeStr = new Date(impact.timeMs).toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem'
    });
    const popupHtml = `
      <div class="popup-content" style="direction:rtl;text-align:right;max-width:220px;">
        <div style="font-size:14px;font-weight:700;color:#60a5fa;margin-bottom:4px;">📍 ${impact.location}</div>
        <div style="font-size:12px;color:#d1d5db;line-height:1.4;margin-bottom:6px;">${impact.text}</div>
        <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">${timeStr}</div>
        <button onclick="AlertMap.removeImpact('${impact.id}')" style="background:#374151;color:#f9fafb;border:1px solid #4b5563;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:12px;width:100%;">סגור</button>
      </div>
    `;
    marker.bindPopup(popupHtml, { className: 'alert-popup', maxWidth: 260 });

    // GL marker (if 3D mode)
    let glMarker = null;
    if (useGL && glMap) {
      const el = createImpactGLEl();
      const popup = new maplibregl.Popup({ offset: 12, maxWidth: '260px' }).setHTML(`
        <div style="direction:rtl;text-align:right;padding:4px;">
          <div style="font-size:14px;font-weight:700;color:#60a5fa;margin-bottom:4px;">📍 ${impact.location}</div>
          <div style="font-size:12px;color:#d1d5db;line-height:1.4;margin-bottom:6px;">${impact.text}</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">${timeStr}</div>
          <button onclick="AlertMap.removeImpact('${impact.id}')" style="background:#374151;color:#f9fafb;border:1px solid #4b5563;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:12px;width:100%;">סגור</button>
        </div>
      `);
      glMarker = new maplibregl.Marker({ element: el })
        .setLngLat([impact.lng, impact.lat])
        .setPopup(popup)
        .addTo(glMap);
    }

    // Auto-expire after 20 minutes
    const timeout = setTimeout(() => removeImpact(impact.id), IMPACT_DISPLAY_LIFETIME);

    impactMarkers.set(impact.id, { leafletMarker: marker, glMarker, timeout });
  }

  function removeImpact(id) {
    const entry = impactMarkers.get(id);
    if (!entry) return;
    map.removeLayer(entry.leafletMarker);
    if (entry.glMarker) entry.glMarker.remove();
    if (entry.timeout) clearTimeout(entry.timeout);
    impactMarkers.delete(id);
  }

  function clearImpacts() {
    for (const [id] of impactMarkers) removeImpact(id);
  }


  // ── Pre-Alert markers (amber dots — predicted areas, Category 14) ──
  const preAlertMarkers = new Map(); // id -> { leafletMarker, glMarker, timeout, lat, lng }
  const PRE_ALERT_COLOR = '#f59e0b'; // amber

  // Remove pre-alert markers near a given coordinate (real alert replaces prediction)
  function clearNearbyPreAlerts(lat, lng, radiusKm = 10) {
    const toRemove = [];
    for (const [id, entry] of preAlertMarkers) {
      if (!entry.lat || !entry.lng) continue;
      const dist = haversineKm(lat, lng, entry.lat, entry.lng);
      if (dist <= radiusKm) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      removePreAlert(id);
    }
  }

  // Haversine distance in km between two lat/lng points
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const PRE_ALERT_LIFETIME = 10 * 60 * 1000; // 10 minutes

  function addPreAlert(preAlert) {
    if (!preAlert.lat || !preAlert.lng) return;
    const id = preAlert.id;
    if (preAlertMarkers.has(id)) return; // already shown

    const timeStr = new Date(preAlert.timeMs).toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem'
    });
    const cityList = (preAlert.cities || [preAlert.region]).slice(0, 8).join(', ');
    const extra = (preAlert.cityCount || 0) > 8 ? `\n+${preAlert.cityCount - 8} נוספים` : '';
    const popupHtml = `
      <div class="popup-content" style="direction:rtl;text-align:center;max-width:260px;">
        <div style="font-size:14px;font-weight:700;color:${PRE_ALERT_COLOR};margin-bottom:4px;">⚠️ צפי להתרעות — ${preAlert.cityCount || 1} יישובים</div>
        <div style="font-size:12px;color:#d1d5db;line-height:1.6;margin-bottom:6px;">${cityList}${extra}</div>
        <div style="font-size:11px;color:#6b7280;">${timeStr}</div>
      </div>
    `;

    let overlay;
    if (preAlert.polygon && preAlert.polygon.length >= 3) {
      // Draw polygon region (like rocketil.live)
      overlay = L.polygon(preAlert.polygon, {
        color: 'rgba(245, 158, 11, 0.7)',
        fillColor: 'rgba(245, 158, 11, 0.15)',
        fillOpacity: 0.15,
        weight: 2,
        opacity: 0.7,
        interactive: true,
        dashArray: null
      }).addTo(map);
    } else {
      // Fallback to circle for single points
      overlay = L.circle([preAlert.lat, preAlert.lng], {
        radius: 3000,
        color: 'rgba(245, 158, 11, 0.7)',
        fillColor: 'rgba(245, 158, 11, 0.15)',
        fillOpacity: 0.15,
        weight: 2,
        opacity: 0.7,
        interactive: true
      }).addTo(map);
    }
    overlay.bindPopup(popupHtml, { className: 'alert-popup', maxWidth: 280 });

    // GL overlay — polygon or marker
    let glMarker = null;
    if (useGL && glMap) {
      const sourceId = `pre-alert-${id}`;
      if (preAlert.polygon && preAlert.polygon.length >= 3) {
        // GeoJSON polygon for MapLibre
        const coords = preAlert.polygon.map(p => [p[1], p[0]]); // [lng, lat]
        coords.push(coords[0]); // close polygon
        glMap.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [coords] }
          }
        });
        glMap.addLayer({
          id: sourceId + '-fill',
          type: 'fill',
          source: sourceId,
          paint: { 'fill-color': 'rgba(245, 158, 11, 0.15)', 'fill-opacity': 0.6 }
        });
        glMap.addLayer({
          id: sourceId + '-line',
          type: 'line',
          source: sourceId,
          paint: { 'line-color': 'rgba(245, 158, 11, 0.7)', 'line-width': 2 }
        });
        glMarker = { sourceId, isPolygon: true };
      } else {
        const el = document.createElement('div');
        el.style.cssText = 'width:60px;height:60px;border-radius:50%;background:rgba(245,158,11,0.15);border:2px solid rgba(245,158,11,0.7);cursor:pointer;';
        glMarker = new maplibregl.Marker({ element: el })
          .setLngLat([preAlert.lng, preAlert.lat])
          .addTo(glMap);
      }
    }

    // Auto-expire
    const remainingMs = Math.max(0, (preAlert.expiresAt || (preAlert.timeMs + PRE_ALERT_LIFETIME)) - Date.now());
    const timeout = setTimeout(() => removePreAlert(id), remainingMs);

    preAlertMarkers.set(id, { leafletMarker: overlay, glMarker, timeout, lat: preAlert.lat, lng: preAlert.lng });
  }

  function removePreAlert(id) {
    const entry = preAlertMarkers.get(id);
    if (!entry) return;
    map.removeLayer(entry.leafletMarker);
    if (entry.glMarker) {
      if (entry.glMarker.isPolygon && glMap) {
        // Remove GL polygon layers and source
        const sid = entry.glMarker.sourceId;
        try {
          if (glMap.getLayer(sid + '-fill')) glMap.removeLayer(sid + '-fill');
          if (glMap.getLayer(sid + '-line')) glMap.removeLayer(sid + '-line');
          if (glMap.getSource(sid)) glMap.removeSource(sid);
        } catch (e) { /* ignore if already removed */ }
      } else if (entry.glMarker.remove) {
        entry.glMarker.remove();
      }
    }
    clearTimeout(entry.timeout);
    preAlertMarkers.delete(id);
  }

  function clearPreAlerts() {
    for (const [id] of preAlertMarkers) removePreAlert(id);
  }

  function getPreAlertCount() {
    return preAlertMarkers.size;
  }

  // ── City Highlight (always visible, even when zoomed out) ──
  let highlightMarker = null;
  let highlightLabel = null;
  let highlightGlMarker = null;
  let highlightGlLabel = null;

  function highlightCity(name, lat, lng) {
    clearHighlight();

    // Leaflet marker — large green dot
    const icon = L.divIcon({
      className: 'city-highlight-marker',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    highlightMarker = L.marker([lat, lng], { icon, zIndexOffset: 2000 }).addTo(map);

    // Leaflet label — always visible city name
    const labelIcon = L.divIcon({
      className: 'city-highlight-label',
      html: name,
      iconAnchor: [-14, 12]
    });
    highlightLabel = L.marker([lat, lng], { icon: labelIcon, zIndexOffset: 2000 }).addTo(map);

    // GL marker + label
    if (useGL && glMap) {
      const dotEl = document.createElement('div');
      dotEl.className = 'city-highlight-marker';
      highlightGlMarker = new maplibregl.Marker({ element: dotEl })
        .setLngLat([lng, lat])
        .addTo(glMap);

      const labelEl = document.createElement('div');
      labelEl.className = 'city-highlight-label';
      labelEl.textContent = name;
      highlightGlLabel = new maplibregl.Marker({ element: labelEl, anchor: 'left', offset: [14, 0] })
        .setLngLat([lng, lat])
        .addTo(glMap);
    }

    // Fly to city
    panTo(lat, lng, 13);
  }

  function clearHighlight() {
    if (highlightMarker) { map.removeLayer(highlightMarker); highlightMarker = null; }
    if (highlightLabel) { map.removeLayer(highlightLabel); highlightLabel = null; }
    if (highlightGlMarker) { highlightGlMarker.remove(); highlightGlMarker = null; }
    if (highlightGlLabel) { highlightGlLabel.remove(); highlightGlLabel = null; }
  }

  // ── Search Pin (map search result) ──
  let searchPinMarker = null;
  let searchPinLabel = null;
  let searchPinGl = null;
  let searchPinGlLabel = null;

  function showSearchPin(name, lat, lng, zoom) {
    clearSearchPin();

    const icon = L.divIcon({
      className: 'search-pin-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 24]
    });
    searchPinMarker = L.marker([lat, lng], { icon, zIndexOffset: 1500 }).addTo(map);

    const labelIcon = L.divIcon({
      className: 'search-pin-label',
      html: name,
      iconAnchor: [-16, 12]
    });
    searchPinLabel = L.marker([lat, lng], { icon: labelIcon, zIndexOffset: 1500 }).addTo(map);

    if (useGL && glMap) {
      const el = document.createElement('div');
      el.className = 'search-pin-marker';
      searchPinGl = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat]).addTo(glMap);

      const lbl = document.createElement('div');
      lbl.className = 'search-pin-label';
      lbl.textContent = name;
      searchPinGlLabel = new maplibregl.Marker({ element: lbl, anchor: 'left', offset: [16, 0] })
        .setLngLat([lng, lat]).addTo(glMap);
    }

    panTo(lat, lng, zoom || 16);
  }

  function clearSearchPin() {
    if (searchPinMarker) { map.removeLayer(searchPinMarker); searchPinMarker = null; }
    if (searchPinLabel) { map.removeLayer(searchPinLabel); searchPinLabel = null; }
    if (searchPinGl) { searchPinGl.remove(); searchPinGl = null; }
    if (searchPinGlLabel) { searchPinGlLabel.remove(); searchPinGlLabel = null; }
  }

  // ── My Location ──
  let myLocationMarker = null;
  let myLocationPulse = null;
  let myLocationGl = null;
  let myLocationPulseGl = null;

  function showMyLocation(lat, lng) {
    clearMyLocation();
    const pulseIcon = L.divIcon({ className: 'my-location-pulse', iconSize: [40, 40], iconAnchor: [20, 20] });
    myLocationPulse = L.marker([lat, lng], { icon: pulseIcon, zIndexOffset: 900, interactive: false }).addTo(map);
    const dotIcon = L.divIcon({ className: 'my-location-marker', iconSize: [16, 16], iconAnchor: [8, 8] });
    myLocationMarker = L.marker([lat, lng], { icon: dotIcon, zIndexOffset: 1000 }).addTo(map);

    if (useGL && glMap) {
      const pEl = document.createElement('div'); pEl.className = 'my-location-pulse';
      myLocationPulseGl = new maplibregl.Marker({ element: pEl }).setLngLat([lng, lat]).addTo(glMap);
      const dEl = document.createElement('div'); dEl.className = 'my-location-marker';
      myLocationGl = new maplibregl.Marker({ element: dEl }).setLngLat([lng, lat]).addTo(glMap);
    }
    panTo(lat, lng, 15);
  }

  function clearMyLocation() {
    if (myLocationMarker) { map.removeLayer(myLocationMarker); myLocationMarker = null; }
    if (myLocationPulse) { map.removeLayer(myLocationPulse); myLocationPulse = null; }
    if (myLocationGl) { myLocationGl.remove(); myLocationGl = null; }
    if (myLocationPulseGl) { myLocationPulseGl.remove(); myLocationPulseGl = null; }
  }

  // ── Shelter Markers ──
  let shelterMarkers = [];
  let shelterGlMarkers = [];

  let shelterUserLat = null, shelterUserLng = null;

  function showShelters(shelterList, userLat, userLng) {
    clearShelters();
    shelterUserLat = userLat || null;
    shelterUserLng = userLng || null;

    for (let i = 0; i < shelterList.length; i++) {
      const s = shelterList[i];
      const isClosest = i === 0;
      const cls = isClosest ? 'shelter-marker closest' : 'shelter-marker';
      const icon = L.divIcon({ className: cls, iconSize: isClosest ? [18, 18] : [14, 14], iconAnchor: isClosest ? [9, 9] : [7, 7] });
      const marker = L.marker([s.lat, s.lng], { icon, zIndexOffset: isClosest ? 800 : 700, interactive: true }).addTo(map);

      const walkMin = Math.ceil(s.dist / 80); // ~80m/min walking
      const typeStr = s.t || 'מקלט ציבורי';
      const distStr = s.dist < 1000 ? `${s.dist} מ׳` : `${(s.dist / 1000).toFixed(1)} ק״מ`;
      const originParam = shelterUserLat ? `&origin=${shelterUserLat},${shelterUserLng}` : '';
      marker.bindPopup(`
        <div style="direction:rtl;text-align:right;min-width:180px;">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${isClosest ? '🟢 המקלט הקרוב ביותר' : '🟠 מקלט'}</div>
          <div style="font-size:13px;font-weight:600;color:#e5e7eb;margin-bottom:2px;">${typeStr}</div>
          ${s.a && s.a !== 'Unknown address' ? `<div style="font-size:12px;color:#9ca3af;margin-bottom:2px;">📍 ${s.a}</div>` : ''}
          ${s.b ? `<div style="font-size:11px;color:#6b7280;margin-bottom:4px;">🏢 ${s.b}</div>` : ''}
          <div style="font-size:13px;font-weight:600;color:#f59e0b;margin-top:6px;">📏 ${distStr} · 🚶 ${walkMin} דק׳ הליכה</div>
          ${s.s ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">שטח: ${s.s} מ״ר</div>` : ''}
          ${s.cap ? `<div style="font-size:11px;color:#6b7280;">קיבולת: ${s.cap} איש</div>` : ''}
          <div style="margin-top:8px;display:flex;gap:6px;">
            <a href="https://www.google.com/maps/dir/?api=1${originParam}&destination=${s.lat},${s.lng}&travelmode=walking" target="_blank" style="flex:1;text-align:center;padding:6px;font-size:12px;color:#fff;background:#3b82f6;border-radius:6px;text-decoration:none;font-weight:600;">🧭 נווט הליכה</a>
            <a href="https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes" target="_blank" style="flex:1;text-align:center;padding:6px;font-size:12px;color:#fff;background:#33ccff;border-radius:6px;text-decoration:none;font-weight:600;">🚗 Waze</a>
          </div>
        </div>
      `, { className: 'alert-popup', maxWidth: 280 });

      if (isClosest) marker.openPopup();
      shelterMarkers.push(marker);

      if (useGL && glMap) {
        const el = document.createElement('div');
        el.className = cls;
        const glM = new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(glMap);
        shelterGlMarkers.push(glM);
      }
    }
  }

  function clearShelters() {
    for (const m of shelterMarkers) map.removeLayer(m);
    for (const m of shelterGlMarkers) m.remove();
    shelterMarkers = [];
    shelterGlMarkers = [];
  }

  function onMapClick(cb) {
    mapClickCallback = cb;
    if (map) map.getContainer().style.cursor = 'crosshair';
  }

  return { init, addAlert, removeMarker, clearAll, fitToAlerts, panTo, getActiveCount, showHistoryEvent, clearHistoryMarkers, alertLabels, alertLabelsEn, addImpact, removeImpact, clearImpacts, addPreAlert, removePreAlert, clearPreAlerts, getPreAlertCount, highlightCity, clearHighlight, showSearchPin, clearSearchPin, showMyLocation, clearMyLocation, showShelters, clearShelters, onMapClick };
})();
