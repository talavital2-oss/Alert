// Map module - Leaflet + MapLibre GL 3D with animated alert markers
maplibregl.setRTLTextPlugin(
  'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
  true
);

const AlertMap = (function () {
  let map = null;
  let glMap = null;
  let useGL = false;
  let currentTileLayer = null;
  let currentStyleId = null;
  let styleControlContainer = null;
  const markers = new Map();
  const MARKER_LIFETIME = 5 * 60 * 1000;

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

  const typeIcons = {
    missiles: '🚀', hostile_aircraft: '✈️', earthquake: '🌍',
    infiltration: '⚠️', general: '⚡', radiological: '☢️',
    chemical: '☣️', tsunami: '🌊'
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

  const tileStyles = [
    { id: 'carto-dark', name: 'Dark', theme: 'dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>', subdomains: 'abcd', maxZoom: 20 },
    { id: 'carto-light', name: 'Light', theme: 'light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>', subdomains: 'abcd', maxZoom: 20 },
    { id: 'osm', name: 'OpenStreetMap', theme: 'light', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 },
    { id: 'google-satellite', name: 'Google Satellite', theme: 'dark', url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', attribution: '&copy; Google', maxZoom: 20 },
    { id: 'google-hybrid', name: 'Google Hybrid', theme: 'dark', url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', attribution: '&copy; Google', maxZoom: 20 },
    { id: 'esri-satellite', name: 'Esri Satellite', theme: 'dark', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri', maxZoom: 18 }
  ];

  const glStyles = [
    { id: 'gl-liberty', name: '3D Liberty', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/liberty' },
    { id: 'gl-bright', name: '3D Bright', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/bright' },
    { id: 'gl-positron', name: '3D Positron', theme: 'light', styleUrl: 'https://tiles.openfreemap.org/styles/positron' }
  ];

  const allStyles = [
    ...tileStyles.map(s => ({ ...s, renderer: 'leaflet' })),
    ...glStyles.map(s => ({ ...s, renderer: 'maplibre' }))
  ];

  // Animated marker DOM element
  function createMarkerEl(color, isNew) {
    const c = document.createElement('div');
    c.className = 'alert-marker';
    c.innerHTML = `
      <div class="alert-marker-dot" style="background:${color};border-color:${color};box-shadow:0 0 8px ${color};"></div>
      <div class="alert-marker-pulse" style="background:${color};"></div>
      ${isNew ? `<div class="alert-marker-ripple" style="border-color:${color};"></div><div class="alert-marker-ripple" style="border-color:${color};animation-delay:0.4s;"></div>` : ''}
    `;
    return c;
  }

  function buildPopupHtml(city, type, countdown, timeStr) {
    const color = alertColors[type] || '#eab308';
    return `<div class="popup-content" style="font-family:'Assistant',sans-serif;text-align:center;direction:rtl;padding:4px;">
      <div style="font-size:16px;font-weight:700;margin-bottom:2px;">${city}</div>
      <div style="font-size:12px;padding:2px 10px;border-radius:6px;display:inline-block;margin:6px 0;font-weight:600;background:rgba(239,68,68,0.2);color:${color}">${alertLabels[type] || type}</div>
      <div style="font-size:28px;font-weight:800;color:#ef4444;line-height:1.2;">${countdown}</div>
      <div style="font-size:11px;color:#9ca3af;">זמן למיגון</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">${timeStr}</div>
    </div>`;
  }

  function addGLMarker(id, lat, lng, color, popupHtml) {
    if (!glMap) return null;
    const el = createMarkerEl(color, false);
    el.style.width = '40px'; el.style.height = '40px';
    const popup = new maplibregl.Popup({ offset: 12, maxWidth: '250px' }).setHTML(popupHtml);
    return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).setPopup(popup).addTo(glMap);
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
      entry.glMarker = addGLMarker(id, a.lat, a.lng, color, buildPopupHtml(a.city, a.type, countdownText, timeStr));
    }
    syncHistoryMarkersToGL();
  }

  function clearGLMarkers() {
    for (const [, e] of markers) { if (e.glMarker) { e.glMarker.remove(); e.glMarker = null; } }
    clearGLHistoryMarkers();
  }

  function add3DBuildings() {
    if (!glMap) return;
    const style = glMap.getStyle();
    if (!style || !style.layers || glMap.getLayer('3d-buildings')) return;
    let vectorSourceId = null;
    for (const [srcId, src] of Object.entries(style.sources)) {
      if (src.type === 'vector') { vectorSourceId = srcId; break; }
    }
    if (!vectorSourceId) return;
    const labelLayer = style.layers.find(l => l.type === 'symbol' && l.layout && l.layout['text-field']);
    glMap.addLayer({
      id: '3d-buildings', source: vectorSourceId, 'source-layer': 'building',
      filter: ['all', ['!=', 'hide_3d', true]], type: 'fill-extrusion', minzoom: 13,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'render_height'], 0, '#e8e8e8', 50, '#d4d4d4', 100, '#bbb'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, ['get', 'render_height']],
        'fill-extrusion-base': ['case', ['has', 'render_min_height'], ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.7
      }
    }, labelLayer ? labelLayer.id : undefined);
  }

  function activateLeaflet() {
    document.getElementById('map').style.display = '';
    document.getElementById('map-gl').style.display = 'none';
    useGL = false;
    if (glMap) {
      const c = glMap.getCenter();
      map.setView([c.lat, c.lng], Math.round(glMap.getZoom()), { animate: false });
    }
    clearGLMarkers();
    map.invalidateSize();
  }

  function activateGL(styleUrl) {
    const c = map.getCenter(), z = map.getZoom();
    document.getElementById('map').style.display = 'none';
    document.getElementById('map-gl').style.display = '';
    if (glMap) {
      glMap.setStyle(styleUrl);
    } else {
      glMap = new maplibregl.Map({
        container: 'map-gl', style: styleUrl, center: [c.lng, c.lat], zoom: z,
        pitch: 50, bearing: -10, antialias: true, maxPitch: 70
      });
      glMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    }
    glMap.once('style.load', () => { add3DBuildings(); syncMarkersToGL(); });
    useGL = true;
    if (glMap.isStyleLoaded()) { add3DBuildings(); syncMarkersToGL(); }
  }

  function setTileStyle(styleId) {
    const style = allStyles.find(s => s.id === styleId);
    if (!style) return;
    if (style.renderer === 'maplibre') { activateGL(style.styleUrl); }
    else {
      activateLeaflet();
      if (currentTileLayer) map.removeLayer(currentTileLayer);
      const opts = { attribution: style.attribution, maxZoom: style.maxZoom || 19 };
      if (style.subdomains) opts.subdomains = style.subdomains;
      currentTileLayer = L.tileLayer(style.url, opts).addTo(map);
    }
    currentStyleId = style.id;
    document.documentElement.setAttribute('data-theme', style.theme);
    try { localStorage.setItem('mapStyle', style.id); } catch (e) {}
  }

  function createStyleControl() {
    styleControlContainer = document.createElement('div');
    styleControlContainer.className = 'map-style-control-float';
    const btn = document.createElement('button');
    btn.className = 'map-style-btn';
    btn.title = 'Map style';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
    const dd = document.createElement('div');
    dd.className = 'map-style-dropdown';
    dd.style.display = 'none';

    function addGroup(label, styles) {
      const g = document.createElement('div');
      g.className = 'map-style-group-label';
      g.textContent = label;
      dd.appendChild(g);
      for (const s of styles) {
        const item = document.createElement('button');
        item.className = 'map-style-item' + (s.id === currentStyleId ? ' active' : '');
        item.textContent = s.name;
        item.addEventListener('click', () => {
          setTileStyle(s.id);
          dd.querySelectorAll('.map-style-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          dd.style.display = 'none';
        });
        dd.appendChild(item);
      }
    }
    addGroup('2D Maps', tileStyles);
    addGroup('3D Maps', glStyles);

    btn.addEventListener('click', (e) => { e.stopPropagation(); dd.style.display = dd.style.display === 'none' ? 'flex' : 'none'; });
    document.addEventListener('click', (e) => { if (!styleControlContainer.contains(e.target)) dd.style.display = 'none'; });
    styleControlContainer.appendChild(btn);
    styleControlContainer.appendChild(dd);
    document.body.appendChild(styleControlContainer);
  }

  function init() {
    map = L.map('map', { center: [31.5, 34.85], zoom: 8, zoomControl: true, attributionControl: true });
    document.getElementById('map-gl').style.display = 'none';
    const saved = (() => { try { return localStorage.getItem('mapStyle'); } catch (e) { return null; } })();
    setTileStyle(saved || 'carto-dark');
    createStyleControl();
    return map;
  }

  function addAlert(alert) {
    if (!alert.lat || !alert.lng) return;
    const id = alert.id;
    if (markers.has(id)) removeMarker(id);
    const color = alertColors[alert.type] || alertColors.general;

    // Animated Leaflet marker
    const el = createMarkerEl(color, true);
    const icon = L.divIcon({ html: el.outerHTML, className: '', iconSize: [50, 50], iconAnchor: [25, 25] });
    const marker = L.marker([alert.lat, alert.lng], { icon }).addTo(map);

    // City name label
    marker.bindTooltip(alert.city, { permanent: true, direction: 'right', offset: [20, 0], className: 'alert-label' });

    const time = new Date(alert.timestamp);
    const timeStr = time.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' });
    const countdownText = alert.countdown === 0 ? 'מיידי' : `${alert.countdown} שניות`;
    const areaHtml = alert.area ? `<div class="popup-area">${alert.area}</div>` : '';
    marker.bindPopup(`<div class="popup-content">
      <div class="popup-city">${alert.city}</div>${areaHtml}
      <div class="popup-type popup-type-${alert.type}">${alertLabels[alert.type] || alert.type}</div>
      <div class="popup-countdown">${countdownText}</div>
      <div class="popup-countdown-label">זמן למיגון</div>
      <div class="popup-time">${timeStr}</div>
    </div>`, { className: 'alert-popup', maxWidth: 250 });

    let glMarker = null;
    if (useGL && glMap) {
      glMarker = addGLMarker(id, alert.lat, alert.lng, color, buildPopupHtml(alert.city, alert.type, countdownText, timeStr));
    }
    const timeout = setTimeout(() => removeMarker(id), MARKER_LIFETIME);
    markers.set(id, { marker, glMarker, timeout, data: alert });
  }

  function removeMarker(id) {
    const e = markers.get(id);
    if (!e) return;
    map.removeLayer(e.marker);
    if (e.glMarker) e.glMarker.remove();
    clearTimeout(e.timeout);
    markers.delete(id);
  }

  function clearAll() { for (const [id] of markers) removeMarker(id); }

  function fitToAlerts(alerts) {
    if (!alerts || alerts.length === 0) return;
    const v = alerts.filter(a => a.lat && a.lng);
    if (v.length === 0) return;
    if (useGL && glMap) {
      if (v.length === 1) glMap.flyTo({ center: [v[0].lng, v[0].lat], zoom: 12 });
      else { const b = new maplibregl.LngLatBounds(); v.forEach(a => b.extend([a.lng, a.lat])); glMap.fitBounds(b, { padding: 60, maxZoom: 12 }); }
    } else {
      if (v.length === 1) map.setView([v[0].lat, v[0].lng], 12, { animate: true });
      else map.fitBounds(L.latLngBounds(v.map(a => [a.lat, a.lng])).pad(0.3), { animate: true, maxZoom: 12 });
    }
  }

  function getActiveCount() { return markers.size; }
  function panTo(lat, lng) { if (useGL && glMap) glMap.flyTo({ center: [lng, lat] }); else map.panTo([lat, lng], { animate: true }); }
  function flyTo(lat, lng, zoom) { zoom = zoom || 12; if (useGL && glMap) glMap.flyTo({ center: [lng, lat], zoom }); else map.flyTo([lat, lng], zoom); }

  // History event preview
  let historyMarkers = [], glHistoryMarkers = [], activeHistoryEventId = null, activeHistoryEvent = null;

  function clearHistoryMarkers() {
    for (const m of historyMarkers) map.removeLayer(m);
    historyMarkers = [];
    clearGLHistoryMarkers();
    activeHistoryEventId = null;
    activeHistoryEvent = null;
  }

  function clearGLHistoryMarkers() { for (const m of glHistoryMarkers) m.remove(); glHistoryMarkers = []; }

  function syncHistoryMarkersToGL() {
    clearGLHistoryMarkers();
    if (!activeHistoryEvent || !glMap) return;
    const ev = activeHistoryEvent, color = alertColors[ev.type] || alertColors.general;
    for (const c of ev.cities.filter(c => c.lat && c.lng)) {
      const ts = new Date(c.timeMs).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' });
      const ct = c.countdown === 0 ? 'מיידי' : `${c.countdown} שניות`;
      const m = addGLMarker('h-' + c.city, c.lat, c.lng, color, buildPopupHtml(c.city, ev.type, ct, ts));
      if (m) glHistoryMarkers.push(m);
    }
  }

  function showHistoryEvent(event) {
    if (activeHistoryEventId === event.eventId) { clearHistoryMarkers(); return null; }
    clearHistoryMarkers();
    activeHistoryEventId = event.eventId;
    activeHistoryEvent = event;
    const color = alertColors[event.type] || alertColors.general;
    const valid = event.cities.filter(c => c.lat && c.lng);

    for (const c of valid) {
      const ts = new Date(c.timeMs).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' });
      const ct = c.countdown === 0 ? 'מיידי' : `${c.countdown} שניות`;
      const el = createMarkerEl(color, false);
      const icon = L.divIcon({ html: el.outerHTML, className: '', iconSize: [50, 50], iconAnchor: [25, 25] });
      const m = L.marker([c.lat, c.lng], { icon }).addTo(map);
      m.bindPopup(`<div class="popup-content"><div class="popup-city">${c.city}</div>
        <div class="popup-type popup-type-${event.type}">${alertLabels[event.type] || event.type}</div>
        <div class="popup-countdown">${ct}</div><div class="popup-countdown-label">זמן למיגון</div>
        <div class="popup-time">${ts}</div></div>`, { className: 'alert-popup', maxWidth: 250 });
      historyMarkers.push(m);
    }
    if (useGL && glMap) syncHistoryMarkersToGL();

    if (valid.length === 1) {
      if (useGL && glMap) glMap.flyTo({ center: [valid[0].lng, valid[0].lat], zoom: 12 });
      else map.setView([valid[0].lat, valid[0].lng], 12, { animate: true });
    } else if (valid.length > 1) {
      if (useGL && glMap) { const b = new maplibregl.LngLatBounds(); valid.forEach(c => b.extend([c.lng, c.lat])); glMap.fitBounds(b, { padding: 60, maxZoom: 12 }); }
      else map.fitBounds(L.latLngBounds(valid.map(c => [c.lat, c.lng])).pad(0.3), { animate: true, maxZoom: 12 });
    }
    return event.eventId;
  }

  return { init, addAlert, removeMarker, clearAll, fitToAlerts, panTo, flyTo, getActiveCount, showHistoryEvent, clearHistoryMarkers, alertLabels, alertLabelsEn, alertColors, typeIcons };
})();
