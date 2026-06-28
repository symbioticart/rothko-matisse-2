// Rothko Matisse 2 — symbiotic server.
// Live Oura sync. Metrics are held IN MEMORY, never written to disk.
// The painting is a continuous loop: the body feeds the work daily; a gap in
// the data is left visible — the silence of a stopped signal is part of the work.

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const dir  = __dirname;
const port = process.env.PORT || 3457;

// === SECRETS (env only — never commit) ===
let ACCESS_TOKEN  = process.env.OURA_TOKEN   || '';   // PAT or OAuth access token
let REFRESH_TOKEN = process.env.OURA_REFRESH || '';   // optional, enables auto-refresh
const CLIENT_ID     = process.env.OURA_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.OURA_CLIENT_SECRET || '';

const SYNC_DAYS     = 180;                  // rolling window pulled from Oura
const SYNC_INTERVAL = 6 * 60 * 60 * 1000;   // re-sync every 6h

// === IN-MEMORY STATE ===
const STATE = {
  payload: null,     // { stats, days, meta } served to the browser
  lastSync: null,    // ISO timestamp of last successful sync
  syncing: false,
};

const mimeTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.map': 'application/json',
};

// ---------- Oura HTTP ----------
function ouraGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(urlStr),
      { method: 'GET', headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject); req.end();
  });
}

function refreshAccessToken() {
  return new Promise((resolve, reject) => {
    if (!REFRESH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) return reject(new Error('no refresh creds'));
    const body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    }).toString();
    const req = https.request(new URL('https://api.ouraring.com/oauth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
      if (res.statusCode !== 200) return reject(new Error(`refresh ${res.statusCode}: ${d.slice(0,120)}`));
      const j = JSON.parse(d);
      ACCESS_TOKEN = j.access_token;
      if (j.refresh_token) REFRESH_TOKEN = j.refresh_token;  // rotate in memory
      console.log('[oura] access token refreshed');
      resolve();
    }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

// GET that transparently refreshes once on 401.
async function ouraGetAuthed(urlStr) {
  let r = await ouraGet(urlStr);
  if (r.status === 401) { await refreshAccessToken(); r = await ouraGet(urlStr); }
  return r;
}

async function fetchCollection(name, qs) {
  const url = `https://api.ouraring.com/v2/usercollection/${name}?${qs}`;
  const r = await ouraGetAuthed(url);
  if (r.status !== 200) throw new Error(`${name} ${r.status}: ${r.body.slice(0,120)}`);
  return JSON.parse(r.body).data || [];
}

// ---------- raw Oura -> daily metrics (mirror of build_30d_summary.py:build_day) ----------
const INTENSITY = { easy: 1, moderate: 2, hard: 3 };

function buildDays(sleepRaw, dailySleep, dailyReady, workoutRaw) {
  const dsByDay = Object.fromEntries(dailySleep.map(r => [r.day, r]));
  const rdByDay = Object.fromEntries(dailyReady.map(r => [r.day, r]));

  // Per day, keep the longest long_sleep document.
  const slByDay = {};
  for (const s of sleepRaw) {
    if (s.type !== 'long_sleep') continue;
    const cur = slByDay[s.day];
    if (!cur || (s.total_sleep_duration || 0) > (cur.total_sleep_duration || 0)) slByDay[s.day] = s;
  }

  // Workouts aggregated per day.
  const wkByDay = {};
  for (const w of workoutRaw) {
    const d = w.day; if (!d) continue;
    (wkByDay[d] ||= { count: 0, intensity: 0, activities: [] });
    wkByDay[d].count += 1;
    wkByDay[d].intensity += INTENSITY[w.intensity] ?? 1;
    if (w.activity) wkByDay[d].activities.push(w.activity);
  }

  const allDays = [...new Set([...Object.keys(slByDay), ...Object.keys(dsByDay), ...Object.keys(rdByDay)])].sort();
  const days = [];
  for (const d of allDays) {
    const sl = slByDay[d], ds = dsByDay[d], rd = rdByDay[d], wk = wkByDay[d];
    const ts = (sl && sl.total_sleep_duration) || 0;
    if (!sl && !ds && !rd) continue;
    days.push({
      day: d,
      readinessScore: rd ? rd.score : null,
      sleepScore:     ds ? ds.score : null,
      hrv:             sl ? sl.average_hrv : null,
      avgHeartRate:    sl ? sl.average_heart_rate : null,
      lowestHeartRate: sl ? sl.lowest_heart_rate : null,
      avgBreath:       sl ? sl.average_breath : null,
      totalSleepHours: ts ? +(ts / 3600).toFixed(2) : null,
      deepSleepPct:    sl && ts ? +(sl.deep_sleep_duration / ts).toFixed(3) : null,
      remSleepPct:     sl && ts ? +(sl.rem_sleep_duration / ts).toFixed(3) : null,
      efficiency:      sl ? sl.efficiency : null,
      latency:         sl ? sl.latency : null,
      restlessPeriods: sl ? sl.restless_periods : null,
      awakeTime:       sl ? sl.awake_time : null,
      tempDeviation:   rd ? rd.temperature_deviation : null,
      workoutCount:     wk ? wk.count : 0,
      workoutIntensity: wk ? wk.intensity : 0,
      activities:       wk ? [...new Set(wk.activities)] : [],
    });
  }
  return days;
}

const STAT_KEYS = ['hrv','avgHeartRate','readinessScore','sleepScore','tempDeviation',
                   'restlessPeriods','latency','workoutIntensity','avgBreath'];

function buildStats(days) {
  const stats = {};
  for (const k of STAT_KEYS) {
    const v = days.map(d => d[k]).filter(x => x != null && !isNaN(x));
    if (!v.length) continue;
    stats[k] = { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a,b)=>a+b,0)/v.length };
  }
  return stats;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }

