// Daily news refresh for the dashboard (run by .github/workflows/news.yml).
// Pulls Google News RSS for UAE + global agentic AI, merges with what's already
// in data/news.json, and keeps the 3 most recent per section. If a feed fails
// or returns nothing new, the existing items are kept as-is.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../data/news.json', import.meta.url);
const LIMIT = 3;

const rss = (q, hl, gl, ceid) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

const FEEDS = {
  uae: [
    rss('"agentic AI" (UAE OR Emirates OR Dubai OR "Abu Dhabi") when:14d', 'en-AE', 'AE', 'AE:en'),
    rss('"الذكاء الاصطناعي المساعد" الإمارات when:14d', 'ar', 'AE', 'AE:ar'),
  ],
  global: [
    rss('"agentic AI" when:7d', 'en-US', 'US', 'US:en'),
  ],
};

const decode = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (news-dashboard)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const source = tag(it, 'source');
    let title = tag(it, 'title');
    // Google News appends " - Source" to titles
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const pub = new Date(tag(it, 'pubDate'));
    return {
      title,
      link: tag(it, 'link'),
      source,
      date: isNaN(pub) ? null : pub.toISOString(),
    };
  }).filter((x) => x.title && x.link);
}

const key = (x) => x.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const time = (x) => (x.date ? Date.parse(x.date) || 0 : 0);

const current = JSON.parse(await readFile(FILE, 'utf8'));
let changed = false;

for (const [section, urls] of Object.entries(FEEDS)) {
  const fresh = [];
  for (const url of urls) {
    try { fresh.push(...await fetchFeed(url)); }
    catch (e) { console.warn(`[${section}] feed failed: ${e.message}`); }
  }
  if (!fresh.length) { console.log(`[${section}] nothing fetched, keeping existing`); continue; }

  const seen = new Set();
  const merged = [...fresh, ...(current[section] || [])]
    .filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => time(b) - time(a))
    .slice(0, LIMIT);

  if (JSON.stringify(merged) !== JSON.stringify(current[section])) {
    current[section] = merged;
    changed = true;
  }
  console.log(`[${section}] ${merged.map((x) => x.title).join(' | ')}`);
}

if (changed) {
  current.updatedAt = new Date().toISOString();
  await writeFile(FILE, JSON.stringify(current, null, 1) + '\n');
  console.log('news updated');
} else {
  console.log('no new news; kept existing');
}
