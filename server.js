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

// Process tzevaadom alert entries into per-city alerts (for map markers)
function processTzevaadomAlerts(entries) {
  const processed = [];
  for (const entry of entries) {
    const alerts = entry.alerts || [];
    for (const alert of alerts) {
      const alertCities = alert.cities || [];
      const alertType = threatToType(alert.threat);
      const title = threatToTitle(alert.threat);
      const timeMs = alert.time ? alert.time * 1000 : Date.now();
      const timestamp = new Date(timeMs).toISOString();

      for (const cityName of alertCities) {
        const cityData = cities[cityName];
        processed.push({
          id: `${entry.id}-${cityName}`,
          eventId: entry.id,
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
          timeMs,
          timestamp
        });
      }
    }
  }
  return processed;
}

// Group per-city alerts into events (for history panel)
// Returns array sorted newest-first, each with areas, cities, time range
function groupAlertsIntoEvents(perCityAlerts) {
  // Group by eventId
  const eventMap = new Map();
  for (const alert of perCityAlerts) {
    const eid = alert.eventId;
    if (!eventMap.has(eid)) {
      eventMap.set(eid, {
        eventId: eid,
        type: alert.type,
        title: alert.title,
        cities: [],
        areas: new Set(),
        minTime: alert.timeMs,
        maxTime: alert.timeMs,
        isDrill: alert.isDrill
      });
    }
    const ev = eventMap.get(eid);
    ev.cities.push({
      city: alert.city,
      cityEn: alert.cityEn,
      lat: alert.lat,
      lng: alert.lng,
      countdown: alert.countdown,
      timeMs: alert.timeMs,
      id: alert.id
    });
    if (alert.area) ev.areas.add(alert.area);
    if (alert.timeMs < ev.minTime) ev.minTime = alert.timeMs;
    if (alert.timeMs > ev.maxTime) ev.maxTime = alert.timeMs;
  }

  // Convert to sorted array (newest first by maxTime)
  const events = Array.from(eventMap.values()).map(ev => ({
    eventId: ev.eventId,
    type: ev.type,
    title: ev.title,
    areas: Array.from(ev.areas),
    cities: ev.cities.sort((a, b) => a.timeMs - b.timeMs),
    cityCount: ev.cities.length,
    minTime: ev.minTime,
    maxTime: ev.maxTime,
    minTimestamp: new Date(ev.minTime).toISOString(),
    maxTimestamp: new Date(ev.maxTime).toISOString(),
    isDrill: ev.isDrill
  }));

  events.sort((a, b) => b.maxTime - a.maxTime);
  return events;
}

// Current active alerts via tzevaadom (NOT geo-blocked)
// Fetches both real-time /alerts AND /alerts-history to never miss alerts
app.get('/api/alerts/current', async (req, res) => {
  try {
    // Fetch both real-time and history in parallel
    const [liveResult, historyResult] = await Promise.allSettled([
      fetchJson('https://api.tzevaadom.co.il/alerts', 3000),
      fetchJson('https://api.tzevaadom.co.il/alerts-history', 5000)
    ]);

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const seenEventIds = new Set();
    let allPerCity = [];

    // Process real-time alerts first (most current)
    if (liveResult.status === 'fulfilled' && Array.isArray(liveResult.value) && liveResult.value.length > 0) {
      const livePerCity = processTzevaadomAlerts(liveResult.value);
      for (const a of livePerCity) {
        seenEventIds.add(a.eventId);
      }
      allPerCity = livePerCity;
    }

    // Merge recent history alerts (dedup by eventId)
    if (historyResult.status === 'fulfilled' && Array.isArray(historyResult.value) && historyResult.value.length > 0) {
      const recent = historyResult.value.filter(entry => {
        if (seenEventIds.has(entry.id)) return false;
        const alerts = entry.alerts || [];
        return alerts.some(a => a.time && (a.time * 1000) > fiveMinAgo);
      });
      const histPerCity = processTzevaadomAlerts(recent);
      allPerCity = [...allPerCity, ...histPerCity];
    }

    const events = groupAlertsIntoEvents(allPerCity);
    res.json({ alerts: allPerCity, events, timestamp: new Date().toISOString() });
  } catch (e) {
    try {
      const orefData = await fetchOrefAlerts();
      res.json({ alerts: orefData, events: [], timestamp: new Date().toISOString() });
    } catch (e2) {
      res.json({ alerts: [], events: [], timestamp: new Date().toISOString(), error: 'both_sources_failed' });
    }
  }
});

