const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Load comprehensive city data (1449 cities from tzevaadom)
const cities = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cities.json'), 'utf8'));
console.log(`Loaded ${Object.keys(cities).length} cities`);

// Alert state (for persistent server mode / SSE)
let currentAlerts = [];
let alertHistory = [];
const MAX_HISTORY = 200;
const sseClients = new Set();
let lastAlertJson = '';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve city data to frontend
app.get('/api/cities', (req, res) => {
  res.json(cities);
});

// SSE endpoint (works on persistent servers, not on serverless)
app.get('/api/alerts/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send current state on connect
  res.write(`data: ${JSON.stringify({ type: 'init', alerts: currentAlerts, history: alertHistory.slice(0, 50) })}\n\n`);

  sseClients.add(res);
  console.log(`SSE client connected (total: ${sseClients.size})`);

  req.on('close', () => {
    sseClients.delete(res);
    console.log(`SSE client disconnected (total: ${sseClients.size})`);
  });

  // Keep-alive ping every 15s
  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (e) { clearInterval(keepAlive); }
  }, 15000);

  req.on('close', () => clearInterval(keepAlive));
});

// Alert history REST endpoint (in-memory, for persistent server)
app.get('/api/alerts/history', (req, res) => {
  res.json(alertHistory);
});

// ============================================================
// Stateless proxy endpoints (work on serverless / Vercel)
// Uses tzevaadom.co.il API which is NOT geo-blocked
// ============================================================