// ---------- sync ----------
async function sync() {
  if (STATE.syncing) return;
  if (!ACCESS_TOKEN && !(REFRESH_TOKEN && CLIENT_ID)) { console.warn('[oura] no token configured — serving fallback'); return; }
  STATE.syncing = true;
  try {
    const end   = new Date();
    const start = new Date(end.getTime() - SYNC_DAYS * 864e5);
    const qs = `start_date=${isoDate(start)}&end_date=${isoDate(end)}`;

    const [sleepRaw, dailySleep, dailyReady, workoutRaw] = await Promise.all([
      fetchCollection('sleep', qs),
      fetchCollection('daily_sleep', qs),
      fetchCollection('daily_readiness', qs),
      fetchCollection('workout', qs),
    ]);

    const days = buildDays(sleepRaw, dailySleep, dailyReady, workoutRaw);
    if (!days.length) throw new Error('no days built');

    const lastDataDay = days[days.length - 1].day;
    const serverDate  = isoDate(end);
    const gapDays     = Math.max(0, daysBetween(lastDataDay, serverDate));
    const status      = gapDays <= 1 ? 'fresh' : gapDays <= 7 ? 'stable' : 'dormant';

    STATE.payload = {
      stats: buildStats(days),
      days,
      meta: { lastDataDay, serverDate, gapDays, status, live: true, syncedAt: new Date().toISOString() },
    };
    STATE.lastSync = new Date().toISOString();
    console.log(`[oura] synced ${days.length} days, last=${lastDataDay}, gap=${gapDays}d, status=${status}`);
  } catch (e) {
    console.error('[oura] sync failed:', e.message);
    if (!STATE.payload) loadFallback();
  } finally {
    STATE.syncing = false;
  }
}

// Cold-start fallback: bundled snapshot, flagged not-live.
function loadFallback() {
  if (STATE.payload && STATE.payload.meta && STATE.payload.meta.live) return; // don't clobber live data
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'daily-metrics.json'), 'utf8'));
    const days = raw.days || [];
    const lastDataDay = days.length ? days[days.length - 1].day : null;
    const serverDate  = isoDate(new Date());
    const gapDays     = lastDataDay ? Math.max(0, daysBetween(lastDataDay, serverDate)) : 0;
    STATE.payload = {
      stats: raw.stats || buildStats(days),
      days,
      meta: { lastDataDay, serverDate, gapDays, status: gapDays <= 7 ? 'stable' : 'dormant', live: false, syncedAt: null },
    };
    console.log(`[oura] fallback snapshot loaded (${days.length} days)`);
  } catch (e) { console.error('[oura] fallback failed:', e.message); }
}

// ---------- HTTP server ----------
http.createServer((req, res) => {
  let url = req.url.split('?')[0];

  if (url === '/data/daily-metrics.json') {
    if (!STATE.payload) loadFallback();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(STATE.payload || { stats: {}, days: [], meta: { status: 'dormant', live: false } }));
    return;
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, lastSync: STATE.lastSync, meta: STATE.payload && STATE.payload.meta }));
    return;
  }

  if (url === '/') url = '/index.html';
  const filePath = path.join(dir, decodeURIComponent(url));
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + url); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`Rothko Matisse 2 — http://localhost:${port}`);
  loadFallback();          // serve something immediately
  sync();                  // then pull live data
  setInterval(sync, SYNC_INTERVAL);
});
