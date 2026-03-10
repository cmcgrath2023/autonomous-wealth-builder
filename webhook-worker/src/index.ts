/**
 * MTWM Mobile Dashboard — Cloudflare Worker
 * Receives HMAC-signed webhooks from local gateway, serves read-only mobile UI
 */

interface Env {
  MTWM_EVENTS: KVNamespace;
  WEBHOOK_SECRET: string;    // wrangler secret put WEBHOOK_SECRET
  DASHBOARD_TOKEN: string;   // wrangler secret put DASHBOARD_TOKEN
  DASHBOARD_TITLE: string;
}

interface RelayEvent {
  category: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface WebhookPayload {
  events: RelayEvent[];
  batchId: string;
  sentAt: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS for dashboard
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // Health check — no auth
    if (path === '/api/health') {
      return json({ ok: true, timestamp: new Date().toISOString() });
    }

    // Webhook ingest — HMAC auth
    if (path === '/api/ingest' && request.method === 'POST') {
      return handleIngest(request, env);
    }

    // Dashboard API — bearer token auth
    if (path.startsWith('/api/')) {
      const authError = checkBearerToken(request, env);
      if (authError) return authError;

      if (path === '/api/events') return handleGetEvents(url, env);
      if (path === '/api/status') return handleGetStatus(env);

      return json({ error: 'Not found' }, 404);
    }

    // Serve static dashboard
    if (path === '/' || path === '/index.html') {
      return serveDashboard(env);
    }

    return json({ error: 'Not found' }, 404);
  },
};

// --- Ingest ---

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get('X-Webhook-Signature');
  if (!signature) return json({ error: 'Missing signature' }, 401);

  const body = await request.text();

  // HMAC-SHA256 verification using Web Crypto
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected !== signature) {
    return json({ error: 'Invalid signature' }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!payload.events?.length) {
    return json({ error: 'No events' }, 400);
  }

  // Read current index
  const indexRaw = await env.MTWM_EVENTS.get('index:events');
  const index: RelayEvent[] = indexRaw ? JSON.parse(indexRaw) : [];

  // Prepend new events, keep last 100
  index.unshift(...payload.events);
  if (index.length > 100) index.length = 100;

  // Write index + archive batch
  await Promise.all([
    env.MTWM_EVENTS.put('index:events', JSON.stringify(index)),
    env.MTWM_EVENTS.put(
      `evt:${payload.sentAt}:${payload.batchId}`,
      JSON.stringify(payload.events),
      { expirationTtl: 604800 }, // 7 days
    ),
  ]);

  // Update portfolio snapshot if present
  const snapshot = payload.events.find(e => e.category === 'portfolio_snapshot');
  if (snapshot) {
    await env.MTWM_EVENTS.put('latest:portfolio_snapshot', JSON.stringify(snapshot.data));
  }

  return json({ ok: true, ingested: payload.events.length });
}

// --- API ---

async function handleGetEvents(url: URL, env: Env): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const category = url.searchParams.get('category');

  const indexRaw = await env.MTWM_EVENTS.get('index:events');
  let events: RelayEvent[] = indexRaw ? JSON.parse(indexRaw) : [];

  if (category) {
    events = events.filter(e => e.category === category);
  }

  return json(events.slice(0, limit), 200, { 'Cache-Control': 'public, max-age=15' });
}

async function handleGetStatus(env: Env): Promise<Response> {
  const raw = await env.MTWM_EVENTS.get('latest:portfolio_snapshot');
  const snapshot = raw ? JSON.parse(raw) : null;
  return json({ snapshot, timestamp: new Date().toISOString() });
}

// --- Auth ---