// Alert history via tzevaadom (NOT geo-blocked)
// Returns grouped events sorted newest-first
app.get('/api/alerts/history-proxy', async (req, res) => {
  try {
    const data = await fetchJson('https://api.tzevaadom.co.il/alerts-history');

    if (!Array.isArray(data) || data.length === 0) {
      return res.json({ events: [], alerts: [] });
    }

    const perCity = processTzevaadomAlerts(data);
    const events = groupAlertsIntoEvents(perCity);
    res.json({ events });
  } catch (e) {
    res.json({ events: [] });
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

// ============================================================
// Impact tracking - Telegram channel monitoring
// Scrapes https://t.me/s/fireisrael7777 for missile impact reports
// ============================================================

let telegramCache = { time: 0, impacts: [] };
const TELEGRAM_CACHE_TTL = 30000; // 30-second cache

// Telegram channels to scrape for impact reports
const TELEGRAM_CHANNELS = [
  '/s/fireisrael7777',
  '/s/aharonyediotoriginal',
  '/s/Yair_Altman_channel14',
];

// Hebrew keywords indicating an actual impact / fall
const IMPACT_KEYWORDS = [
  'נפילה', 'נפילות', 'פגיעה', 'פגיעות',
  'נפל', 'נפלה', 'נפלו',
  'יירוט', 'שברי יירוט',
  'רסיס', 'רסיסים',
  'אמל״ח', 'אמל"ח', 'אמלח',
  'פצוע', 'פצועים', 'פצועה',
  'נחת', 'נחתה', 'נחתו',
  'פגע', 'פגעה'
];

// Messages containing these are NOT impacts
const EXCLUDE_PATTERNS = [
  'תרגיל', 'בדיקה', 'דיווח שגוי', 'אין נפילות', 'דיווח כוזב',
  'שקט', 'הותר לפרסום'
];

// Fetch raw HTML from a URL
function fetchRawHTML(hostname, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://${hostname}${urlPath}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'he-IL,he;q=0.9'
      },
      timeout: 10000
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const u = new URL(res.headers.location);
          fetchRawHTML(u.hostname, u.pathname + u.search).then(resolve).catch(reject);
        } catch (e) { reject(e); }
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Parse the Telegram public preview HTML into message objects
function parseTelegramHTML(html) {
  const messages = [];
  // Split by message wrapper boundaries
  const blocks = html.split(/tgme_widget_message_wrap/);

  for (const block of blocks) {
    const postMatch = block.match(/data-post="[^/]*\/(\d+)"/);
    if (!postMatch) continue;

    const timeMatch = block.match(/<time[^>]*datetime="([^"]*)"/);
    if (!timeMatch) continue;

    const textMatch = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    if (!textMatch) continue;

    // Strip HTML tags, decode entities
    const text = textMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();

    if (!text) continue;

    messages.push({
      id: postMatch[1],
      text,
      datetime: timeMatch[1],
      timeMs: new Date(timeMatch[1]).getTime()
    });
  }

  return messages;
}

// Check if message text describes a missile impact
function isImpactRelated(text) {
  if (EXCLUDE_PATTERNS.some(p => text.includes(p))) return false;
  return IMPACT_KEYWORDS.some(kw => text.includes(kw));
}

// Common Hebrew city abbreviations used in Telegram reports
const CITY_ABBREVIATIONS = {
  'פ"ת': 'פתח תקווה', 'פ״ת': 'פתח תקווה',
  'ת"א': 'תל אביב - יפו', 'ת״א': 'תל אביב - יפו',
  'ב"ש': 'באר שבע', 'ב״ש': 'באר שבע',
  'ר"ג': 'רמת גן', 'ר״ג': 'רמת גן',
  'ב"ב': 'בני ברק', 'ב״ב': 'בני ברק',
  'ר"ל': 'ראשון לציון', 'ר״ל': 'ראשון לציון',
  'ק"ש': 'קריית שמונה', 'ק״ש': 'קריית שמונה',
  'כ"ס': 'כפר סבא', 'כ״ס': 'כפר סבא',
  'ר"ע': 'ראש העין', 'ר״ע': 'ראש העין',
  'ק"א': 'קריית אתא', 'ק״א': 'קריית אתא',
  'ק"ב': 'קריית ביאליק', 'ק״ב': 'קריית ביאליק',
  'ק"מ': 'קריית מוצקין', 'ק״מ': 'קריית מוצקין',
  'ק"ג': 'קריית גת', 'ק״ג': 'קריית גת',
  'ג"ש': 'גבעת שמואל', 'ג״ש': 'גבעת שמואל',
  'ז"י': 'זכרון יעקב', 'ז״י': 'זכרון יעקב',
};

// Street/area prefixes — city names appearing AFTER these are street names, NOT city locations.
// e.g., "רחוב יבנה" = Yavne Street, not the city Yavne
const STREET_PREFIXES = ['רחוב', 'רח\'', 'שדרות', 'שד\'', 'סמטת', 'דרך', 'כיכר'];

// Known area landmarks mapped to their city coordinates
const AREA_LANDMARKS = {
  'כיכר הבימה':    { lat: 32.0725, lng: 34.7797, city: 'תל אביב - כיכר הבימה' },
  'כיכר רבין':     { lat: 32.0794, lng: 34.7808, city: 'תל אביב - כיכר רבין' },
  'כיכר דיזנגוף':   { lat: 32.0775, lng: 34.7744, city: 'תל אביב - כיכר דיזנגוף' },
  'נמל תל אביב':   { lat: 32.0972, lng: 34.7733, city: 'תל אביב - הנמל' },
  'שוק הכרמל':     { lat: 32.0667, lng: 34.7700, city: 'תל אביב - שוק הכרמל' },
  'תחנה מרכזית':   { lat: 32.0564, lng: 34.7714, city: 'תל אביב - תחנה מרכזית' },
  'שדרות רוטשילד':  { lat: 32.0633, lng: 34.7747, city: 'תל אביב - רוטשילד' },
  'אזור התעשייה':   { lat: 0, lng: 0, city: '' }, // generic, skip — needs city context
};

// Known landmarks (interchanges, junctions, highways) mapped to nearest city coordinates.
// Telegram reports often reference road landmarks instead of city names.
const LANDMARK_LOCATIONS = {
  // Interchanges (מחלפים)
  'מחלף קסם':      { lat: 32.1064, lng: 34.9511, city: 'מחלף קסם (ליד כפר קאסם)' },
  'מחלף גלילות':   { lat: 32.1489, lng: 34.8092, city: 'מחלף גלילות (ליד רמת השרון)' },
  'מחלף השרון':    { lat: 32.1833, lng: 34.8833, city: 'מחלף השרון (ליד הוד השרון)' },
  'מחלף ענבה':     { lat: 31.8386, lng: 34.9886, city: 'מחלף ענבה (ליד בית שמש)' },
  'מחלף מורשה':    { lat: 31.8750, lng: 34.8000, city: 'מחלף מורשה (ליד מודיעין)' },
  'מחלף לוד':      { lat: 31.9500, lng: 34.8833, city: 'מחלף לוד' },
  'מחלף בן גוריון': { lat: 31.9975, lng: 34.8697, city: 'מחלף בן גוריון (ליד נתב"ג)' },
  'מחלף אייל':     { lat: 32.2833, lng: 34.9667, city: 'מחלף אייל' },
  'מחלף רעננה':    { lat: 32.1833, lng: 34.8500, city: 'מחלף רעננה' },
  'מחלף כפר סבא':  { lat: 32.1833, lng: 34.9167, city: 'מחלף כפר סבא' },
  'מחלף נחשונים':   { lat: 32.0667, lng: 34.9333, city: 'מחלף נחשונים' },
  'מחלף ירקון':     { lat: 32.1000, lng: 34.8833, city: 'מחלף ירקון (ליד פתח תקווה)' },
  'מחלף גהה':      { lat: 32.0833, lng: 34.8333, city: 'מחלף גהה (ליד פתח תקווה)' },
  // Junctions (צמתים)
  'צומת מגידו':    { lat: 32.5833, lng: 35.1833, city: 'צומת מגידו' },
  'צומת גולני':    { lat: 32.7667, lng: 35.5000, city: 'צומת גולני' },
  'צומת כפר סבא':  { lat: 32.1833, lng: 34.9000, city: 'צומת כפר סבא' },
  'צומת בילו':     { lat: 31.8500, lng: 34.8167, city: 'צומת בילו' },
  'צומת שורק':     { lat: 31.7667, lng: 34.7500, city: 'צומת שורק' },
  'צומת נחשון':    { lat: 31.8333, lng: 34.9833, city: 'צומת נחשון' },
};

// Hebrew single-letter prefixes that attach to words (ב=in, ה=the, ל=to, מ=from, ש=that, כ=like, ו=and, ד=of)
const HEBREW_PREFIXES = 'בהלמשכוד';

// City names that are also extremely common Hebrew words.
// These produce false positives in news/report text and are excluded from impact matching.
// "אזור"=area, "מגן"=shield, "נשר"=eagle, "גשר"=bridge, "חמד"=charm, "שחר"=dawn,
// "מתן"=giving, "עומר"=sheaf, "רחוב"=street, "מצפה"=lookout, "חצור"=yard,
// "אילת"=none(but common in phrases), "מסדה"=lineup, "חורה"=pale, "שמיר"=thorn,
// "נועם"=pleasantness, "מאור"=light, "מעון"=dwelling, "חרות"=freedom, "חריש"=plowing,
// "שורש"=root, "לפיד"=torch, "סולם"=ladder, "ברקת"=emerald, "גלעד"=monument,
// "תומר"=palm tree, "דולב"=plane tree, "כרמל"=Carmel/vineyard, "ברוש"=cypress
const AMBIGUOUS_CITY_NAMES = new Set([
  'אזור', 'מגן', 'נשר', 'גשר', 'חמד', 'שחר', 'מתן', 'עומר', 'רחוב',
  'מצפה', 'חצור', 'מסדה', 'חורה', 'שמיר', 'נועם', 'מאור', 'מעון', 'חרות',
  'חריש', 'שורש', 'לפיד', 'סולם', 'ברקת', 'גלעד', 'תומר', 'דולב', 'כרמל',
  'ברוש', 'גונן', 'חוסן', 'חזון', 'יבול', 'סער', 'עידן', 'שילה', 'איתן',
  'גדות', 'מגדל', 'נחלה', 'קשת', 'רמות', 'עופר', 'דליה', 'הילה', 'גורן'
]);

// Check if a city name match at `index` in `text` sits on a real word boundary.
// Allows Hebrew prefix letters (ב, ה, ל, etc.) before the match.
function isHebrewWordBoundary(text, cityName, index) {
  const hebrewCharRegex = /[\u0590-\u05FF]/;

  // --- Check BEFORE the match ---
  if (index > 0) {
    const charBefore = text[index - 1];
    if (hebrewCharRegex.test(charBefore)) {
      // Hebrew char before — only OK if it's a single-letter prefix after a non-Hebrew boundary
      if (HEBREW_PREFIXES.includes(charBefore)) {
        if (index >= 2 && hebrewCharRegex.test(text[index - 2])) {
          return false; // prefix is itself part of a longer word
        }
        // else: prefix after space/start — OK
      } else {
        return false; // city name is embedded inside a longer Hebrew word
      }
    }
  }

  // --- Check AFTER the match ---
  const afterIndex = index + cityName.length;
  if (afterIndex < text.length) {
    const charAfter = text[afterIndex];
    if (hebrewCharRegex.test(charAfter)) {
      return false; // city name is a prefix of a longer word
    }
  }

  return true;
}

// Find all word-boundary occurrences of `cityName` in `text`.
// Returns true if at least one valid occurrence exists.
function hasCityMatch(text, cityName) {
  let start = 0;
  while (true) {
    const idx = text.indexOf(cityName, start);
    if (idx === -1) return false;
    if (isHebrewWordBoundary(text, cityName, idx)) return true;
    start = idx + 1;
  }
}

// Check if a city name appears in a location-indicating context
// (near prepositions like ב, באזור, ליד, etc.)
// For ambiguous names, requires stronger evidence (e.g., "ביישוב X", "בעיר X")
function hasLocationContext(text, cityName) {
  const escaped = cityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const notFollowedByHebrew = `(?![\\u0590-\\u05FF])`;

  if (AMBIGUOUS_CITY_NAMES.has(cityName)) {
    // Stricter patterns for ambiguous names — "ב+name" alone is not enough
    // because "באזור" means "in the area of", not "in Azor"
    const strictPatterns = [
      new RegExp(`(?:ביישוב|בעיר|בקיבוץ|במושב|בכפר|ביישוב|בשכונת)\\s+${escaped}${notFollowedByHebrew}`),
      new RegExp(`(?:יישוב|עיר|קיבוץ|מושב|כפר)\\s+${escaped}${notFollowedByHebrew}`),
    ];
    return strictPatterns.some(p => p.test(text));
  }

  const locationPatterns = [
    new RegExp(`ב${escaped}${notFollowedByHebrew}`),                     // בחיפה
    new RegExp(`(?:באזור|ליד|סמוך ל|אזור)\\s+${escaped}${notFollowedByHebrew}`), // באזור חיפה
    new RegExp(`(?:^|\\n)\\s*${escaped}${notFollowedByHebrew}`, 'm'),    // city at start of line
  ];
  return locationPatterns.some(p => p.test(text));
}

// Collect city names that appear after street prefixes (רחוב, שדרות, כיכר, etc.)
// These are street names, NOT city references.
function getStreetNameCities(text) {
  const streetCities = new Set();
  for (const prefix of STREET_PREFIXES) {
    // Match: prefix + space + Hebrew word(s)
    const regex = new RegExp(`${prefix}\\s+([\\u0590-\\u05FF][^\\s,\\.\\n]*(?:\\s+[\\u0590-\\u05FF][^\\s,\\.\\n]*)?)`, 'g');
    let m;
    while ((m = regex.exec(text)) !== null) {
      const streetName = m[1].trim();
      // If this street name matches a city name, mark it as a street reference
      if (cities[streetName]) {
        streetCities.add(streetName);
      }
    }
  }
  return streetCities;
}

// Expand city abbreviations in text (פ"ת → פתח תקווה, etc.)
// Returns both the expanded text and a map of abbreviation → full city name found
function expandAbbreviations(text) {
  const found = new Map(); // abbrev → full name
  let expanded = text;
  for (const [abbrev, fullName] of Object.entries(CITY_ABBREVIATIONS)) {
    if (text.includes(abbrev)) {
      found.set(abbrev, fullName);
      expanded = expanded.replace(new RegExp(abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), fullName);
    }
  }
  return { expanded, found };
}

// Extract locations from Hebrew impact message text
function extractLocations(text) {
  const results = [];

  // 0. Expand abbreviations first (פ"ת → פתח תקווה)
  const { expanded, found: abbreviationsFound } = expandAbbreviations(text);
  const workingText = expanded;

  // 0b. Identify city names used as street names (exclude from city matching)
  const streetNameCities = getStreetNameCities(workingText);

  // 1. Match known city names with word-boundary awareness (longest match first)
  //    Require minimum 4 characters to avoid matching common Hebrew words.
  //    Ambiguous city names (common Hebrew words) require explicit location context.
  //    City names that appear as street names are excluded.
  const matchedCities = [];
  for (const [cityName, cityData] of Object.entries(cities)) {
    if (cityName.length < 4) continue;
    if (!hasCityMatch(workingText, cityName)) continue;

    // Skip city names that are used as street names in this message
    if (streetNameCities.has(cityName)) continue;

    const inContext = hasLocationContext(workingText, cityName);

    // Ambiguous names (common words) are ONLY accepted with explicit location context
    if (AMBIGUOUS_CITY_NAMES.has(cityName) && !inContext) continue;

    matchedCities.push({ name: cityName, data: cityData, contextScore: inContext ? 10 : 0 });
  }
  matchedCities.sort((a, b) => b.name.length - a.name.length);

  // Remove cities that are substrings of longer matched cities
  const filtered = [];
  for (const city of matchedCities) {
    const isSubstring = filtered.some(c => c.name.includes(city.name) && c.name !== city.name);
    if (!isSubstring) filtered.push(city);
  }

  // 2. If any cities have location-context matches, prefer ONLY those.
  //    This avoids picking up incidental city-name mentions in the body.
  const contextMatches = filtered.filter(c => c.contextScore > 0);
  const bestMatches = contextMatches.length > 0 ? contextMatches : filtered;

  // 3. Extract street / neighborhood / area detail
  let detail = '';
  const detailPatterns = [
    { regex: /(?:ב)?רחוב\s+([\u0590-\u05FF][^\s,\.\n]*(?:\s[\u0590-\u05FF][^\s,\.\n]*)?)/, prefix: 'רחוב' },
    { regex: /(?:ב)?שכונת\s+([\u0590-\u05FF][^\s,\.\n]*(?:\s[\u0590-\u05FF][^\s,\.\n]*)?)/, prefix: 'שכונת' },
    { regex: /(?:ב)?אזור\s+([\u0590-\u05FF][^\s,\.\n]*(?:\s[\u0590-\u05FF][^\s,\.\n]*)?)/, prefix: 'אזור' },
  ];

  for (const p of detailPatterns) {
    const m = workingText.match(p.regex);
    if (m) {
      detail = `${p.prefix} ${m[1].trim()}`;
      break;
    }
  }

  // 4. Build location results (only from best matches)
  for (const city of bestMatches) {
    results.push({
      name: detail ? `${city.name} - ${detail}` : city.name,
      lat: city.data.lat,
      lng: city.data.lng,
      city: city.name,
      detail
    });
  }

  // 5. If no city matched, try area landmarks (כיכר הבימה, etc.)
  if (results.length === 0) {
    for (const [landmark, coords] of Object.entries(AREA_LANDMARKS)) {
      if (coords.lat && workingText.includes(landmark)) {
        results.push({
          name: coords.city,
          lat: coords.lat,
          lng: coords.lng,
          city: coords.city,
          detail: ''
        });
        break;
      }
    }
  }

  // 6. If still no match, try road landmarks (interchanges, junctions)
  if (results.length === 0) {
    for (const [landmark, coords] of Object.entries(LANDMARK_LOCATIONS)) {
      if (workingText.includes(landmark)) {
        results.push({
          name: coords.city,
          lat: coords.lat,
          lng: coords.lng,
          city: coords.city,
          detail: ''
        });
        break;
      }
    }
  }

  return results;
}

// Impact endpoint — returns parsed Telegram impact reports
app.get('/api/impacts', async (req, res) => {
  try {
    const now = Date.now();

    // Return cache if fresh
    if (now - telegramCache.time < TELEGRAM_CACHE_TTL) {
      return res.json({ impacts: telegramCache.impacts, cached: true });
    }

    // Fetch and parse all Telegram channels in parallel
    const channelResults = await Promise.allSettled(
      TELEGRAM_CHANNELS.map(async (channel) => {
        const html = await fetchRawHTML('t.me', channel);
        return parseTelegramHTML(html).map(m => ({ ...m, channel }));
      })
    );
    const messages = channelResults
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Only messages from last 2 hours that are impact-related
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    const impactMessages = messages.filter(m =>
      m.timeMs > twoHoursAgo && isImpactRelated(m.text)
    );

    // Extract locations and deduplicate by city + time window.
    // Multiple Telegram messages about the same impact at the same city
    // should produce only ONE map marker, using the latest message.
    const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30-minute window
    const cityImpactMap = new Map(); // key: cityName -> best impact

    for (const msg of impactMessages) {
      const locations = extractLocations(msg.text);
      if (locations.length === 0) continue;

      for (const loc of locations) {
        const existing = cityImpactMap.get(loc.city);
        if (existing) {
          // Same city within the dedup window — keep the latest message
          if (Math.abs(msg.timeMs - existing.timeMs) < DEDUP_WINDOW_MS) {
            if (msg.timeMs > existing.timeMs) {
              // Update to newer message
              cityImpactMap.set(loc.city, {
                id: `tg-${msg.id}-${loc.city}`,
                messageId: msg.id,
                text: msg.text.substring(0, 300),
                location: loc.name,
                city: loc.city,
                detail: loc.detail,
                lat: loc.lat,
                lng: loc.lng,
                timeMs: msg.timeMs,
                timestamp: msg.datetime
              });
            }
            continue; // deduplicated
          }
        }

        cityImpactMap.set(loc.city, {
          id: `tg-${msg.id}-${loc.city}`,
          messageId: msg.id,
          text: msg.text.substring(0, 300),
          location: loc.name,
          city: loc.city,
          detail: loc.detail,
          lat: loc.lat,
          lng: loc.lng,
          timeMs: msg.timeMs,
          timestamp: msg.datetime
        });
      }
    }

    const impacts = Array.from(cityImpactMap.values());

    telegramCache = { time: now, impacts };
    res.json({ impacts, cached: false });
  } catch (e) {
    console.error('Impact fetch error:', e.message);
    res.json({ impacts: telegramCache.impacts || [], error: e.message });
  }
});

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