// Helper: fetch JSON from a URL
function fetchJson(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Parse error'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Map tzevaadom threat codes to our alert types
function threatToType(threat) {
  switch (threat) {
    case 0: return 'missiles';         // Rockets/Missiles
    case 1: return 'general';          // General
    case 2: return 'earthquake';       // Earthquake
    case 3: return 'tsunami';          // Tsunami
    case 4: return 'radiological';     // Radiological
    case 5: return 'hostile_aircraft'; // Hostile aircraft/drones
    case 6: return 'infiltration';     // Terrorist infiltration
    default: return 'missiles';
  }
}

// Threat type to Hebrew title
function threatToTitle(threat) {
  switch (threat) {
    case 0: return 'ירי רקטות וטילים';
    case 1: return 'אירוע כללי';
    case 2: return 'רעידת אדמה';
    case 3: return 'צונאמי';
    case 4: return 'חומרים מסוכנים';
    case 5: return 'חדירת כלי טיס עוין';
    case 6: return 'חדירת מחבלים';
    default: return 'צבע אדום';
  }
}

// Process tzevaadom alert entries into our format
function processTzevaadomAlerts(entries) {
  const processed = [];
  for (const entry of entries) {
    const alerts = entry.alerts || [];
    for (const alert of alerts) {
      const alertCities = alert.cities || [];
      const alertType = threatToType(alert.threat);
      const title = threatToTitle(alert.threat);
      // Use exact epoch timestamp from tzevaadom (seconds -> ms)
      const timestamp = alert.time ? new Date(alert.time * 1000).toISOString() : new Date().toISOString();

      for (const cityName of alertCities) {
        const cityData = cities[cityName];
        processed.push({
          id: `${entry.id}-${cityName}`,
          city: cityName,
          cityEn: cityData ? cityData.en : cityName,
          lat: cityData ? cityData.lat : null,
          lng: cityData ? cityData.lng : null,
          countdown: cityData ? cityData.countdown : 90,
          area: cityData ? (cityData.areaHe || '') : '',
          areaEn: cityData ? (cityData.areaEn || '') : '',
          type: alertType,
          title: title,
          desc: '',
          isDrill: alert.isDrill || false,
          timestamp
        });
      }
    }
  }
  return processed;
}

// Current active alerts via tzevaadom (NOT geo-blocked)
app.get('/api/alerts/current', async (req, res) => {
  try {
    // tzevaadom alerts-history returns recent alerts (last few minutes)
    const data = await fetchJson('https://api.tzevaadom.co.il/alerts-history');

    if (!Array.isArray(data) || data.length === 0) {
      return res.json({ alerts: [], timestamp: new Date().toISOString() });
    }

    // Only include alerts from the last 5 minutes as "current"
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recent = data.filter(entry => {
      const alerts = entry.alerts || [];
      return alerts.some(a => a.time && (a.time * 1000) > fiveMinAgo);
    });

    const processed = processTzevaadomAlerts(recent);
    res.json({ alerts: processed, timestamp: new Date().toISOString() });
  } catch (e) {
    // Fallback: try oref directly (works if server is in Israel)
    try {
      const orefData = await fetchOrefAlerts();
      res.json({ alerts: orefData, timestamp: new Date().toISOString() });
    } catch (e2) {
      res.json({ alerts: [], timestamp: new Date().toISOString(), error: 'both_sources_failed' });
    }
  }
});

// Alert history via tzevaadom (NOT geo-blocked)
app.get('/api/alerts/history-proxy', async (req, res) => {
  try {
    const data = await fetchJson('https://api.tzevaadom.co.il/alerts-history');

    if (!Array.isArray(data) || data.length === 0) {
      return res.json([]);
    }

    const processed = processTzevaadomAlerts(data);
    res.json(processed);
  } catch (e) {
    res.json([]);
  }
});

// Fallback: fetch from oref directly (only works from Israeli IP)
function fetchOrefAlerts() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.oref.org.il',
      path: '/WarningMessages/alert/alerts.json',
      method: 'GET',
      headers: {
        'Referer': 'https://www.oref.org.il/',
        'X-Requested-With': 'XMLHttpRequest',
        'Client': 'true',
        'Accept': 'application/json',
        'Accept-Language': 'he-IL,he;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 3000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          data = data.replace(/^\uFEFF/, '').trim();
          if (!data || data === '[]' || data === '') {
            return resolve([]);
          }
          const alerts = JSON.parse(data);
          if (!Array.isArray(alerts) || alerts.length === 0) return resolve([]);

          const timestamp = new Date().toISOString();
          const processed = [];
          for (const alert of alerts) {
            const alertCities = alert.data || alert.cities || [];
            const alertType = categorizeAlert(alert.cat || alert.type || '');
            for (const cityName of alertCities) {
              const cityData = cities[cityName];
              processed.push({
                id: `${alert.id || Date.now()}-${cityName}`,
                city: cityName,
                cityEn: cityData ? cityData.en : cityName,
                lat: cityData ? cityData.lat : null,
                lng: cityData ? cityData.lng : null,
                countdown: cityData ? cityData.countdown : 90,
                area: cityData ? (cityData.areaHe || '') : '',
                areaEn: cityData ? (cityData.areaEn || '') : '',
                type: alertType,
                title: alert.title || '',
                desc: alert.desc || '',
                timestamp
              });
            }
          }
          resolve(processed);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    clients: sseClients.size,
    uptime: process.uptime(),
    cityCount: Object.keys(cities).length
  });
});

