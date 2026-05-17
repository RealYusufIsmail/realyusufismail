const fs = require('fs');

const ADMIN_KEY = process.env.ANTHROPIC_ADMIN_API_KEY;
if (!ADMIN_KEY) {
  console.error('ANTHROPIC_ADMIN_API_KEY is not set');
  process.exit(1);
}

const BASE = 'https://api.anthropic.com';
const HEADERS = { 'x-api-key': ADMIN_KEY, 'anthropic-version': '2023-06-01' };

function fmt(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchLast30Days() {
  // Fetch one day at a time for the last 30 days, stopping on empty days
  const days = [];
  const today = new Date();

  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const date = d.toISOString().split('T')[0];

    let page = null;
    do {
      const qs = `starting_at=${date}&limit=1000${page ? `&page=${page}` : ''}`;
      const json = await get(`/v1/organizations/usage_report/claude_code?${qs}`);
      days.push(...(json.data ?? []));
      page = json.has_more ? json.next_page : null;
    } while (page);
  }

  return days;
}

function aggregate(data) {
  let sessions = 0;
  let commits = 0;
  let prs = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let costCents = 0;
  const modelTotals = {};

  for (const entry of data) {
    const cm = entry.core_metrics ?? {};
    sessions    += cm.num_sessions ?? 0;
    commits     += cm.commits_by_claude_code ?? 0;
    prs         += cm.pull_requests_by_claude_code ?? 0;
    linesAdded  += cm.lines_of_code?.added ?? 0;
    linesRemoved+= cm.lines_of_code?.removed ?? 0;

    for (const mb of entry.model_breakdown ?? []) {
      const t = mb.tokens ?? {};
      inputTokens  += t.input ?? 0;
      outputTokens += t.output ?? 0;
      cacheTokens  += (t.cache_creation ?? 0) + (t.cache_read ?? 0);
      costCents    += mb.estimated_cost?.amount ?? 0;

      const name = (mb.model ?? 'unknown').replace('claude-', '').replace(/-\d{8}$/, '');
      modelTotals[name] = (modelTotals[name] ?? 0) + (t.input ?? 0) + (t.output ?? 0);
    }
  }

  const topModel = Object.entries(modelTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'n/a';
  const costUSD  = (costCents / 100).toFixed(2);

  return { sessions, commits, prs, linesAdded, linesRemoved, inputTokens, outputTokens, cacheTokens, costUSD, topModel };
}

function generateSVG(s) {
  const updated = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const totalTok = fmt(s.inputTokens + s.outputTokens + s.cacheTokens);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="205" viewBox="0 0 495 205">
  <style>
    .bg  { fill: #0d1117; }
    .bdr { fill: none; stroke: #30363d; stroke-width: 1; }
    .ttl { font: 600 14px 'Segoe UI',sans-serif; fill: #d29922; }
    .lbl { font: 11px 'Segoe UI',sans-serif; fill: #8b949e; }
    .val { font: 700 17px 'Segoe UI',sans-serif; fill: #e6edf3; }
    .sm  { font: 10px 'Segoe UI',sans-serif; fill: #6e7681; }
    .div { stroke: #21262d; stroke-width: 1; }
  </style>

  <rect class="bg" width="495" height="205" rx="6"/>
  <rect class="bdr" width="494" height="204" x="0.5" y="0.5" rx="6"/>

  <!-- Title -->
  <text x="18" y="28" class="ttl">&#x1F916;  Claude Code Usage  ·  Last 30 days</text>
  <line x1="18" y1="36" x2="477" y2="36" class="div"/>

  <!-- Row 1: Sessions | Commits | PRs -->
  <text x="18"  y="58"  class="lbl">Sessions</text>
  <text x="18"  y="76"  class="val">${fmt(s.sessions)}</text>

  <line x1="175" y1="41" x2="175" y2="90" class="div"/>
  <text x="193" y="58"  class="lbl">Commits</text>
  <text x="193" y="76"  class="val">${fmt(s.commits)}</text>

  <line x1="340" y1="41" x2="340" y2="90" class="div"/>
  <text x="358" y="58"  class="lbl">Pull Requests</text>
  <text x="358" y="76"  class="val">${fmt(s.prs)}</text>

  <line x1="18" y1="90" x2="477" y2="90" class="div"/>

  <!-- Row 2: Lines Added | Lines Removed | Tokens -->
  <text x="18"  y="110" class="lbl">Lines Added</text>
  <text x="18"  y="128" class="val">+${fmt(s.linesAdded)}</text>

  <line x1="175" y1="95" x2="175" y2="142" class="div"/>
  <text x="193" y="110" class="lbl">Lines Removed</text>
  <text x="193" y="128" class="val">-${fmt(s.linesRemoved)}</text>

  <line x1="340" y1="95" x2="340" y2="142" class="div"/>
  <text x="358" y="110" class="lbl">Tokens Used</text>
  <text x="358" y="128" class="val">${totalTok}</text>

  <line x1="18" y1="142" x2="477" y2="142" class="div"/>

  <!-- Row 3: Cost | Top Model -->
  <text x="18"  y="162" class="lbl">Est. Cost</text>
  <text x="18"  y="180" class="val">$${s.costUSD}</text>

  <line x1="175" y1="147" x2="175" y2="190" class="div"/>
  <text x="193" y="162" class="lbl">Most Used Model</text>
  <text x="193" y="180" class="val">${s.topModel}</text>

  <line x1="18" y1="190" x2="477" y2="190" class="div"/>
  <text x="18" y="200" class="sm">Updated ${updated}  ·  Anthropic Admin API</text>
</svg>`;
}

(async () => {
  try {
    const data = await fetchLast30Days();
    const stats = aggregate(data);
    const svg = generateSVG(stats);

    fs.mkdirSync('assets', { recursive: true });
    fs.writeFileSync('assets/claude-stats.svg', svg);
    console.log(`✅ Done — ${stats.sessions} sessions, ${stats.commits} commits, $${stats.costUSD} estimated cost`);
  } catch (err) {
    console.error('❌ Failed to generate Claude stats:', err.message);
    const errSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="80" viewBox="0 0 495 80">
  <rect fill="#0d1117" width="495" height="80" rx="6"/>
  <rect fill="none" stroke="#30363d" stroke-width="1" width="494" height="79" x="0.5" y="0.5" rx="6"/>
  <text x="18" y="30" style="font:600 14px sans-serif;fill:#d29922">&#x1F916;  Claude Code Usage</text>
  <text x="18" y="55" style="font:12px sans-serif;fill:#8b949e">Stats temporarily unavailable — will retry on next run</text>
</svg>`;
    fs.mkdirSync('assets', { recursive: true });
    fs.writeFileSync('assets/claude-stats.svg', errSvg);
    process.exit(1);
  }
})();
