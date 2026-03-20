const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Load city data
const cities = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cities.json'), 'utf8'));

// Alert state
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

// SSE endpoint
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
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => clearInterval(keepAlive));
});

// Alert history REST endpoint
app.get('/api/alerts/history', (req, res) => {
  res.json(alertHistory);
});

// Stateless proxy endpoint - fetches from oref API per request
// Works on serverless platforms (Vercel) where SSE/polling aren't persistent
app.get('/api/alerts/current', (req, res) => {
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
    timeout: 4000
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (chunk) => { data += chunk; });
    proxyRes.on('end', () => {
      try {
        data = data.replace(/^\uFEFF/, '').trim();
        if (!data || data === '[]' || data === '') {
          return res.json({ alerts: [], timestamp: new Date().toISOString() });
        }

        const alerts = JSON.parse(data);
        if (!Array.isArray(alerts) || alerts.length === 0) {
          return res.json({ alerts: [], timestamp: new Date().toISOString() });
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
              type: alertType,
              title: alert.title || '',
              desc: alert.desc || '',
              timestamp
            });
          }
        }

        res.json({ alerts: processedAlerts, timestamp });
      } catch (e) {
        res.json({ alerts: [], timestamp: new Date().toISOString(), error: 'parse_error' });
      }
    });
  });

  proxyReq.on('error', () => {
    res.json({ alerts: [], timestamp: new Date().toISOString(), error: 'fetch_error' });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.json({ alerts: [], timestamp: new Date().toISOString(), error: 'timeout' });
  });

  proxyReq.end();
});

// Proxy to oref history endpoint
app.get('/api/alerts/history-proxy', (req, res) => {
  const options = {
    hostname: 'www.oref.org.il',
    path: '/WarningMessages/alert/History/AlertsHistory.json',
    method: 'GET',
    headers: {
      'Referer': 'https://www.oref.org.il/',
      'X-Requested-With': 'XMLHttpRequest',
      'Client': 'true',
      'Accept': 'application/json',
      'Accept-Language': 'he-IL,he;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 5000
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (chunk) => { data += chunk; });
    proxyRes.on('end', () => {
      try {
        data = data.replace(/^\uFEFF/, '').trim();
        if (!data) return res.json([]);

        const rawHistory = JSON.parse(data);
        if (!Array.isArray(rawHistory)) return res.json([]);

        // Process history entries
        const processed = [];
        for (const entry of rawHistory.slice(0, 50)) {
          const alertCities = typeof entry.data === 'string' ? entry.data.split(',').map(s => s.trim()) : (entry.data || []);
          const alertType = categorizeAlert(entry.cat || entry.category || '');
          const timestamp = entry.alertDate || entry.date || new Date().toISOString();

          for (const cityName of alertCities) {
            const cityData = cities[cityName];
            processed.push({
              id: `hist-${entry.rid || Date.now()}-${cityName}`,
              city: cityName,
              cityEn: cityData ? cityData.en : cityName,
              lat: cityData ? cityData.lat : null,
              lng: cityData ? cityData.lng : null,
              countdown: cityData ? cityData.countdown : 90,
              type: alertType,
              title: entry.title || '',
              desc: entry.desc || '',
              timestamp
            });
          }
        }

        res.json(processed);
      } catch (e) {
        res.json([]);
      }
    });
  });

  proxyReq.on('error', () => res.json([]));
  proxyReq.on('timeout', () => { proxyReq.destroy(); res.json([]); });
  proxyReq.end();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', clients: sseClients.size, uptime: process.uptime() });
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

// Fetch alerts from Pikud HaOref
function fetchAlerts() {
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
        // Clean BOM if present
        data = data.replace(/^\uFEFF/, '').trim();

        if (!data || data === '[]' || data === '') {
          // No active alerts
          if (currentAlerts.length > 0) {
            currentAlerts = [];
            broadcast({ type: 'clear' });
          }
          return;
        }

        // Only process if data changed
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

        // Process new alerts
        const timestamp = new Date().toISOString();
        const processedAlerts = [];

        for (const alert of alerts) {
          const alertCities = alert.data || alert.cities || [];
          const alertType = categorizeAlert(alert.cat || alert.type || '');

          for (const cityName of alertCities) {
            const cityData = cities[cityName];
            const processed = {
              id: `${alert.id || Date.now()}-${cityName}`,
              city: cityName,
              cityEn: cityData ? cityData.en : cityName,
              lat: cityData ? cityData.lat : null,
              lng: cityData ? cityData.lng : null,
              countdown: cityData ? cityData.countdown : 90,
              type: alertType,
              title: alert.title || '',
              desc: alert.desc || '',
              timestamp
            };
            processedAlerts.push(processed);
          }
        }

        if (processedAlerts.length > 0) {
          currentAlerts = processedAlerts;
          // Add to history (newest first)
          alertHistory = [...processedAlerts, ...alertHistory].slice(0, MAX_HISTORY);

          broadcast({ type: 'alert', alerts: processedAlerts });
          console.log(`[${timestamp}] Alert: ${processedAlerts.length} cities - ${processedAlerts.map(a => a.city).join(', ')}`);
        }
      } catch (e) {
        // Silently handle parse errors (common with empty/malformed responses)
        if (data && data.length > 2) {
          console.error('Parse error:', e.message, 'Data:', data.substring(0, 100));
        }
      }
    });
  });

  req.on('error', (e) => {
    // Silently handle connection errors - they're expected when geo-blocked
  });

  req.on('timeout', () => {
    req.destroy();
  });

  req.end();
}

// Categorize alert type from category number
function categorizeAlert(cat) {
  const catNum = parseInt(cat);
  switch (catNum) {
    case 1: return 'missiles';        // צבע אדום - Rockets/Missiles
    case 2: return 'general';         // אירוע כללי
    case 3: return 'earthquake';      // רעידת אדמה
    case 4: return 'radiological';    // חומ"ס רדיולוגי
    case 5: return 'tsunami';         // צונאמי
    case 6: return 'hostile_aircraft'; // חדירת כלי טיס עוין
    case 7: return 'chemical';        // חומ"ס כימי
    case 13: return 'infiltration';   // חדירת מחבלים
    default:
      if (typeof cat === 'string') {
        if (cat.includes('missile') || cat.includes('rocket') || cat.includes('אדום')) return 'missiles';
        if (cat.includes('aircraft') || cat.includes('טיס')) return 'hostile_aircraft';
        if (cat.includes('earth') || cat.includes('רעידת')) return 'earthquake';
        if (cat.includes('infiltr') || cat.includes('חדירת')) return 'infiltration';
      }
      return 'missiles'; // Default to missiles (most common)
  }
}

// Start polling
console.log('Starting Pikud HaOref alert polling (every 1 second)...');
setInterval(fetchAlerts, 1000);
fetchAlerts(); // Initial fetch

// Start server
app.listen(PORT, () => {
  console.log(`Israel Alert Map running at http://localhost:${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/api/alerts/sse`);
});