// Broadcast to all SSE clients
function broadcast(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Fetch alerts for SSE broadcast (persistent server mode)
// Tries tzevaadom first, falls back to oref
async function fetchAlerts() {
  try {
    const data = await fetchJson('https://api.tzevaadom.co.il/alerts-history');

    if (!Array.isArray(data) || data.length === 0) {
      if (currentAlerts.length > 0) {
        currentAlerts = [];
        broadcast({ type: 'clear' });
      }
      return;
    }

    // Only current alerts (last 2 minutes for SSE mode)
    const twoMinAgo = Date.now() - 2 * 60 * 1000;
    const recent = data.filter(entry => {
      const alerts = entry.alerts || [];
      return alerts.some(a => a.time && (a.time * 1000) > twoMinAgo);
    });

    if (recent.length === 0) {
      if (currentAlerts.length > 0) {
        currentAlerts = [];
        broadcast({ type: 'clear' });
      }
      return;
    }

    const processed = processTzevaadomAlerts(recent);
    const alertJson = JSON.stringify(processed.map(a => a.id).sort());

    if (alertJson === lastAlertJson) return;
    lastAlertJson = alertJson;

    if (processed.length > 0) {
      currentAlerts = processed;
      alertHistory = [...processed, ...alertHistory].slice(0, MAX_HISTORY);
      broadcast({ type: 'alert', alerts: processed });
      console.log(`[${new Date().toISOString()}] Alert: ${processed.length} cities - ${processed.map(a => a.city).join(', ')}`);
    }
  } catch (e) {
    // Fallback to oref
    fetchOrefForSSE();
  }
}

// Legacy oref polling for SSE (fallback)
function fetchOrefForSSE() {
  const options = {
    hostname: 'www.oref.org.il',
    path: '/WarningMessages/alert/alerts.json',
    method: 'GET',
    headers: {
      'Referer': 'https://www.oref.org.il/',
      'X-Requested-With': 'XMLHttpRequest',
      'Client': 'true',
      'Accept': 'application/json',
      'Accept-Language': 'he-IL,he;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 3000
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        data = data.replace(/^\uFEFF/, '').trim();
        if (!data || data === '[]' || data === '') {
          if (currentAlerts.length > 0) {
            currentAlerts = [];
            broadcast({ type: 'clear' });
          }
          return;
        }
        if (data === lastAlertJson) return;
        lastAlertJson = data;

        const alerts = JSON.parse(data);
        if (!Array.isArray(alerts) || alerts.length === 0) {
          if (currentAlerts.length > 0) {
            currentAlerts = [];
            broadcast({ type: 'clear' });
          }
          return;
        }

        const timestamp = new Date().toISOString();
        const processedAlerts = [];
        for (const alert of alerts) {
          const alertCities = alert.data || alert.cities || [];
          const alertType = categorizeAlert(alert.cat || alert.type || '');
          for (const cityName of alertCities) {
            const cityData = cities[cityName];
            processedAlerts.push({
              id: `${alert.id || Date.now()}-${cityName}`,
              city: cityName,
              cityEn: cityData ? cityData.en : cityName,
              lat: cityData ? cityData.lat : null,
              lng: cityData ? cityData.lng : null,
              countdown: cityData ? cityData.countdown : 90,
              area: cityData ? (cityData.areaHe || '') : '',
              areaEn: cityData ? (cityData.areaEn || '') : '',
              type: alertType,
              title: alert.title || '',
              desc: alert.desc || '',
              timestamp
            });
          }
        }

        if (processedAlerts.length > 0) {
          currentAlerts = processedAlerts;
          alertHistory = [...processedAlerts, ...alertHistory].slice(0, MAX_HISTORY);
          broadcast({ type: 'alert', alerts: processedAlerts });
          console.log(`[${timestamp}] Alert (oref): ${processedAlerts.length} cities`);
        }
      } catch (e) {
        // Silently handle parse errors
      }
    });
  });

  req.on('error', () => {});
  req.on('timeout', () => { req.destroy(); });
  req.end();
}

// Categorize alert type from oref category number
function categorizeAlert(cat) {
  const catNum = parseInt(cat);
  switch (catNum) {
    case 1: return 'missiles';
    case 2: return 'general';
    case 3: return 'earthquake';
    case 4: return 'radiological';
    case 5: return 'tsunami';
    case 6: return 'hostile_aircraft';
    case 7: return 'chemical';
    case 13: return 'infiltration';
    default:
      if (typeof cat === 'string') {
        if (cat.includes('missile') || cat.includes('rocket') || cat.includes('אדום')) return 'missiles';
        if (cat.includes('aircraft') || cat.includes('טיס')) return 'hostile_aircraft';
        if (cat.includes('earth') || cat.includes('רעידת')) return 'earthquake';
        if (cat.includes('infiltr') || cat.includes('חדירת')) return 'infiltration';
      }
      return 'missiles';
  }
}

// Start server
function start() {
  // Start polling for SSE mode (persistent server)
  console.log('Starting alert polling (every 2 seconds)...');
  setInterval(fetchAlerts, 2000);
  fetchAlerts();

  app.listen(PORT, () => {
    console.log(`Israel Alert Map running at http://localhost:${PORT}`);
  });
}

// For Vercel serverless: export the app
module.exports = app;

// For direct execution: start the server
if (require.main === module) {
  start();
}
