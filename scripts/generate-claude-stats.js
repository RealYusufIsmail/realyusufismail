const fs = require('fs');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set');
  process.exit(1);
}

function formatTokens(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchAllUsage() {
  // Fetch usage for the last 30 days; paginate if needed
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];

  let allData = [];
  let url = `https://api.anthropic.com/v1/usage?start_date=${startDate}`;

  while (url) {
    const json = await fetchPage(url);
    allData = allData.concat(json.data ?? []);
    url = json.next_page ? `https://api.anthropic.com/v1/usage?${json.next_page}` : null;
  }

  return allData;
}

function aggregate(data) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let requestCount = 0;
  const modelCounts = {};

  for (const entry of data) {
    inputTokens += entry.input_tokens ?? 0;
    outputTokens += entry.output_tokens ?? 0;
    cacheCreationTokens += entry.cache_creation_input_tokens ?? 0;
    cacheReadTokens += entry.cache_read_input_tokens ?? 0;
    requestCount += entry.request_count ?? 1;

    const model = entry.model ?? 'unknown';
    modelCounts[model] = (modelCounts[model] ?? 0) + (entry.request_count ?? 1);
  }

  const topModel = Object.entries(modelCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m.replace('claude-', '').replace(/-\d{8}$/, ''))[0] ?? 'n/a';

  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, requestCount, topModel };
}

function generateSVG({ inputTokens, outputTokens, requestCount, topModel, updatedAt }) {
  const total = formatTokens(inputTokens + outputTokens);
  const input = formatTokens(inputTokens);
  const output = formatTokens(outputTokens);
  const reqs = requestCount >= 1000 ? `${(requestCount / 1000).toFixed(1)}K` : String(requestCount);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="165" viewBox="0 0 495 165">
  <style>
    .bg  { fill: #0d1117; }
    .bdr { fill: none; stroke: #30363d; stroke-width: 1; }
    .ttl { font: 600 14px 'Segoe UI', sans-serif; fill: #d29922; }
    .lbl { font: 12px 'Segoe UI', sans-serif; fill: #8b949e; }
    .val { font: 700 18px 'Segoe UI', sans-serif; fill: #e6edf3; }
    .sm  { font: 11px 'Segoe UI', sans-serif; fill: #6e7681; }
    .div { stroke: #21262d; stroke-width: 1; }
  </style>

  <rect class="bg" width="495" height="165" rx="6"/>
  <rect class="bdr" width="494" height="164" x="0.5" y="0.5" rx="6"/>

  <!-- Title bar -->
  <text x="18" y="30" class="ttl">🤖  Claude API Usage  ·  Last 30 days</text>
  <line x1="18" y1="40" x2="477" y2="40" class="div"/>

  <!-- Row 1: Total Tokens | Input | Output -->
  <text x="18"  y="65"  class="lbl">Total Tokens</text>
  <text x="18"  y="85"  class="val">${total}</text>

  <line x1="175" y1="46" x2="175" y2="100" class="div"/>

  <text x="193" y="65"  class="lbl">Input</text>
  <text x="193" y="85"  class="val">${input}</text>

  <line x1="340" y1="46" x2="340" y2="100" class="div"/>

  <text x="358" y="65"  class="lbl">Output</text>
  <text x="358" y="85"  class="val">${output}</text>

  <line x1="18" y1="100" x2="477" y2="100" class="div"/>

  <!-- Row 2: Requests | Top model -->
  <text x="18"  y="122" class="lbl">API Requests</text>
  <text x="18"  y="142" class="val">${reqs}</text>

  <line x1="175" y1="106" x2="175" y2="152" class="div"/>

  <text x="193" y="122" class="lbl">Most Used Model</text>
  <text x="193" y="142" class="val">${topModel}</text>

  <line x1="18" y1="152" x2="477" y2="152" class="div"/>

  <text x="18" y="160" class="sm">Updated ${updatedAt} · Anthropic API</text>
</svg>`;
}

(async () => {
  try {
    const data = await fetchAllUsage();
    const stats = aggregate(data);
    const updatedAt = formatDate(new Date().toISOString());
    const svg = generateSVG({ ...stats, updatedAt });

    fs.mkdirSync('assets', { recursive: true });
    fs.writeFileSync('assets/claude-stats.svg', svg);
    console.log(`✅ Claude stats SVG generated (${formatTokens(stats.inputTokens + stats.outputTokens)} total tokens, ${stats.requestCount} requests)`);
  } catch (err) {
    console.error('❌ Failed to generate Claude stats:', err.message);
    // Write an error SVG so the README still shows something
    const errorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="80" viewBox="0 0 495 80">
  <rect fill="#0d1117" width="495" height="80" rx="6"/>
  <rect fill="none" stroke="#30363d" stroke-width="1" width="494" height="79" x="0.5" y="0.5" rx="6"/>
  <text x="18" y="30" font="600 14px 'Segoe UI', sans-serif" fill="#d29922">🤖  Claude API Usage</text>
  <text x="18" y="55" font="12px 'Segoe UI', sans-serif" fill="#8b949e">Stats temporarily unavailable — will retry on next run</text>
</svg>`;
    fs.mkdirSync('assets', { recursive: true });
    fs.writeFileSync('assets/claude-stats.svg', errorSvg);
    process.exit(1);
  }
})();