function checkBearerToken(request: Request, env: Env): Response | null {
  if (!env.DASHBOARD_TOKEN) return null; // no token configured = open (dev)
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.DASHBOARD_TOKEN}`) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

// --- Dashboard ---

function serveDashboard(env: Env): Response {
  const title = env.DASHBOARD_TITLE || 'MTWM Mobile';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:16px;max-width:600px;margin:0 auto}
h1{font-size:20px;color:#60a5fa;margin-bottom:4px}
.sub{font-size:12px;color:#666;margin-bottom:16px}
.status{background:#111;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:12px}
.status .val{font-size:24px;font-weight:700;color:#34d399}
.status .label{font-size:11px;color:#888;text-transform:uppercase}
.events{list-style:none}
.events li{background:#111;border:1px solid #222;border-radius:8px;padding:10px 12px;margin-bottom:8px}
.events .cat{font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:2px}
.events .time{font-size:10px;color:#555;float:right}
.events .detail{font-size:13px;color:#ccc}
.cat-trade_signal{color:#60a5fa}
.cat-trade_execution{color:#34d399}
.cat-trade_closure{color:#a78bfa}
.cat-risk_alert{color:#f87171}
.cat-re_task_complete{color:#fbbf24}
.cat-pending_approval{color:#fb923c}
.cat-agent_error{color:#f87171}
.refresh{font-size:11px;color:#444;text-align:center;margin-top:12px}
.auth-prompt{background:#111;border:1px solid #333;border-radius:8px;padding:20px;text-align:center}
.auth-prompt input{background:#222;border:1px solid #444;color:#fff;padding:8px 12px;border-radius:4px;width:100%;margin:8px 0}
.auth-prompt button{background:#2563eb;color:#fff;border:none;padding:8px 20px;border-radius:4px;cursor:pointer}
</style>
</head>
<body>
<h1>${title}</h1>
<p class="sub">Read-only mobile dashboard</p>

<div id="auth-screen" class="auth-prompt" style="display:none">
  <p style="margin-bottom:8px">Enter dashboard token</p>
  <input type="password" id="token-input" placeholder="Token">
  <br><button onclick="saveToken()">Connect</button>
</div>

<div id="dashboard" style="display:none">
  <div class="status" id="status-box">
    <div class="label">Portfolio</div>
    <div class="val" id="portfolio-val">—</div>
  </div>
  <h2 style="font-size:14px;color:#888;margin-bottom:8px">Recent Events</h2>
  <ul class="events" id="event-list"></ul>
  <div class="refresh" id="refresh-info">Loading...</div>
</div>

<script>
const TOKEN_KEY='mtwm_token';
let token=localStorage.getItem(TOKEN_KEY)||'';

function saveToken(){
  token=document.getElementById('token-input').value;
  localStorage.setItem(TOKEN_KEY,token);
  init();
}

function headers(){return token?{Authorization:'Bearer '+token}:{}}

async function fetchEvents(){
  try{
    const r=await fetch('/api/events?limit=30',{headers:headers()});
    if(r.status===401){showAuth();return}
    const events=await r.json();
    renderEvents(events);
  }catch(e){
    document.getElementById('refresh-info').textContent='Connection error';
  }
}

async function fetchStatus(){
  try{
    const r=await fetch('/api/status',{headers:headers()});
    if(r.ok){
      const d=await r.json();
      if(d.snapshot&&d.snapshot.totalValue){
        document.getElementById('portfolio-val').textContent='$'+Number(d.snapshot.totalValue).toLocaleString();
      }
    }
  }catch{}
}

function renderEvents(events){
  const ul=document.getElementById('event-list');
  ul.innerHTML='';
  for(const e of events){
    const li=document.createElement('li');
    const t=new Date(e.timestamp).toLocaleTimeString();
    const detail=Object.entries(e.data||{}).map(([k,v])=>k+': '+v).join(', ');
    li.innerHTML='<span class="time">'+t+'</span><div class="cat cat-'+e.category+'">'+e.category.replace(/_/g,' ')+'</div><div class="detail">'+detail+'</div>';
    ul.appendChild(li);
  }
  document.getElementById('refresh-info').textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes every 30s';
}

function showAuth(){
  document.getElementById('auth-screen').style.display='block';
  document.getElementById('dashboard').style.display='none';
}

async function init(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('dashboard').style.display='block';
  await Promise.all([fetchEvents(),fetchStatus()]);
  setInterval(()=>{fetchEvents();fetchStatus()},30000);
}

// Check if token is needed
fetch('/api/health').then(()=>init()).catch(()=>showAuth());
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

// --- Helpers ---

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Webhook-Signature',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
