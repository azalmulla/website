/* لوحة متابعة مشروع الذكاء الاصطناعي المساعد
 * Static single-page app. Data lives in data/project.json (stages, meetings & directives)
 * and data/news.json (refreshed daily by GitHub Actions). Edits are saved in the
 * browser and, if GitHub sync is configured in settings, committed back to the repo.
 */
(() => {
'use strict';

const TZ = 'Asia/Dubai';
const SCHEMA = 6;
const LS_STATE = 'aai.state.v1';
const LS_GH = 'aai.github.v1';
const LS_UI = 'aai.ui.v2';
const DATA_PATH = 'data/project.json';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DOW = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const COMMITTEES = { national: 'اللجنة الوطنية', ministry: 'لجنة الوزارة' };
const ORD = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر'];
const ICON = {
  check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  edit: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  upload: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/></svg>',
  note: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4M8 9h8M8 13h5"/></svg>',
  doc: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
};

/* ---------------- utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => String(n).padStart(2, '0');
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const uaeMidnight = (s) => new Date(s + 'T00:00:00+04:00').getTime();
const dayAfter = (s) => { const { y, m, d } = parse(s); const t = new Date(Date.UTC(y, m - 1, d + 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const startMs = (s) => uaeMidnight(s.start);
const endMs = (s) => uaeMidnight(dayAfter(s.end));   // stage end dates are inclusive (last day of the month)
const fmtDate = (s) => { const { y, m, d } = parse(s); return `${d} ${MONTHS[m - 1]} ${y}`; };
const fmtYM = (s) => { const { y, m } = parse(s); return `${MONTHS[m - 1]} ${y}`; };
const fmtMonths = (a, b) => { const A = parse(a), B = parse(b); return A.y === B.y ? `${MONTHS[A.m - 1]} – ${MONTHS[B.m - 1]} ${B.y}` : `${fmtYM(a)} – ${fmtYM(b)}`; };
const dowOf = (s) => { const { y, m, d } = parse(s); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const isDone = (it) => it.status === 'done';
// keep Latin/numeric tokens such as «1.ae» or «FedAI» in reading order inside Arabic text
const bd = (t) => esc(t).replace(/[0-9A-Za-z][0-9A-Za-z.%_\-/]*[0-9A-Za-z%]|[A-Za-z]/g, (m) => `<bdi dir="ltr">${m}</bdi>`);
// The toast is a popover so it shows in the top layer, above any open dialog.
function toast(msg) {
  const t = $('#toast'); t.textContent = msg;
  clearTimeout(toast.t); clearTimeout(toast.h);
  if (t.showPopover) { try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch {} }
  requestAnimationFrame(() => t.classList.add('show'));
  toast.t = setTimeout(() => { t.classList.remove('show'); toast.h = setTimeout(() => { try { t.hidePopover && t.hidePopover(); } catch {} }, 320); }, 2400);
}

/* ---------------- state & persistence ---------------- */
let state = null;
let news = null;
let fileSha = null;
const ui = Object.assign({ committee: 'national', meeting: {}, showDone: false }, ls.get(LS_UI) || {});
ui.lresetArm = false;
const saveUI = () => ls.set(LS_UI, ui);

const gh = () => ls.get(LS_GH);
const ghOn = () => { const g = gh(); return !!(g && g.token && g.owner && g.repo); };
const b64enc = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach((b) => bin += String.fromCharCode(b)); return btoa(bin); };
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

async function ghRequest(method, body) {
  const g = gh();
  const url = `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${DATA_PATH}` + (method === 'GET' && g.branch ? `?ref=${encodeURIComponent(g.branch)}` : '');
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${g.token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}
async function ghLoad() {
  const r = await ghRequest('GET');
  fileSha = r.sha;
  return JSON.parse(b64dec(r.content));
}
async function ghSave() {
  const g = gh();
  const put = () => ghRequest('PUT', {
    message: `تحديث بيانات اللوحة ${todayStr()}`,
    content: b64enc(JSON.stringify(state, null, 1) + '\n'),
    sha: fileSha || undefined,
    branch: g.branch || undefined,
  });
  let r;
  try { r = await put(); }
  catch (e) {
    // sha out of date (edited elsewhere) — refresh sha and retry once; our copy wins
    if (!/40[49]|422/.test(e.message)) throw e;
    try { fileSha = (await ghRequest('GET')).sha; } catch { fileSha = null; }
    r = await put();
  }
  fileSha = r.content.sha;
}

function setSync(kind, text) {
  const b = $('#syncBadge');
  if (!ghOn()) { b.hidden = true; return; }
  b.hidden = false; b.className = 'sync-badge ' + (kind || ''); b.textContent = text;
}

let saveTimer = null;
function commit(msg, quiet) {
  state.updatedAt = new Date().toISOString();
  ls.set(LS_STATE, state);
  if (msg) toast(msg);
  if (ghOn()) {
    setSync('', 'جارٍ المزامنة…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await ghSave(); setSync('ok', 'تمت المزامنة ✓'); }
      catch (e) { console.error(e); setSync('err', 'تعذّرت المزامنة'); }
    }, 1200);
  }
  if (!quiet) render();
}

async function fetchJSON(path) {
  const res = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' ' + res.status);
  return res.json();
}

// An older browser copy keeps its ticks, notes and any meetings added in the browser,
// but takes the new stages and meeting list from the repo. Ticks match by item id, or by
// topic within the same committee + meeting number (minutes uploaded in the browser).
function migrate(local, remote) {
  const key = (m) => `${m.committee}#${m.number || m.id}`;
  const byId = new Map(), byTopic = new Map();
  (local.meetings || []).forEach((m) => (m.items || []).forEach((it) => { byId.set(it.id, it); byTopic.set(key(m) + '|' + String(it.topic).trim(), it); }));
  remote.meetings.forEach((m) => (m.items || []).forEach((it) => {
    const old = byId.get(it.id) || byTopic.get(key(m) + '|' + String(it.topic).trim());
    if (old && old.status === 'done') { it.status = 'done'; if (old.doneDate) it.doneDate = old.doneDate; }
    else if (old && old.status === 'pending' && it.status === 'done' && old.untickedAt) { it.status = 'pending'; delete it.doneDate; }
    if (old && old.note) it.note = old.note;
  }));
  const have = new Set(remote.meetings.map((m) => m.id)), haveKey = new Set(remote.meetings.filter((m) => m.items.length).map(key));
  (local.meetings || []).forEach((m) => { if (!have.has(m.id) && (m.items || []).length && !haveKey.has(key(m))) remote.meetings.push(m); });
  ['launches', 'ideas'].forEach((k) => { if ((local[k] || []).length) remote[k] = local[k].map((x) => { const r = (remote[k] || []).find((y) => y.id === x.id); if (r) ['bg', 'avatars', 'logos', 'logosTop', 'mark', 'order'].forEach((f) => { if (x[f] === undefined && r[f] !== undefined) x[f] = r[f]; }); return x; }); });
  if (local.deck) remote.deck = local.deck;
  const lev = new Map((local.events || []).map((e) => [e.id, e]));
  (remote.events || []).forEach((e) => { const o = lev.get(e.id); if (o && (o.photos || []).length) e.photos = o.photos; });
  const rids = new Set((remote.events || []).map((e) => e.id));
  (local.events || []).forEach((e) => { if (!rids.has(e.id)) remote.events.push(e); });
  return remote;
}

async function load() {
  let remote = null;
  if (ghOn()) {
    try { remote = await ghLoad(); setSync('ok', 'متصل بـ GitHub'); }
    catch (e) { console.warn(e); setSync('err', 'تعذّر الاتصال بـ GitHub'); }
  }
  if (!remote) { try { remote = await fetchJSON(DATA_PATH); } catch (e) { console.warn(e); } }
  const local = ls.get(LS_STATE);
  if (local && remote && (local.schema || 1) < (remote.schema || 1)) { state = migrate(local, remote); ls.set(LS_STATE, state); }
  else if (local && (!remote || (local.updatedAt || '') >= (remote.updatedAt || ''))) state = local;
  else if (local && remote) { const st = local.stages, pr = local.project; state = migrate(local, remote); if ((st || []).length) state.stages = st; if (pr) state.project = { ...state.project, ...pr }; state.updatedAt = new Date().toISOString(); ls.set(LS_STATE, state); }
  else state = remote;
  if (!state) state = { schema: SCHEMA, updatedAt: '', project: {}, stages: [], meetings: [] };
  state.meetings ||= []; state.stages ||= []; state.project ||= {}; state.launches ||= []; state.ideas ||= []; state.events ||= [];
  state.events.forEach((e) => { e.photos ||= []; });
  state.meetings.forEach((m) => (m.items ||= []).forEach((it) => { if (it.status !== 'done') it.status = 'pending'; }));
  try { news = await fetchJSON('data/news.json'); } catch { news = { uae: [], global: [] }; }
}

/* ---------------- derived ---------------- */
const findMeeting = (id) => state.meetings.find((m) => m.id === id);
const findItem = (mid, iid) => (findMeeting(mid)?.items || []).find((i) => i.id === iid);
const meetingsOf = (c) => state.meetings.filter((m) => m.committee === c).sort((a, b) => (a.number || 99) - (b.number || 99) || (a.date || '').localeCompare(b.date || ''));
const pendingOf = (c) => meetingsOf(c).flatMap((m) => m.items.filter((i) => !isDone(i)).map((i) => ({ ...i, meeting: m })));
const meetingLabel = (m) => m.number ? `الاجتماع ${ORD[m.number] || m.number}` : (m.date ? fmtDate(m.date) : 'اجتماع');

function currentStage(now = Date.now()) {
  const st = [...state.stages].sort((a, b) => a.start.localeCompare(b.start));
  let cur = st.find((s) => startMs(s) <= now && now < endMs(s));
  if (!cur) cur = st.find((s) => startMs(s) > now) || st[st.length - 1];
  return { list: st, cur, idx: st.indexOf(cur) };
}

/* ---------------- router ---------------- */
const app = $('#app');
const VIEWS = ['minutes', 'launches', 'archive', 'ideas', 'workspace'];
const route = () => { const h = location.hash.replace('#', ''); return VIEWS.includes(h) ? h : 'dashboard'; };
function render() {
  const r = route();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r));
  app.innerHTML = { minutes: viewMinutes, launches: viewLaunches, archive: viewArchive, ideas: viewIdeas, workspace: viewWorkspace }[r]?.() ?? viewDashboard();
  hydratePhotos(app);
  if (r === 'dashboard') animateCounts();
  const on = $('.mcard.on'); if (on) on.parentElement.scrollLeft += on.getBoundingClientRect().left - on.parentElement.getBoundingClientRect().left - 8;
  tick();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ---------------- dashboard ---------------- */
function viewDashboard() {
  const { list: stages, cur, idx } = currentStage();
  const now = Date.now();
  const p = state.project;
  const all = state.meetings.flatMap((m) => m.items);
  const doneN = all.filter(isDone).length;
  const pend = { national: pendingOf('national'), ministry: pendingOf('ministry') };

  const track = stages.map((s, i) => {
    const st = s === cur && now >= startMs(s) ? 'now' : (endMs(s) <= now ? 'done' : 'next');
    return `<li class="ts ${st}">
      <span class="ts-bar"><i ${st === 'now' ? 'id="trackNow"' : ''}></i></span>
      <span class="ts-n">${st === 'done' ? ICON.check : i + 1}</span>
      <span class="ts-t">${esc(s.title || s.name)}</span>
      <span class="ts-d">${fmtMonths(s.start, s.end)}</span>
    </li>`;
  }).join('');

  const hero = cur ? `
    <div class="hero-main">
      <h2>${esc(cur.name)}</h2>
      <div class="hero-sub">${esc(cur.title || '')}</div>
      <div class="range">${fmtDate(cur.start)} — ${fmtDate(cur.end)}</div>
    </div>
    <div class="hero-count">
      <div class="cd-label" id="cdLabel"></div>
      <div class="countdown" id="countdown">
        ${['يوم', 'ساعة', 'دقيقة', 'ثانية'].map((l, i) => `<div class="cd-unit"><b data-cd="${i}">--</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="bar"><i id="stageBar" style="width:0"></i></div>
      <div class="bar-meta"><span></span><span>تنتهي ${fmtDate(cur.end)}</span></div>
    </div>
    <ol class="track" aria-label="مراحل المشروع">${track}</ol>
  ` : `<div class="hero-main"><h2>لم تُحدَّد مراحل المشروع بعد</h2><button class="btn sm" data-act="edit-stages">إضافة المراحل</button></div>`;

  const pendCard = (c) => {
    const list = pend[c];
    const groups = [];
    list.forEach((i) => { const g = groups.find((x) => x.m === i.meeting); g ? g.items.push(i) : groups.push({ m: i.meeting, items: [i] }); });
    groups.sort((a, b) => (b.m.number || 0) - (a.m.number || 0));
    return `<div class="card pend-card">
      <div class="card-h"><h2><span class="dot" style="--c:var(--c-${c})"></span>${COMMITTEES[c]} <span class="count">${list.length} معلّق</span></h2>
        <a class="link" href="#minutes" data-act="goto-committee" data-c="${c}">المحاضر ←</a></div>
      <div class="card-b pend-body">${groups.length ? groups.map((g) => `
        <div class="pend-group">
          <a class="pend-gh" href="#minutes" data-act="goto-meeting" data-c="${c}" data-mid="${g.m.id}">${esc(meetingLabel(g.m))}${g.m.date ? ` · ${fmtDate(g.m.date)}` : ''}<span>${g.items.length}</span></a>
          <ul class="list">${g.items.map((i) => `
            <li>
              <input type="checkbox" class="tick" data-act="toggle-item" data-mid="${g.m.id}" data-iid="${i.id}" aria-label="تم الإنجاز: ${esc(i.topic)}">
              <div class="li-main">
                <div class="li-title"><span class="pf-l">الموضوع:</span> ${bd(i.topic)}</div>
                ${i.directive ? `<div class="pf-dir"><span class="pf-l">التوجيه:</span> ${bd(i.directive)}</div>` : ''}
                ${i.owners ? `<div class="li-sub"><span class="pf-l">صاحب العلاقة:</span> ${bd(i.owners)}</div>` : ''}
              </div>
            </li>`).join('')}</ul>
        </div>`).join('') : `<div class="empty">${meetingsOf(c).some((m) => m.items.length) ? 'لا توجد بنود معلّقة.' : 'لم تُرفع محاضر بعد.'}</div>`}
      </div>
    </div>`;
  };

  return `
  <section class="hero">${hero}</section>
  ${agentPanel()}

  <section class="kpis">
    <div class="card kpi"><div class="l"><span class="dot" style="--c:var(--c-national)"></span>معلّق · اللجنة الوطنية</div><div class="v">${pend.national.length}</div><div class="s">${meetingsOf('national').filter((m) => m.items.length).length} محاضر مرفوعة</div></div>
    <div class="card kpi"><div class="l"><span class="dot" style="--c:var(--c-ministry)"></span>معلّق · لجنة الوزارة</div><div class="v">${pend.ministry.length}</div><div class="s">${meetingsOf('ministry').filter((m) => m.items.length).length} محاضر مرفوعة</div></div>
    <div class="card kpi"><div class="l">نسبة إنجاز التوجيهات</div><div class="v" style="color:var(--ok)">${all.length ? Math.round(doneN / all.length * 100) : 0}%</div><div class="s">${doneN} من ${all.length} بنداً من محاضر اجتماعات اللجنة الوطنية ولجنة الوزارة</div></div>
  </section>

  <h2 class="sec-h">بنود للمتابعة</h2>
  <section class="dash-cols">${pendCard('national')}${pendCard('ministry')}</section>

  ${launchesDashCard()}
  <section class="news-cols">
    ${newsCard('أخبار الذكاء الاصطناعي المساعد في الإمارات', 'UAE', news.uae)}
    ${newsCard('أخبار Agentic AI عالمياً', 'Global', news.global)}
  </section>
  <p class="section-note">تُحدَّث الأخبار تلقائياً يومياً الساعة 7:00 صباحاً بتوقيت الإمارات (أحدث 3 أخبار، وتبقى السابقة إن لم يوجد جديد)${news.updatedAt ? ` · آخر تحديث ${newsDate(news.updatedAt)}` : ''}.</p>
  `;
}

function launchesDashCard() {
  const L = state.launches || []; if (!L.length) return '';
  const done = L.filter((l) => l.status === 'announced').length;
  const next = L.filter((l) => l.status !== 'announced').sort((a, b) => (a.date || (a.month ? a.month + '-31' : '9999')).localeCompare(b.date || (b.month ? b.month + '-31' : '9999'))).slice(0, 5);
  return `<section class="card l-dash">
    <div class="card-h"><h2>الإطلاقات والإعلانات <span class="count">${done} من ${L.length} أُعلن</span></h2><a class="link" href="#launches">كل الإطلاقات ←</a></div>
    <div class="card-b"><div class="bar"><i style="width:${done / L.length * 100}%"></i></div>
      <ul class="list">${next.map((l) => `<li><span class="lpill ls-${l.status}">${LSTN[l.status]}</span><div class="li-main"><div class="li-title">${bd(l.title)}</div><div class="li-sub">${lWhen(l)}${l.note ? ' · ' + bd(l.note) : ''}</div></div>${isOverdue(l) ? '<span class="chip late-chip">متأخر</span>' : ''}</li>`).join('')}</ul>
    </div></section>`;
}

function newsCard(title, tag, list = []) {
  return `<div class="card">
    <div class="card-h"><h2>${title}</h2><span class="chip">${tag}</span></div>
    <div class="card-b">${list.length ? `<ul class="list">${list.slice(0, 3).map((n, i) => `
      <li><span class="news-n">${i + 1}</span>
        <a class="news-item li-main" href="${esc(n.link)}" target="_blank" rel="noopener">
          <div class="li-title" dir="auto">${esc(n.title)}</div>
          <div class="li-sub">${esc(n.source || '')}${n.date ? ' · ' + newsDate(n.date) : ''}</div>
        </a></li>`).join('')}</ul>` : '<div class="empty">لا توجد أخبار بعد. ستظهر بعد أول تحديث تلقائي.</div>'}
    </div></div>`;
}
function newsDate(s) {
  if (/^\d{4}-\d{2}$/.test(s)) return fmtYM(s + '-01');
  const d = new Date(s); if (isNaN(d)) return '';
  return fmtDate(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d));
}

/* countdown */
function tick() {
  const el = $('#countdown'); if (!el) return;
  const { cur } = currentStage(); if (!cur) return;
  const now = Date.now();
  const start = startMs(cur), end = endMs(cur);
  const before = now < start;
  const ms = Math.max(0, (before ? start : end) - now);
  const parts = [Math.floor(ms / 864e5), Math.floor(ms / 36e5) % 24, Math.floor(ms / 6e4) % 60, Math.floor(ms / 1e3) % 60];
  el.querySelectorAll('[data-cd]').forEach((b) => b.textContent = parts[b.dataset.cd]);
  $('#cdLabel').textContent = before ? `متبقٍّ على بدء ${cur.name}` : (ms ? `متبقٍّ على نهاية ${cur.name}` : `انتهت ${cur.name}`);
  const pct = before ? 0 : Math.min(100, (now - start) / (end - start) * 100);
  $('#stageBar').style.width = pct + '%';
  const tn = $('#trackNow'); if (tn) tn.style.width = pct + '%';

}
setInterval(tick, 1000);

/* ---------------- minutes ---------------- */
function viewMinutes() {
  const c = ui.committee;
  const list = meetingsOf(c);
  let sel = findMeeting(ui.meeting[c]);
  if (!sel || sel.committee !== c) sel = [...list].reverse().find((m) => m.items.length) || list[list.length - 1];

  const head = `
  <div class="page-head">
    <div><h1>محاضر الاجتماعات</h1><p>اختر الاجتماع ثم ضع علامة على كل توجيه تم إنجازه.</p></div>
    <div class="head-actions">
      <label class="btn primary" for="docxInput" data-act="target-meeting" data-mid="">${ICON.upload} رفع محضر (Word)</label>
      <input type="file" id="docxInput" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple hidden>
    </div>
  </div>
  <div class="subtabs" role="tablist">${Object.entries(COMMITTEES).map(([k, v]) => `<button role="tab" aria-selected="${k === c}" class="${k === c ? 'on' : ''}" data-act="committee" data-c="${k}"><span class="dot" style="--c:var(--c-${k})"></span>${v}<span class="count">${pendingOf(k).length} معلّق</span></button>`).join('')}</div>`;

  const strip = `<div class="mstrip">${list.map((m) => {
    const n = m.items.length, d = m.items.filter(isDone).length;
    return `<button class="mcard ${m === sel ? 'on' : ''} ${n ? '' : 'empty-m'}" data-act="pick-meeting" data-mid="${m.id}">
      <span class="mc-n">${m.number || '–'}</span>
      <span class="mc-t">${esc(meetingLabel(m))}</span>
      <span class="mc-d">${m.date ? fmtDate(m.date) : 'بدون تاريخ'}</span>
      ${n ? `<span class="mc-p"><span class="bar"><i style="width:${Math.round(d / n * 100)}%"></i></span><span>${d}/${n}</span></span>` : '<span class="mc-w">بانتظار المحضر</span>'}
    </button>`;
  }).join('')}
    <button class="mcard add" data-act="add-meeting">+ اجتماع</button>
  </div>`;

  if (!sel) return head + strip + `<div class="card empty" style="padding:48px 20px">لا توجد اجتماعات لـ${COMMITTEES[c]} بعد. ارفع محضراً أو أضف اجتماعاً.</div>`;

  const items = sel.items;
  const done = items.filter(isDone).length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => ui.showDone || !isDone(it));

  const body = !items.length ? `
    <div class="await">
      ${ICON.doc}
      <p>لم يُرفع محضر هذا الاجتماع بعد.</p>
      <label class="btn primary" for="docxInput" data-act="target-meeting" data-mid="${sel.id}">${ICON.upload} رفع المحضر</label>
      <button class="link" data-act="add-item" data-mid="${sel.id}">أو أضف التوجيهات يدوياً</button>
    </div>` : `
    <div class="ml-tools">
      <div class="seg" role="group" aria-label="عرض">
        <button class="${ui.showDone ? '' : 'on'}" data-act="show-done" data-v="0">المعلّق (${items.length - done})</button>
        <button class="${ui.showDone ? 'on' : ''}" data-act="show-done" data-v="1">الكل (${items.length})</button>
      </div>
    </div>
    <ul class="checklist">${shown.length ? shown.map(({ it, i }) => `
      <li class="ck ${isDone(it) ? 'is-done' : ''}">
        <input type="checkbox" class="tick" id="ck-${it.id}" ${isDone(it) ? 'checked' : ''} data-act="toggle-item" data-mid="${sel.id}" data-iid="${it.id}">
        <label class="ck-body" for="ck-${it.id}">
          <span class="ck-topic"><span class="ck-n">${i + 1}</span>${esc(it.topic)}</span>
          <span class="ck-dir">${esc(it.directive)}</span>
          <span class="ck-meta">${it.owners ? `<span>${esc(it.owners)}</span>` : ''}${isDone(it) && it.doneDate ? `<span class="ck-donedate">أُنجز ${fmtDate(it.doneDate)}</span>` : ''}</span>
          ${it.note ? `<span class="ck-note">${ICON.note}${esc(it.note)}</span>` : ''}
        </label>
        <button class="icon-btn sm" data-act="edit-item" data-mid="${sel.id}" data-iid="${it.id}" aria-label="تعديل البند">${ICON.edit}</button>
      </li>`).join('') : `<li class="empty">تم إنجاز جميع توجيهات هذا الاجتماع.</li>`}
    </ul>`;

  return head + strip + `
  <article class="card meeting">
    <header class="meeting-h">
      <div class="mh-main">
        <h2>${esc(sel.title || meetingLabel(sel))}</h2>
        <div class="meta">${sel.date ? `${dowOf(sel.date)} ${fmtDate(sel.date)}` : ''}${sel.time ? ` · ${esc(sel.time)}` : ''}</div>
        ${sel.remark ? `<p class="m-remark">${esc(sel.remark)}</p>` : ''}
        ${sel.attendees ? `<details class="att"><summary>الحضور</summary><p>${esc(sel.attendees)}</p></details>` : ''}
      </div>
      ${items.length ? `<div class="prog">
        <div class="prog-n"><b class="num">${done}</b> من ${items.length} منجز</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>` : ''}
    </header>
    ${body}
    <footer class="meeting-f">
      ${items.length ? `<button class="link" data-act="add-item" data-mid="${sel.id}">+ إضافة توجيه</button>` : ''}
      <button class="link muted" data-act="edit-meeting" data-mid="${sel.id}">تعديل بيانات الاجتماع</button>
    </footer>
  </article>`;
}

/* ---------------- Word (.docx) minutes import ---------------- */
let importTarget = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = JSZIP_URL; s.onload = () => res(window.JSZip); s.onerror = () => rej(new Error('jszip'));
    document.head.appendChild(s);
  });
}
const AR_DIGITS = (s) => s.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const MONTH_RX = [['يناير'], ['فبراير'], ['مارس'], ['أبريل', 'ابريل', 'إبريل'], ['مايو'], ['يونيو'], ['يوليو'], ['أغسطس', 'اغسطس'], ['سبتمبر'], ['أكتوبر', 'اكتوبر'], ['نوفمبر'], ['ديسمبر']];
function parseArDate(s) {
  s = AR_DIGITS(s);
  for (let i = 0; i < 12; i++) for (const name of MONTH_RX[i]) {
    const m = s.match(new RegExp(`(\\d{1,2})\\s*${name}\\s*،?\\s*(\\d{4})`));
    if (m) return `${m[2]}-${pad(i + 1)}-${pad(+m[1])}`;
  }
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : '';
}
function parseOrdinal(s) {
  s = AR_DIGITS(s);
  const d = s.match(/(?:الاجتماع|اجتماع)\s*\(?\s*(\d{1,2})/) || s.match(/\(\s*(\d{1,2})\s*\)/);
  if (d) return +d[1];
  for (let n = ORD.length - 1; n > 0; n--) if (s.includes(ORD[n]) || s.includes(ORD[n].replace(/^ال/, ''))) return n;
  return null;
}
async function parseDocx(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const ptext = (p) => [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('');
  const text = (el) => (el.localName === 'p' ? [el] : [...el.getElementsByTagNameNS(W, 'p')]).map(ptext).join(' ').replace(/\s+/g, ' ').trim();
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const paras = [];
  const rows = [];
  for (const el of body.children) {
    if (el.localName === 'p') { const t = text(el); if (t) paras.push(t); }
    if (el.localName === 'tbl') {
      for (const tr of el.getElementsByTagNameNS(W, 'tr')) rows.push([...tr.children].filter((c) => c.localName === 'tc').map(text));
    }
  }
  const find = (rx) => { const p = paras.find((x) => rx.test(x)); return p ? p.replace(rx, '').replace(/^[\s:：]+/, '').trim() : ''; };
  const title = paras.find((x) => /محضر|الاجتماع|اجتماع/.test(x)) || file.name.replace(/\.docx$/i, '');
  const dateLine = paras.find((x) => /التاريخ/.test(x)) || paras.join(' ');
  // locate columns from the header row
  let hi = rows.findIndex((r) => r.some((c) => /الموضوع|التوجيه/.test(c)));
  const hdr = hi >= 0 ? rows[hi] : [];
  const col = (rx, fb) => { const i = hdr.findIndex((c) => rx.test(c)); return i >= 0 ? i : fb; };
  const cT = col(/الموضوع|البند/, 1), cD = col(/التوجيه|القرار|الإجراء/, 2), cO = col(/أصحاب|المسؤول|الجهة/, 3);
  const items = rows.slice(hi + 1)
    .filter((r) => r.length >= 2 && (r[cT] || r[cD]))
    .map((r) => ({ id: uid('i'), topic: r[cT] || r[cD].slice(0, 60), directive: r[cD] || '', owners: r[cO] || '', status: 'pending' }));
  const committee = /الوزارة/.test(title) && !/الوطنية/.test(title) ? 'ministry' : /الوطنية/.test(title) ? 'national' : ui.committee;
  return {
    file: file.name, committee, title: title.replace(/^محضر\s*/, '').trim(),
    number: parseOrdinal(title), date: parseArDate(dateLine),
    time: find(/^.*?التوقيت\s*/), attendees: find(/^.*?الحضور\s*/), items,
  };
}

async function importFiles(files) {
  if (!files.length) return;
  toast('جارٍ قراءة الملفات…');
  const results = [];
  for (const f of files) {
    try { results.push(await parseDocx(f)); }
    catch (e) { console.error(e); results.push({ file: f.name, error: e.message === 'jszip' ? 'تعذّر تحميل قارئ ملفات Word (تحقق من الاتصال بالإنترنت).' : 'تعذّرت قراءة الملف. تأكد أنه بصيغة .docx.' }); }
  }
  const tgt = importTarget ? findMeeting(importTarget) : null;
  if (tgt && results.length === 1 && !results[0].error) { results[0].committee = tgt.committee; results[0].number = tgt.number; results[0].date ||= tgt.date; }
  importTarget = null;
  reviewImport(results);
}

const defaultTitle = (committee, number) => `الاجتماع (${ORD[number] || number || ''}) ${committee === 'national' ? 'للجنة الوطنية للذكاء الاصطناعي المساعد' : 'للجنة الذكاء الاصطناعي المساعد في وزارة شؤون مجلس الوزراء'}`.replace(/\s+/g, ' ');

// Add a meeting's minutes to the tracker, or replace the directives of the same
// committee + meeting number while keeping ticks and notes on matching topics.
function upsertMeeting({ committee, number, title, date, time, attendees, items }) {
  let m = state.meetings.find((x) => x.committee === committee && number && x.number === number);
  title = title && title.length < 120 ? title : defaultTitle(committee, number);
  const isNew = !m;
  if (m) {
    const prev = new Map(m.items.map((i) => [i.topic.trim(), i]));
    items.forEach((i) => { const o = prev.get(i.topic.trim()); if (o && isDone(o)) { i.status = 'done'; i.doneDate = o.doneDate; } if (o && o.note) i.note = o.note; });
    Object.assign(m, { title, items });
    if (date) m.date = date; if (time) m.time = time; if (attendees) m.attendees = attendees;
  } else {
    m = { id: uid('m'), committee, number, title, date, time, attendees, items };
    state.meetings.push(m);
  }
  ui.committee = committee; ui.meeting[committee] = m.id;
  return { m, isNew };
}

function reviewImport(results) {
  const ok = results.filter((r) => !r.error);
  const rowsHtml = results.map((r, k) => r.error ? `
    <div class="imp-row err"><b>${esc(r.file)}</b><span>${esc(r.error)}</span></div>` : `
    <div class="imp-row" data-k="${k}">
      <div class="imp-file">${ICON.doc}<b>${esc(r.file)}</b><span class="chip ${r.items.length ? 'gold' : ''}">${r.items.length} توجيهاً</span></div>
      <div class="imp-fields">
        ${field('اللجنة', sel(`c${k}`, COMMITTEES, r.committee))}
        ${field('رقم الاجتماع', inp(`n${k}`, r.number || '', 'type="number" min="1" required'))}
        ${field('التاريخ', inp(`d${k}`, r.date || '', 'type="date"'))}
      </div>
      ${r.items.length ? `<details class="imp-prev"><summary>معاينة التوجيهات</summary><ol>${r.items.map((i) => `<li><b>${esc(i.topic)}</b> — ${esc(i.directive.slice(0, 120))}${i.directive.length > 120 ? '…' : ''}</li>`).join('')}</ol></details>` : '<small class="warn-t">لم يُعثر على جدول توجيهات في هذا الملف.</small>'}
    </div>`).join('');
  openModal({
    title: `رفع المحاضر (${ok.length})`,
    body: `<div class="hint">تحقّق من اللجنة ورقم الاجتماع لكل ملف. إذا كان الاجتماع موجوداً، تُستبدل توجيهاته مع الإبقاء على علامات الإنجاز للبنود المطابقة.</div>${rowsHtml}`,
    submit: ok.length ? 'حفظ المحاضر' : null,
    onSave(d) {
      let added = 0, updated = 0;
      results.forEach((r, k) => {
        if (r.error) return;
        const { isNew } = upsertMeeting({ ...r, committee: d[`c${k}`], number: Number(d[`n${k}`]) || null, date: d[`d${k}`] || '' });
        isNew ? added++ : updated++;
      });
      saveUI();
      if (route() !== 'minutes') location.hash = '#minutes';
      commit(`تم حفظ المحاضر: ${added} جديد، ${updated} محدَّث`);
    },
  });
}

/* ---------------- workspace: AI-assisted drafting ---------------- */
// Engine: inside claude.ai the page asks Claude through the viewer's own plan
// (`sample` capability). Anywhere else (e.g. localhost) it uses the Anthropic SDK
// with an API key the user stores in settings on that device.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const LS_KEY = 'aai.apikey.v1';
const LS_DRAFT = 'aai.ws.draft.v1';
const COMMITTEE_FULL = { national: 'اللجنة الوطنية للذكاء الاصطناعي المساعد', ministry: 'لجنة الذكاء الاصطناعي المساعد في وزارة شؤون مجلس الوزراء' };
const TASKS = [
  { id: 'minutes', icon: 'doc', t: 'إصدار محضر اجتماع', d: 'من ملاحظاتك المكتوبة أو صورها إلى محضر رسمي بقالب اللجنة' },
  { id: 'committee', icon: 'deck', t: 'عرض اجتماع اللجنة الوطنية', d: 'العرض المعتمد لكل اجتماع: الأجندة، تقويم الإطلاقات، الأرقام والنقاط' },
  { id: 'news', icon: 'news', t: 'صياغة خبر صحفي', d: 'خبر إطلاق بأسلوب الإعلام الحكومي', soon: true },
  { id: 'brief', icon: 'brief', t: 'ملخص تنفيذي', d: 'موجز للقيادات عن مستجدات المشروع', soon: true },
];
Object.assign(ICON, {
  mic: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
  mail: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  speaker: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  bulb: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  deck: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>',
  news: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5"/></svg>',
  brief: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  spark: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  chev: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  image: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  gear: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
});

const ws = Object.assign({ task: null, menu: false, committee: 'national', number: '', date: '', time: '', attendees: '', notes: '' }, ls.get(LS_DRAFT) || {}, { menu: false, images: [], status: 'idle', progress: '', result: null, error: '', ctl: null });
const saveDraft = () => ls.set(LS_DRAFT, { task: ws.task, committee: ws.committee, number: ws.number, date: ws.date, time: ws.time, attendees: ws.attendees, notes: ws.notes });
const cap = { sample: null, sampleImages: false, downloads: null, assets: null, dictation: null, tts: null, ready: false };

function initCapabilities() {
  if (!window.claude || typeof window.claude.use !== 'function') { cap.ready = true; return; }
  window.claude.use('sample').then((s) => {
    cap.sample = s;
    if (s) s.limits().then((l) => { cap.sampleImages = !!(l && l.images); if (state && route() === 'workspace') render(); }).catch(() => {});
  }).catch(() => {}).finally(() => { cap.ready = true; if (state && route() !== 'minutes') render(); });
  window.claude.use('downloads').then((d) => { cap.downloads = d; }).catch(() => {});
  window.claude.use('assets').then((a) => { cap.assets = a; }).catch(() => {});
  window.claude.use('dictation').then((d) => { cap.dictation = d; if (d) wireDictation(d); if (state && route() === 'dashboard') render(); }).catch(() => {});
  window.claude.use('tts').then((t) => { cap.tts = t; }).catch(() => {});
}
const engine = () => cap.sample ? 'claude' : (ls.get(LS_KEY) ? 'api' : null);

// seed meeting fields for the chosen committee from the tracker
function seedMeetingFields(force) {
  const list = meetingsOf(ws.committee);
  const last = [...list].reverse().find((m) => m.attendees) || list[list.length - 1];
  const nextNum = list.reduce((n, m) => Math.max(n, m.items.length ? m.number || 0 : 0), 0) + 1;
  if (force || !ws.number) ws.number = String(nextNum);
  if (force || !ws.date) ws.date = todayStr();
  if (force || !ws.attendees) ws.attendees = last && last.attendees || '';
}

function viewWorkspace() {
  const task = TASKS.find((t) => t.id === ws.task);
  if (task && !ws.number) seedMeetingFields(false);
  const eng = engine();
  const picker = `
  <div class="picker ${ws.menu ? 'open' : ''}">
    <button class="picker-btn" data-act="ws-menu" aria-haspopup="listbox" aria-expanded="${ws.menu}">
      <span class="picker-ico">${task ? ICON[task.icon] : ICON.spark}</span>
      <span class="picker-txt"><b>${task ? task.t : 'ماذا تريد أن تُنجز اليوم؟'}</b><small>${task ? task.d : 'اختر مهمة ليساعدك Claude في إعدادها'}</small></span>
      <span class="picker-chev">${ICON.chev}</span>
    </button>
    ${ws.menu ? `<ul class="picker-menu" role="listbox">${TASKS.map((t) => `
      <li role="option" aria-selected="${t.id === ws.task}" aria-disabled="${!!t.soon}">
        <button class="pm-item ${t.id === ws.task ? 'on' : ''}" data-act="ws-task" data-t="${t.id}" ${t.soon ? 'disabled' : ''}>
          <span class="pm-ico">${ICON[t.icon]}</span>
          <span class="pm-txt"><b>${t.t}</b><small>${t.d}</small></span>
          ${t.soon ? '<span class="chip">قريباً</span>' : ''}
        </button>
      </li>`).join('')}</ul>` : ''}
  </div>`;

  const head = `
  <div class="ws-head">
    <div>
      <h1>مساحة العمل</h1>
      <p>أعمالنا المتكررة بمساعدة Claude: اختر المهمة، أعطه ملاحظاتك، واحصل على المخرج بقالبنا المعتمد.</p>
    </div>
    <div class="ws-head-side">
      <span class="engine ${eng ? 'on' : ''}" title="${eng === 'claude' ? 'يستخدم حسابك في Claude' : eng === 'api' ? 'يستخدم مفتاح Claude API المحفوظ على هذا الجهاز' : ''}">${eng === 'claude' ? 'متصل بـ Claude' : eng === 'api' ? 'متصل عبر Claude API' : cap.ready ? 'Claude غير متصل' : 'جارٍ الاتصال…'}</span>
      <button class="btn sm" data-act="ws-templates">${ICON.gear} القوالب والتعليمات</button>
    </div>
  </div>`;

  if (!task) return head + picker + `<div class="ws-empty">${ICON.spark}<p>اختر مهمة من القائمة أعلاه للبدء.</p></div>`;
  return head + picker + (task.id === 'committee' ? viewDeckTask(eng) : viewMinutesTask(eng));
}

function viewMinutesTask(eng) {
  const busy = ws.status === 'running';
  const imgOK = eng === 'api' || (eng === 'claude' && cap.sampleImages);
  const form = `
  <section class="ws-form card">
    <div class="ws-step"><span class="sn">1</span><h3>اللجنة</h3></div>
    <div class="cpick" role="radiogroup">${Object.entries(COMMITTEES).map(([k, v]) => `
      <button role="radio" aria-checked="${ws.committee === k}" class="cp ${ws.committee === k ? 'on' : ''}" data-act="ws-committee" data-c="${k}" style="--c:var(--c-${k})">
        <span class="dot"></span><b>${v}</b><small>${meetingsOf(k).filter((m) => m.items.length).length} محاضر سابقة</small>
      </button>`).join('')}
    </div>

    <div class="ws-step"><span class="sn">2</span><h3>بيانات الاجتماع</h3></div>
    <div class="ws-fields">
      <div class="field"><label for="ws-number">رقم الاجتماع</label><input id="ws-number" data-ws="number" type="number" min="1" value="${esc(ws.number)}"></div>
      <div class="field"><label for="ws-date">التاريخ</label><input id="ws-date" data-ws="date" type="date" value="${esc(ws.date)}"></div>
      <div class="field"><label for="ws-time">التوقيت</label><input id="ws-time" data-ws="time" placeholder="مثال: الساعة 1:30 ظهرًا" value="${esc(ws.time)}"></div>
    </div>
    <div class="field"><label for="ws-att">الحضور</label><textarea id="ws-att" data-ws="attendees" rows="3" placeholder="الأسماء مفصولة بفواصل">${esc(ws.attendees)}</textarea><small>مأخوذة من آخر محضر لهذه اللجنة. عدّلها حسب حضور هذا الاجتماع.</small></div>

    <div class="ws-step"><span class="sn">3</span><h3>الملاحظات</h3></div>
    <div class="field"><label for="ws-notes" class="sr">الملاحظات</label><textarea id="ws-notes" data-ws="notes" rows="8" placeholder="اكتب ملاحظات الاجتماع كما دوّنتها: المواضيع، التوجيهات، والمسؤولين…">${esc(ws.notes)}</textarea></div>
    ${imgOK ? `
    <label class="dropzone" for="ws-img" data-drop>
      ${ICON.image}<span><b>أضف صور الملاحظات</b> أو اسحبها هنا</span><small>JPG أو PNG · حتى 10 صور</small>
    </label>
    <input type="file" id="ws-img" accept="image/jpeg,image/png,image/webp" multiple hidden>
    ${ws.images.length ? `<div class="thumbs">${ws.images.map((im, i) => `<figure><img src="${im.url}" alt="صورة ${i + 1}"><button class="x" data-act="ws-rmimg" data-i="${i}" aria-label="إزالة الصورة">✕</button></figure>`).join('')}</div>` : ''}`
      : eng === 'claude' ? '<small class="muted-t">رفع الصور غير متاح في هذا العرض؛ اكتب الملاحظات نصاً.</small>' : ''}

    <div class="ws-go">
      ${busy ? `<button class="btn" data-act="ws-stop">إيقاف</button>` : ''}
      <button class="btn primary gen" data-act="ws-generate" ${busy || !eng ? 'disabled' : ''}>${ICON.spark} ${busy ? 'جارٍ إعداد المحضر…' : ws.result ? 'إعادة الإنشاء' : 'إنشاء المحضر'}</button>
    </div>
    ${!eng && cap.ready ? `<div class="hint">لإنشاء المحاضر من هذه النسخة، أضف مفتاح Claude API من <button class="link" data-act="open-settings">الإعدادات</button>، أو افتح اللوحة من رابطها على claude.ai لاستخدام حسابك في Claude مباشرة.</div>` : ''}
  </section>`;
  return `<div class="ws-grid">${form}<section class="ws-out">${viewMinutesOutput()}</section></div>`;
}

function minutesTitle() { return `محضر الاجتماع (${ORD[+ws.number] || ws.number || '…'}) ${ws.committee === 'national' ? 'للجنة الوطنية للذكاء الاصطناعي المساعد' : 'للجنة الذكاء الاصطناعي المساعد في وزارة شؤون مجلس الوزراء'}`; }
function minutesDateText(r) { return ws.date ? `${dowOf(ws.date)}، ${fmtDate(ws.date)}` : (r && r.date_text) || ''; }

function viewMinutesOutput() {
  if (ws.status === 'running') {
    const n = (ws.progress.match(/"topic"/g) || []).length;
    return `<div class="card out-card thinking">
      <div class="think-h">${ICON.spark}<b>${ws.progress ? `يكتب Claude المحضر… ${n ? `${n} توجيهات حتى الآن` : ''}` : 'يقرأ Claude ملاحظاتك…'}</b></div>
      <div class="skel"><i></i><i></i><i></i><i></i><i></i></div>
    </div>`;
  }
  if (ws.status === 'error') return `<div class="card out-card"><div class="err-box"><b>تعذّر إنشاء المحضر</b><p>${esc(ws.error)}</p>
    ${ws.errorDetail ? `<details open><summary>تفاصيل تقنية</summary><code dir="ltr">${esc(ws.errorDetail)}</code></details>` : ''}
    <p class="err-src">المحرّك: ${engine() === 'claude' ? 'حسابك في Claude (claude.ai)' : engine() === 'api' ? 'Claude API (مفتاح محفوظ على هذا الجهاز)' : 'غير متصل'}</p></div></div>`;
  const r = ws.result;
  if (!r) return `<div class="out-empty">${ICON.doc}<p>سيظهر المحضر هنا بقالب ${COMMITTEES[ws.committee]}، وتستطيع تعديل أي خانة قبل التنزيل.</p></div>`;
  return `
  <div class="out-actions">
    <button class="btn primary" data-act="ws-download">تنزيل Word</button>
    <button class="btn" data-act="ws-save">حفظ في محاضر الاجتماعات</button>
    <button class="btn" data-act="ws-copy">نسخ النص</button>
  </div>
  ${r.remarks ? `<div class="hint">ملاحظة من Claude: ${esc(r.remarks)}</div>` : ''}
  <article class="paper" aria-label="معاينة المحضر">
    <p class="pp-secret">سري</p>
    <h2 contenteditable="true" data-ed="title">${esc(r.title || minutesTitle())}</h2>
    <p><b>التاريخ:</b> <span contenteditable="true" data-ed="date_text">${esc(r.date_text || minutesDateText(r))}</span></p>
    <p><b>التوقيت:</b> <span contenteditable="true" data-ed="time_text">${esc(r.time_text || ws.time)}</span></p>
    <p><b>الحضور:</b> <span contenteditable="true" data-ed="attendees">${esc(r.attendees || ws.attendees)}</span></p>
    <div class="pp-scroll"><table>
      <thead><tr><th>#</th><th>الموضوع</th><th>التوجيه</th><th>أصحاب العلاقة</th></tr></thead>
      <tbody>${r.items.map((it, i) => `<tr>
        <td>${i + 1}</td>
        <td contenteditable="true" data-ed="items.${i}.topic">${esc(it.topic)}</td>
        <td contenteditable="true" data-ed="items.${i}.directive">${esc(it.directive)}</td>
        <td contenteditable="true" data-ed="items.${i}.owners">${esc(it.owners)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </article>
  <small class="muted-t">اضغط على أي نص في المعاينة لتعديله. التعديلات تدخل في ملف Word وفي الحفظ.</small>`;
}

function buildMinutesPrompt() {
  const c = ws.committee;
  const ex = [...meetingsOf(c)].reverse().find((m) => m.items.length) || [...meetingsOf('national')].reverse().find((m) => m.items.length);
  const example = ex ? ex.items.slice(0, 6).map((i) => ({ topic: i.topic, directive: i.directive, owners: i.owners })) : [];
  const extra = (ls.get('aai.instr.' + c) || '').trim();
  return `You are drafting the official minutes (محضر اجتماع) of a UAE federal government committee meeting for the "Agentic AI for UAE Government" project (مشروع الذكاء الاصطناعي المساعد).

Committee: ${COMMITTEE_FULL[c]}
Meeting: الاجتماع (${ORD[+ws.number] || ws.number})
Date: ${minutesDateText()}
Time: ${ws.time || '(not given)'}
Attendees: ${ws.attendees || '(not given)'}

Source material: the secretary's raw notes below${ws.images.length ? ` and ${ws.images.length} attached photo(s) of the handwritten or printed notes. Read every photo carefully` : ''}. Turn them into formal minutes in Modern Standard Arabic, in the same tone and structure as this committee's previous minutes.

How to write each row (one row per directive / توجيه discussed):
- topic (الموضوع): a short heading of 2 to 7 words.
- directive (التوجيه): one or two formal sentences, typically opening with phrases such as «التأكيد على», «العمل على», «دراسة», «التنسيق مع», «عرض».
- owners (أصحاب العلاقة): the responsible people or entities, with honorifics exactly as written in the attendee list (معالي / سعادة / د.), joined with « + ». Use «أعضاء اللجنة» when the notes assign it to the whole committee.

Use only what the notes support: do not invent directives, names, numbers or dates. If a word in the notes is illegible or ambiguous, write [غير واضح] in its place rather than guessing. Keep English terms that appear in the notes (for example FedAI, Cybersecurity) as written. Keep the order in which topics appear in the notes.
${example.length ? `\nStyle reference: rows from this committee's previous minutes (for tone and format only, not content):\n${JSON.stringify(example, null, 1)}\n` : ''}${extra ? `\nAdditional instructions from the team:\n${extra}\n` : ''}
Notes:
<<<
${ws.notes.trim() || '(no typed notes; use the photos)'}
>>>

Reply with only one JSON object, no other text:
{"items":[{"topic":"…","directive":"…","owners":"…"}],"attendees":"attendee list if the notes give one and the Attendees above is not given, else empty","date_text":"","time_text":"time if the notes give one and Time above is not given, else empty","remarks":"one short Arabic sentence about anything unclear in the notes, or empty"}`;
}

function parseJSONLoose(text) {
  try { return JSON.parse(text); } catch {}
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

async function imageToBase64(file) {
  // downscale large phone photos before sending
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.88);
  return url.slice(url.indexOf(',') + 1);
}

async function runWithSDK(prompt, signal, onProgress) {
  let Anthropic;
  try { ({ default: Anthropic } = await import(SDK_URL)); }
  catch (e) { throw { userMsg: 'تعذّر تحميل مكتبة Claude من الإنترنت (cdn.jsdelivr.net). تحقق من الاتصال أو من حظر الشبكة لهذا الموقع.', detail: String(e && e.message || e) }; }
  const client = new Anthropic({ apiKey: ls.get(LS_KEY), dangerouslyAllowBrowser: true });
  const content = [];
  for (const im of ws.images) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await imageToBase64(im.file) } });
  content.push({ type: 'text', text: prompt });
  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    }, { signal });
    stream.on('text', (_delta, snapshot) => onProgress(snapshot));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw { userMsg: 'اعتذر Claude عن معالجة هذه الملاحظات. راجع المحتوى وحاول مرة أخرى.' };
    if (msg.stop_reason === 'max_tokens') throw { userMsg: 'الملاحظات طويلة جداً لمحضر واحد. قسّمها وحاول مرة أخرى.' };
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  } catch (e) {
    if (e && e.userMsg) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw { cancelled: true };
    const detail = e instanceof Anthropic.APIError ? `${e.status || ''} ${(e.error && e.error.error && e.error.error.message) || e.message}`.trim() : String(e && e.message || e);
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(detail)) throw { userMsg: 'رصيد حساب Claude API غير كافٍ. أضف رصيداً من console.anthropic.com ثم Billing.', detail };
    if (e instanceof Anthropic.AuthenticationError) throw { userMsg: 'مفتاح Claude API غير صالح. حدّثه من الإعدادات.', detail };
    if (e instanceof Anthropic.PermissionDeniedError) throw { userMsg: 'مفتاح API لا يملك صلاحية استخدام هذا النموذج.', detail };
    if (e instanceof Anthropic.RateLimitError) throw { userMsg: 'تم تجاوز حد الاستخدام مؤقتاً. حاول بعد دقيقة.', detail };
    if (e instanceof Anthropic.BadRequestError) throw { userMsg: 'رفضت خدمة Claude الطلب. التفاصيل أدناه.', detail };
    if (e instanceof Anthropic.APIConnectionError) throw { userMsg: 'تعذّر الاتصال بـ Claude. تحقق من الإنترنت.', detail };
    if (e instanceof Anthropic.APIError) throw { userMsg: `خطأ من خدمة Claude (${e.status}). حاول مرة أخرى.`, detail };
    throw { userMsg: 'حدث خطأ غير متوقع أثناء الاتصال بـ Claude.', detail };
  }
}

async function runWithSample(prompt, signal, onProgress) {
  try {
    const { text, truncated } = await cap.sample(prompt, {
      signal, cache: false,
      images: ws.images.length ? ws.images.map((im) => im.file) : undefined,
      onText: ({ text }) => onProgress(text),
    });
    if (truncated) throw { userMsg: 'الملاحظات طويلة جداً لمحضر واحد. قسّمها وحاول مرة أخرى.' };
    return text;
  } catch (e) {
    if (e && e.userMsg) throw e;
    const code = e && e.code;
    if (code === 'cancelled') throw { cancelled: true };
    const msg = {
      not_granted: 'لم يُسمح لهذه الصفحة باستخدام Claude. أعد تحميل الصفحة واختر «السماح».',
      sampling_disabled: 'Claude غير متاح لهذا الحساب.',
      rate_limited: 'تم بلوغ حد الاستخدام مؤقتاً. حاول لاحقاً.',
      image_rejected: 'تعذّرت قراءة إحدى الصور. استخدم JPG أو PNG بحجم أصغر.',
      images_unavailable: 'رفع الصور غير متاح في هذا العرض. اكتب الملاحظات نصاً.',
      refused: 'اعتذر Claude عن معالجة هذه الملاحظات. راجع المحتوى وحاول مرة أخرى.',
      prompt_too_large: 'الملاحظات طويلة جداً. قسّمها وحاول مرة أخرى.',
      session_expired: 'انتهت الجلسة. سجّل الدخول إلى claude.ai مرة أخرى.',
    }[code];
    throw { userMsg: msg || 'تعذّر الاتصال بـ Claude. حاول مرة أخرى.', detail: `${code || 'unknown'}: ${(e && e.message) || ''}` };
  }
}

async function generateMinutes() {
  if (!ws.notes.trim() && !ws.images.length) { toast('اكتب الملاحظات أو أضف صورها أولاً'); return; }
  const eng = engine(); if (!eng) return;
  ws.ctl = new AbortController();
  ws.status = 'running'; ws.progress = ''; ws.error = ''; ws.result = null;
  render();
  let last = 0;
  const onProgress = (text) => { ws.progress = text; const now = Date.now(); if (now - last > 400 && route() === 'workspace') { last = now; const o = $('.ws-out'); if (o) o.innerHTML = viewMinutesOutput(); } };
  try {
    const prompt = buildMinutesPrompt();
    const text = eng === 'claude' ? await runWithSample(prompt, ws.ctl.signal, onProgress) : await runWithSDK(prompt, ws.ctl.signal, onProgress);
    const data = parseJSONLoose(text);
    if (!data || !Array.isArray(data.items) || !data.items.length) throw { userMsg: 'لم يُرجع Claude محضراً صالحاً. حاول مرة أخرى أو وضّح الملاحظات.', detail: text.slice(0, 600) };
    ws.result = {
      title: minutesTitle(),
      date_text: minutesDateText(data),
      time_text: ws.time || data.time_text || '',
      attendees: ws.attendees || data.attendees || '',
      remarks: data.remarks || '',
      items: data.items.map((i) => ({ topic: String(i.topic || '').trim(), directive: String(i.directive || '').trim(), owners: String(i.owners || '').trim() })).filter((i) => i.topic || i.directive),
    };
    ws.status = 'done';
  } catch (e) {
    if (e && e.cancelled) { ws.status = 'idle'; }
    else { console.error(e); ws.status = 'error'; ws.error = (e && e.userMsg) || 'حدث خطأ غير متوقع. حاول مرة أخرى.'; ws.errorDetail = (e && e.detail) || (e && e.message) || (e && !e.userMsg ? String(e) : ''); }
  }
  ws.ctl = null;
  render();
}

/* fill a minutes .docx template (default, or a past minutes file the user uploaded) */
async function loadTemplate(c) {
  const custom = ls.get('aai.tpl.' + c);
  if (custom && custom.b64) return Uint8Array.from(atob(custom.b64), (ch) => ch.charCodeAt(0)).buffer;
  if (!window.AAI_MINUTES_TEMPLATES) await new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'assets/templates/minutes-template.js';
    s.onload = res; s.onerror = () => rej(new Error('template')); document.head.appendChild(s);
  });
  return Uint8Array.from(atob(window.AAI_MINUTES_TEMPLATES[c] || window.AAI_MINUTES_TEMPLATES.national), (ch) => ch.charCodeAt(0)).buffer;
}
async function buildMinutesDocx(r, c) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await loadTemplate(c));
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const ts = (el) => [...el.getElementsByTagNameNS(W, 't')];
  const textOf = (el) => ts(el).map((t) => t.textContent).join('');
  const setT = (t, v) => { t.textContent = v; t.setAttribute('xml:space', 'preserve'); };
  const setAll = (el, v) => {
    const list = ts(el);
    if (!list.length) {
      const p = el.localName === 'p' ? el : el.getElementsByTagNameNS(W, 'p')[0]; if (!p) return;
      const run = doc.createElementNS(W, 'w:r'); const t = doc.createElementNS(W, 'w:t'); run.appendChild(t); p.appendChild(run); setT(t, v); return;
    }
    setT(list[0], v); list.slice(1).forEach((t) => setT(t, ''));
  };
  const setLabeled = (p, label, v) => {
    const list = ts(p);
    if (list.length > 1 && list[0].textContent.includes(label) && list[0].textContent.replace(label, '').replace(/[:\s]/g, '') === '') {
      setT(list[1], (list[0].textContent.endsWith(' ') ? '' : ' ') + v); list.slice(2).forEach((t) => setT(t, ''));
    } else setAll(p, `${label}: ${v}`);
  };
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const outside = [...body.getElementsByTagNameNS(W, 'p')].filter((p) => { for (let n = p.parentNode; n; n = n.parentNode) if (n.localName === 'tbl') return false; return true; });
  const find = (rx) => outside.find((p) => rx.test(textOf(p)));
  const tp = find(/محضر/); if (tp) setAll(tp, r.title);
  const dp = find(/^\s*التاريخ/); if (dp) setLabeled(dp, 'التاريخ', r.date_text);
  const tm = find(/^\s*التوقيت/); if (tm) setLabeled(tm, 'التوقيت', r.time_text);
  const ap = find(/^\s*الحضور/); if (ap) setLabeled(ap, 'الحضور', r.attendees);
  const tbl = [...body.getElementsByTagNameNS(W, 'tbl')].find((t) => /الموضوع|التوجيه/.test(textOf(t)));
  if (!tbl) throw new Error('table');
  const rows = [...tbl.getElementsByTagNameNS(W, 'tr')];
  const hi = rows.findIndex((tr) => /الموضوع|التوجيه/.test(textOf(tr)));
  const hdr = [...rows[hi].children].filter((x) => x.localName === 'tc').map(textOf);
  const col = (rx, fb) => { const i = hdr.findIndex((h) => rx.test(h)); return i >= 0 ? i : fb; };
  const cN = col(/^\s*(#|م|الرقم|رقم)\s*$/, 0), cT = col(/الموضوع/, 1), cD = col(/التوجيه/, 2), cO = col(/أصحاب|المسؤول/, 3);
  const tmpl = rows[hi + 1];
  if (!tmpl) throw new Error('table');
  rows.slice(hi + 2).forEach((tr) => tr.parentNode.removeChild(tr));
  r.items.forEach((it, i) => {
    const tr = tmpl.cloneNode(true);
    const cells = [...tr.children].filter((x) => x.localName === 'tc');
    const vals = { [cN]: String(i + 1), [cT]: it.topic, [cD]: it.directive, [cO]: it.owners };
    cells.forEach((tc, k) => { if (k in vals) setAll(tc, vals[k].replace(/\s*\n\s*/g, ' ')); });
    tmpl.parentNode.insertBefore(tr, tmpl);
  });
  tmpl.parentNode.removeChild(tmpl);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function downloadMinutes() {
  const r = ws.result; if (!r) return;
  let blob;
  try { blob = await buildMinutesDocx(r, ws.committee); }
  catch (e) { console.error(e); toast(e.message === 'jszip' ? 'تعذّر تحميل أداة Word. تحقق من الإنترنت.' : 'تعذّر تجهيز الملف. تحقق من قالب اللجنة.'); return; }
  // ASCII filename: some browsers drop non-Latin names from generated downloads
  const filename = `Minutes-${ws.committee === 'national' ? 'National' : 'Ministry'}-Committee-${ws.number || 'X'}${ws.date ? '-' + ws.date : ''}.docx`;
  saveFile(blob, filename);
}

function saveMinutesToTracker() {
  const r = ws.result; if (!r) return;
  const number = Number(ws.number) || null;
  if (!number) { toast('أدخل رقم الاجتماع أولاً'); return; }
  const { isNew } = upsertMeeting({
    committee: ws.committee, number, title: r.title.replace(/^محضر\s*/, ''), date: ws.date, time: r.time_text, attendees: r.attendees,
    items: r.items.map((i) => ({ id: uid('i'), ...i, status: 'pending' })),
  });
  saveUI();
  commit(isNew ? 'أُضيف المحضر إلى محاضر الاجتماعات' : 'تم تحديث محضر الاجتماع');
}

function minutesAsText() {
  const r = ws.result;
  return [r.title, `التاريخ: ${r.date_text}`, `التوقيت: ${r.time_text}`, `الحضور: ${r.attendees}`, '',
    ...r.items.map((i, k) => `${k + 1}. ${i.topic}\nالتوجيه: ${i.directive}\nأصحاب العلاقة: ${i.owners}`)].join('\n');
}

function templatesModal() {
  const row = (c) => {
    const t = ls.get('aai.tpl.' + c);
    return `<div class="tpl-row">
      <div class="tpl-h"><span class="dot" style="--c:var(--c-${c})"></span><b>${COMMITTEES[c]}</b></div>
      <div class="tpl-file">${ICON.doc}<span>${t ? esc(t.name) : `القالب الافتراضي (بتنسيق محاضر ${COMMITTEES[c]})`}</span>
        <label class="btn sm" for="tpl-${c}">رفع قالب</label><input type="file" id="tpl-${c}" data-tpl="${c}" accept=".docx" hidden>
        ${t ? `<button type="button" class="btn sm danger" data-tplreset="${c}">الافتراضي</button>` : ''}
      </div>
      ${field('تعليمات الصياغة', area('instr_' + c, ls.get('aai.instr.' + c) || '', 'rows="4" placeholder="مثال: استخدم «معالي» قبل أسماء الوزراء، واذكر الجهة المسؤولة بعد كل توجيه…"'), 'تُضاف إلى ما يرسله الموقع إلى Claude عند إعداد محاضر هذه اللجنة. يمكنك لصق تعليمات مشروعك في Claude هنا.')}
    </div>`;
  };
  openModal({
    title: 'القوالب والتعليمات',
    body: `<div class="hint">ارفع أي محضر سابق بصيغة Word ليكون القالب: يحتفظ الموقع بتنسيقه (الشعار، الخطوط، الجدول) ويستبدل العنوان والتاريخ والتوقيت والحضور وصفوف التوجيهات. القوالب محفوظة على هذا الجهاز.</div>${row('national')}${row('ministry')}`,
    onSave(d) {
      ['national', 'ministry'].forEach((c) => { const v = (d['instr_' + c] || '').trim(); v ? ls.set('aai.instr.' + c, v) : ls.del('aai.instr.' + c); });
      toast('تم حفظ القوالب والتعليمات');
    },
  });
  form.querySelectorAll('[data-tpl]').forEach((inpEl) => inpEl.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const c = e.target.dataset.tpl;
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      ls.set('aai.tpl.' + c, { name: f.name, b64: btoa(bin) });
      // check it has the minutes table
      await buildMinutesDocx({ title: 't', date_text: '', time_text: '', attendees: '', items: [{ topic: 'a', directive: 'b', owners: 'c' }] }, c);
      toast('تم حفظ القالب'); dlg.close(); templatesModal();
    } catch (err) { ls.del('aai.tpl.' + c); toast('لم يُعثر على جدول التوجيهات في هذا الملف'); }
  });
  form.querySelectorAll('[data-tplreset]').forEach((b) => b.onclick = () => { ls.del('aai.tpl.' + b.dataset.tplreset); dlg.close(); templatesModal(); });
}

function addImages(files) {
  for (const f of files) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('الصور بصيغة JPG أو PNG أو WebP فقط'); continue; }
    if (ws.images.length >= 10) { toast('الحد الأقصى 10 صور'); break; }
    ws.images.push({ file: f, url: URL.createObjectURL(f) });
  }
  render();
}

/* ---------------- photos: compress, store, show ---------------- */
// Where a photo goes: the claude.ai page's own asset store when available; otherwise this
// browser's IndexedDB, and also the GitHub repository (assets/photos/) when sync is on.
const CATS = {
  national: 'اجتماع اللجنة الوطنية', ministry: 'اجتماع لجنة الوزارة', workshop: 'ورشة / تدريب',
  launch: 'إطلاق', milestone: 'محطة رئيسية', event: 'لقاء / فعالية', other: 'أخرى',
};
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('aai-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos');
      r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error);
    });
  },
  async put(k, blob) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('photos', 'readwrite'); t.objectStore('photos').put(blob, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res) => { const q = db.transaction('photos').objectStore('photos').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
};
async function compressImage(file, max = 1600, quality = 0.82, ratio = null) {
  const bmp = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (ratio) { // centre-crop to width/height ratio
    if (sw / sh > ratio) { const w = sh * ratio; sx = (sw - w) / 2; sw = w; } else { const h = sw / ratio; sy = (sh - h) / 2; sh = h; }
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const cv = document.createElement('canvas'); cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  cv.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob(res, 'image/jpeg', quality));
}
async function ghPutFile(path, blob) {
  const g = gh(); const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${path}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${g.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `إضافة صورة ${todayStr()}`, content: btoa(bin), branch: g.branch || undefined }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
}
async function savePhoto(file) {
  const blob = await compressImage(file);
  if (cap.assets) { const r = await cap.assets.upload(blob); return r.url || '/_blob/' + r.id; }
  const key = uid('p');
  await IDB.put(key, blob);
  if (ghOn()) { try { await ghPutFile(`assets/photos/${key}.jpg`, blob); return `assets/photos/${key}.jpg`; } catch (e) { console.warn(e); } }
  return 'idb:' + key;
}
const photoCache = new Map();
async function photoBlob(src) {
  const key = src.startsWith('idb:') ? src.slice(4) : (src.match(/assets\/photos\/([^/.]+)\.jpg$/) || [])[1];
  if (key) { const b = await IDB.get(key); if (b) return b; }
  if (src.startsWith('idb:')) return null;
  const r = await fetch(src); return r.ok ? r.blob() : null;
}
async function photoURL(src) {
  if (!src.startsWith('idb:')) return src;
  if (photoCache.has(src)) return photoCache.get(src);
  const b = await photoBlob(src); const u = b ? URL.createObjectURL(b) : '';
  photoCache.set(src, u); return u;
}
// fill <img data-photo> after each render; repo photos fall back to this browser's copy
function hydratePhotos(root = document) {
  root.querySelectorAll('img[data-photo]:not([src])').forEach(async (img) => {
    const src = img.dataset.photo;
    img.onerror = async () => { img.onerror = null; const b = await photoBlob('idb:' + ((src.match(/([^/]+)\.jpg$/) || [])[1] || '')).catch(() => null); if (b) img.src = URL.createObjectURL(b); else img.classList.add('broken'); };
    img.src = await photoURL(src) || '';
  });
}
async function saveFile(blob, filename) {
  if (cap.downloads) {
    try { await cap.downloads.save({ filename, data: blob }); toast('تم حفظ الملف'); }
    catch (e) { if (e && e.code !== 'declined') toast('تعذّر حفظ الملف في هذا العرض'); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.hidden = true;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function lightbox(srcs, i) {
  openModal({ title: `الصور (${i + 1} من ${srcs.length})`, submit: null,
    body: `<div class="lb"><img data-photo="${esc(srcs[i])}" alt="">${srcs.length > 1 ? `<div class="lb-nav"><button type="button" class="btn sm" data-lb="${(i - 1 + srcs.length) % srcs.length}">السابقة</button><button type="button" class="btn sm" data-lb="${(i + 1) % srcs.length}">التالية</button></div>` : ''}</div>` });
  hydratePhotos(form);
  form.querySelectorAll('[data-lb]').forEach((b) => b.onclick = () => lightbox(srcs, +b.dataset.lb));
}

/* ---------------- launches & announcements ---------------- */
const LST = [
  ['planned', 'مخطط'], ['prep', 'قيد الإعداد'], ['ready', 'جاهز – بانتظار الموعد أو الاعتماد'], ['scheduled', 'محدد الموعد'], ['announced', 'تم الإعلان'],
];
const LSTN = Object.fromEntries(LST);
const lNext = (s) => (LST[LST.findIndex(([k]) => k === s) + 1] || [])[0];
const thisYM = () => todayStr().slice(0, 7);
const isOverdue = (l) => l.status !== 'announced' && ((l.date && l.date < todayStr()) || (!l.date && l.month && l.month < thisYM()));
const lWhen = (l) => l.date ? fmtDate(l.date) : l.month ? fmtYM(l.month + '-01') : 'للتحديد';

// undo history for the launches board (last 20 changes, this session)
const lHist = [];
const lSnap = () => { lHist.push(JSON.stringify(state.launches)); if (lHist.length > 20) lHist.shift(); };
// the launches page is drawn like the A3 launches calendar slide
const A3_NOTE = (l) => l.status === 'announced' ? '✓ تم الإعلان' : (l.note || (l.date ? `موعد الإطلاق ${fmtDate(l.date)}` : l.status === 'planned' ? '' : LSTN[l.status]));
function launchCard(l) {
  const month = l.month ? MONTHS[+l.month.slice(5, 7) - 1] : 'للتحديد';
  const logos = (l.logos || []).map((g) => `<img data-photo="${esc(g)}" alt="">`).join('');
  const note = A3_NOTE(l);
  return `<article class="a3c st-${l.status} ${isOverdue(l) ? 'late' : ''}" data-act="l-edit" data-id="${l.id}" tabindex="0">
    ${l.bg ? `<img class="a3c-bg" data-photo="${esc(l.bg)}" alt="">` : ''}${l.mark ? `<span class="a3c-mark" dir="ltr">${esc(l.mark)}</span>` : ''}
    <div class="a3c-top">
      <span class="a3c-who">${(l.avatars || []).map((a) => `<img data-photo="${esc(a)}" alt="">`).join('')}${l.logosTop ? `<span class="a3c-logos top">${logos}</span>` : ''}</span>
      ${isOverdue(l) ? '<span class="a3c-late">متأخر</span>' : ''}<span class="a3c-month">${month}</span>
    </div>
    <h3>${bd(l.title)}</h3>
    ${!l.logosTop && logos ? `<span class="a3c-logos">${logos}</span>` : ''}
    <label class="a3c-note a3c-sel" title="تغيير الحالة"><span>${bd(note || LSTN[l.status])}</span><i aria-hidden="true">▾</i>
      <select data-act="l-status" data-id="${l.id}" aria-label="حالة: ${esc(l.title)}">${LST.map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  </article>`;
}

function viewLaunches() {
  const L = [...state.launches].sort((a, b) => (a.order ?? 9e9) - (b.order ?? 9e9) || (a.month || '9').localeCompare(b.month || '9'));
  const done = L.filter((l) => l.status === 'announced').length;
  const tiles = [];
  L.forEach((l) => {
    const last = tiles[tiles.length - 1];
    if (l.group && last && last.group === l.group) last.items.push(l);
    else tiles.push(l.group ? { group: l.group, items: [l] } : { item: l });
  });
  const bg = state.launchBoard && state.launchBoard.bg;
  return `
  <section class="a3">
    ${bg ? `<img class="a3-bg" data-photo="${esc(bg)}" alt="">` : ''}
    <header class="a3-h">
      <h1>تقويم الإطلاقات والإعلانات</h1>
      <img class="a3-logo" src="assets/logo-mono.svg" alt="مشروع الذكاء الاصطناعي المساعد">
    </header>
    <div class="a3-bar">
      <span class="a3-prog"><b>${done}</b> من ${L.length} تم الإعلان<i style="--p:${L.length ? done / L.length * 100 : 0}%"></i></span>
      <span class="a3-legend">${LST.map(([k, v]) => `<span class="lg st-${k}"><i></i>${v}</span>`).join('')}</span>
      <button class="btn sm a3-add" data-act="l-add">+ إضافة</button>
      <button class="btn sm a3-reset" data-act="l-pptx" title="تصدير التقويم إلى PowerPoint">⇩ PowerPoint</button>
      <button class="btn sm a3-reset" data-act="l-undo" ${lHist.length ? '' : 'disabled'} title="التراجع عن آخر تغيير">↶ تراجع${lHist.length ? ` (${lHist.length})` : ''}</button>
      <button class="btn sm a3-reset ${ui.lresetArm ? 'armed' : ''}" data-act="l-reset" title="إعادة الإطلاقات إلى حالاتها الأصلية كما في تقويم A3">${ui.lresetArm ? 'تأكيد إعادة الضبط' : '↺ إعادة الضبط'}</button>
    </div>
    <div class="a3-grid">${tiles.map((t) => t.item ? launchCard(t.item) : `
      <div class="a3-group" style="--n:${t.items.length}">
        <div class="a3-group-h">${bd(t.group)}</div>
        <div class="a3-group-c">${t.items.map(launchCard).join('')}</div>
      </div>`).join('')}
    </div>
  </section>
  <p class="section-note">غيّر حالة أي إطلاق من القائمة المنسدلة أسفل بطاقته، أو اضغط على البطاقة لتعديل موعدها وملاحظتها.</p>`;
}

// Export the launches board as a one-slide PowerPoint, laid out exactly as drawn on screen.
const PPTXGEN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js';
function loadPptxGen() {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = PPTXGEN_URL; s.onload = () => res(window.PptxGenJS); s.onerror = () => rej(new Error('pptxgenjs')); document.head.appendChild(s); });
}
async function imgData(img, w, h, round) {
  if (!img || !img.complete || !img.naturalWidth) return null;
  try {
    const c = document.createElement('canvas'); const k = img.classList.contains('a3-logo') ? 6 : 2;
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext('2d');
    if (round) { x.beginPath(); x.arc(c.width / 2, c.height / 2, Math.min(c.width, c.height) / 2, 0, Math.PI * 2); x.clip(); }
    const r = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight), contain = img.classList.contains('a3-logo') || img.closest('.a3c-logos');
    const s = contain ? Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight) : r;
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    x.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    return c.toDataURL(contain || round ? 'image/png' : 'image/jpeg', .85);
  } catch { return null; }
}
async function exportLaunchesPptx(btn) {
  const board = $('.a3'); if (!board) return;
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'جارٍ التصدير…';
  try {
    const PptxGenJS = await loadPptxGen();
    const pptx = new PptxGenJS();
    const B = board.getBoundingClientRect(), W = 13.333, H = +(W * B.height / B.width).toFixed(3), k = W / B.width;
    pptx.defineLayout({ name: 'BOARD', width: W, height: H }); pptx.layout = 'BOARD'; pptx.rtlMode = true;
    const slide = pptx.addSlide(); slide.background = { color: '0A1A4A' };
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left - B.left) * k, y: (r.top - B.top) * k, w: r.width * k, h: r.height * k, r }; };
    const font = 'Dubai', T = { fontFace: font, rtlMode: true, lang: 'ar-AE', margin: 0 };
    const bg = board.querySelector('.a3-bg'); const bgd = await imgData(bg, B.width, B.height);
    if (bgd) slide.addImage({ data: bgd, x: 0, y: 0, w: W, h: H });
    const h1 = box(board.querySelector('.a3-h h1'));
    slide.addText('تقويم الإطلاقات والإعلانات', { ...T, x: h1.x, y: h1.y, w: h1.w, h: h1.h, fontSize: 26, bold: true, color: 'FFFFFF', align: 'right', valign: 'middle' });
    const lg = board.querySelector('.a3-logo'); if (lg) { const b = box(lg); const d = await imgData(lg, b.r.width, b.r.height); if (d) slide.addImage({ data: d, x: b.x, y: b.y, w: b.w, h: b.h }); }
    const pr = board.querySelector('.a3-prog'); if (pr) { const b = box(pr); slide.addText(pr.textContent.trim(), { ...T, x: b.x, y: b.y, w: b.w, h: b.h, fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', shape: pptx.ShapeType.roundRect, rectRadius: .15, fill: { color: 'FFFFFF', transparency: 85 } }); }
    for (const it of board.querySelectorAll('.a3-legend .lg')) {
      const b = box(it), dot = box(it.querySelector('i')), col = { announced: '00B050', ready: 'FFC000', prep: 'FFC000', scheduled: '2E75FF', planned: 'E8ECF4' }[[...it.classList].find((x) => x.startsWith('st-')).slice(3)];
      slide.addShape(pptx.ShapeType.roundRect, { x: dot.x, y: dot.y, w: dot.w, h: dot.h, rectRadius: .02, fill: { color: col }, line: { type: 'none' } });
      slide.addText(it.textContent.trim(), { ...T, x: b.x, y: b.y, w: Math.max(0, dot.x - b.x - .03), h: b.h, fontSize: 9, color: 'FFFFFF', align: 'right', valign: 'middle' });
    }
    for (const g of board.querySelectorAll('.a3-group')) {
      const b = box(g); slide.addShape(pptx.ShapeType.roundRect, { x: b.x, y: b.y, w: b.w, h: b.h, rectRadius: .12, fill: { color: 'FFFFFF', transparency: 88 }, line: { color: 'FFFFFF', transparency: 70, width: .75 } });
      const gh = g.querySelector('.a3-group-h'); const hb = box(gh);
      slide.addText(gh.textContent.trim(), { ...T, x: hb.x, y: hb.y, w: hb.w, h: hb.h, fontSize: 10, bold: true, color: '0A1A4A', align: 'center', valign: 'middle', shape: pptx.ShapeType.roundRect, rectRadius: .08, fill: { color: 'FFFFFF' } });
    }
    for (const c of board.querySelectorAll('.a3c')) {
      const b = box(c);
      const stc = { announced: '00B050', ready: 'FFC000', prep: 'FFC000', scheduled: '2E75FF', planned: 'E8ECF4' }[[...c.classList].find((x) => x.startsWith('st-')).slice(3)] || 'E8ECF4';
      slide.addShape(pptx.ShapeType.roundRect, { x: b.x, y: b.y, w: b.w, h: b.h, rectRadius: .1, fill: { color: '0B1F5C' }, line: { color: 'FFFFFF', transparency: 80, width: .75 } });
      const cb = c.querySelector('.a3c-bg'); const d = await imgData(cb, b.r.width, b.r.height);
      if (d) { slide.addImage({ data: d, x: b.x, y: b.y, w: b.w, h: b.h, transparency: 45 }); slide.addShape(pptx.ShapeType.rect, { x: b.x, y: b.y + b.h * .35, w: b.w, h: b.h * .65, fill: { color: '06103A', transparency: 30 }, line: { type: 'none' } }); }
      for (const a of c.querySelectorAll('.a3c-who img')) { const ab = box(a); const ad = await imgData(a, ab.r.width, ab.r.height, true); if (ad) slide.addImage({ data: ad, x: ab.x, y: ab.y, w: ab.w, h: ab.h }); }
      for (const a of c.querySelectorAll('.a3c-logos img')) { const ab = box(a); const ad = await imgData(a, ab.r.width, ab.r.height); if (ad) slide.addImage({ data: ad, x: ab.x, y: ab.y, w: ab.w, h: ab.h }); }
      const mo = c.querySelector('.a3c-month'), mb = box(mo);
      slide.addText(mo.textContent.trim(), { ...T, x: mb.x, y: mb.y, w: mb.w, h: mb.h, fontSize: 10, bold: true, color: '0A1A4A', align: 'center', valign: 'middle', shape: pptx.ShapeType.roundRect, rectRadius: .1, fill: { color: stc === 'E8ECF4' ? 'FFFFFF' : stc } });
      const late = c.querySelector('.a3c-late'); if (late) { const lb = box(late); slide.addText('متأخر', { ...T, x: lb.x, y: lb.y, w: lb.w, h: lb.h, fontSize: 8, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', shape: pptx.ShapeType.roundRect, rectRadius: .05, fill: { color: 'E5484D' } }); }
      const t = c.querySelector('h3'), tb = box(t);
      slide.addText(t.textContent.trim(), { ...T, x: tb.x, y: tb.y, w: tb.w, h: Math.max(tb.h, .3), fontSize: 11, bold: true, color: 'FFFFFF', align: 'right', valign: 'top', fit: 'shrink' });
      const n = c.querySelector('.a3c-note span'), nb = box(c.querySelector('.a3c-note'));
      slide.addText(n.textContent.trim(), { ...T, x: nb.x, y: nb.y, w: nb.w, h: nb.h, fontSize: 9, bold: true, color: ['00B050', '2E75FF'].includes(stc) ? 'FFFFFF' : '0A1A4A', align: 'center', valign: 'middle', shape: pptx.ShapeType.roundRect, rectRadius: .05, fill: { color: stc } });
    }
    const blob = await pptx.write({ outputType: 'blob' });
    await saveFile(blob, `Launches-Calendar-${todayStr()}.pptx`);
  } catch (e) { console.error(e); toast('تعذّر التصدير: ' + (e.message || e)); }
  finally { btn.disabled = false; btn.textContent = label; }
}

function launchModal(l) {
  const isNew = !l;
  l ||= { title: '', month: thisYM(), status: 'planned' };
  openModal({
    title: isNew ? 'إضافة إطلاق' : 'تعديل الإطلاق',
    body: field('الإطلاق / الإعلان', inp('title', l.title, 'required')) +
      `<div class="row2">${field('الحالة', sel('status', LSTN, l.status))}${field('الشهر المستهدف', inp('month', l.month || '', 'type="month"'), 'اتركه فارغاً إن لم يُحدَّد')}</div>` +
      `<div class="row2">${field('تاريخ الإطلاق', inp('date', l.date || '', 'type="date"'), 'اختياري')}${field('الجهة / المسؤول', inp('owner', l.owner || ''))}</div>` +
      field('ملاحظة الحالة', inp('note', l.note || '', 'placeholder="مثال: الخبر جاهز + لتحديد تاريخ الإعلان"')) +
      field('الفعالية / المجموعة', inp('group', l.group || ''), 'اختياري، مثل «الفعالية الكبرى في نوفمبر»') +
      `<div class="field"><label>صورة البطاقة</label><div class="img-pick"><label class="btn sm" for="launchImg">اختر صورة</label><input type="file" id="launchImg" accept="image/*" hidden><small>تظهر خلفية للبطاقة</small></div></div>`,
    del: isNew ? null : () => { lSnap(); state.launches = state.launches.filter((x) => x.id !== l.id); commit('تم حذف الإطلاق'); },
    onSave(d) {
      lSnap();
      Object.assign(l, { title: d.title, status: d.status, month: d.month || (d.date ? d.date.slice(0, 7) : null) });
      ['date', 'owner', 'note', 'group'].forEach((k) => { d[k] ? l[k] = d[k] : delete l[k]; });
      if (isNew) { l.id = uid('l'); l.order = Math.max(0, ...state.launches.map((x) => x.order || 0)) + 1; state.launches.push(l); }
      const img = $('#launchImg') && $('#launchImg').files[0];
      if (img) { savePhoto(img).then((src) => { l.bg = src; commit('تم حفظ الإطلاق'); }).catch(() => commit('تم الحفظ، وتعذّر حفظ الصورة')); return; }
      commit(isNew ? 'تمت إضافة الإطلاق' : 'تم حفظ الإطلاق');
    },
  });
}

/* ---------------- events archive ---------------- */
function viewArchive() {
  const off = ui.aoff || [];
  const evs = [...state.events].filter((e) => !off.includes(e.category)).sort((a, b) => b.date.localeCompare(a.date));
  const nPhotos = state.events.reduce((n, e) => n + (e.photos || []).length, 0);
  const groups = [];
  evs.forEach((e) => { const ym = e.date.slice(0, 7); const g = groups.find((x) => x.ym === ym); g ? g.items.push(e) : groups.push({ ym, items: [e] }); });
  return `
  <div class="page-head">
    <div><h1>أرشيف الفعاليات</h1><p>${state.events.length} فعالية · ${nPhotos} صورة. افتح أي فعالية لإضافة صورها.</p></div>
    <button class="btn primary" data-act="ev-add">+ إضافة فعالية</button>
  </div>
  <div class="filters">${Object.entries(CATS).map(([k, v]) => `<button class="chip fchip ${off.includes(k) ? 'off' : ''}" data-act="a-filter" data-cat="${k}"><span class="dot" style="--c:var(--c-${k})"></span>${v}</button>`).join('')}</div>
  ${groups.map((g) => `
    <section class="arch-month">
      <h2>${fmtYM(g.ym + '-01')}<span class="count">${g.items.length}</span></h2>
      <div class="arch-grid">${g.items.map((e) => { const p = e.photos || []; return `
        <button class="ev-card" data-act="ev-open" data-id="${e.id}" style="--c:var(--c-${e.category})">
          <span class="ev-cover">${p.length ? `<img data-photo="${esc(p[0].src)}" alt="" loading="lazy">` : `<span class="ev-ph">${ICON.image}</span>`}
            <span class="ev-date"><b>${parse(e.date).d}</b>${MONTHS[parse(e.date).m - 1]}</span>${p.length > 1 ? `<span class="ev-n">${p.length} صور</span>` : ''}</span>
          <span class="ev-body"><b>${esc(e.title)}</b><small><span class="dot"></span>${CATS[e.category] || CATS.other}</small></span>
        </button>`; }).join('')}
      </div>
    </section>`).join('') || '<div class="card empty">لا توجد فعاليات.</div>'}`;
}

function eventModal(e) {
  const isNew = !e;
  e ||= { date: todayStr(), title: '', category: 'event', photos: [] };
  const photos = e.photos || [];
  openModal({
    title: isNew ? 'إضافة فعالية' : esc(e.title),
    body: (isNew ? '' : `
      <div class="gal">${photos.map((p, i) => `<figure><img data-photo="${esc(p.src)}" alt="" data-gi="${i}"><button type="button" class="x" data-rmph="${i}" aria-label="حذف الصورة">✕</button></figure>`).join('')}
        <label class="gal-add" for="evPhotos">${ICON.image}<span>إضافة صور</span></label>
      </div><input type="file" id="evPhotos" accept="image/*" multiple hidden>`) +
      field('عنوان الفعالية', inp('title', e.title, 'required')) +
      `<div class="row2">${field('التاريخ', inp('date', e.date, 'type="date" required'))}${field('تاريخ الانتهاء', inp('endDate', e.endDate || '', 'type="date"'), 'اختياري')}</div>` +
      field('التصنيف', sel('category', CATS, e.category)) +
      field('الوصف', area('description', e.description || '', 'rows="3"')),
    del: isNew ? null : () => { state.events = state.events.filter((x) => x.id !== e.id); commit('تم حذف الفعالية'); },
    onSave(d) {
      Object.assign(e, { title: d.title, date: d.date, category: d.category });
      d.endDate && d.endDate !== d.date ? e.endDate = d.endDate : delete e.endDate;
      d.description ? e.description = d.description : delete e.description;
      if (isNew) { e.id = uid('e'); e.photos = []; state.events.push(e); }
      commit(isNew ? 'تمت إضافة الفعالية. افتحها لإضافة الصور' : 'تم حفظ الفعالية');
    },
  });
  if (isNew) return;
  hydratePhotos(form);
  form.querySelectorAll('[data-gi]').forEach((img) => img.onclick = () => lightbox(photos.map((p) => p.src), +img.dataset.gi));
  form.querySelectorAll('[data-rmph]').forEach((b) => b.onclick = () => { photos.splice(+b.dataset.rmph, 1); e.photos = photos; persistQuiet(); dlg.close(); render(); eventModal(e); });
  $('#evPhotos').onchange = async (ev) => {
    const files = [...ev.target.files]; if (!files.length) return;
    toast(`جارٍ حفظ ${files.length} صورة…`);
    let ok = 0;
    for (const f of files) { try { photos.push({ id: uid('ph'), src: await savePhoto(f) }); ok++; } catch (err) { console.error(err); } }
    e.photos = photos; dlg.close(); commit(ok ? `أُضيفت ${ok} صورة` : 'تعذّر حفظ الصور'); eventModal(e);
  };
}

/* ---------------- ideas & projects bank ---------------- */
const IST = { idea: 'فكرة', study: 'قيد الدراسة', approved: 'معتمد', active: 'قيد التنفيذ', done: 'مكتمل' };
const ITYPE = { idea: 'فكرة', project: 'مشروع' };
function viewIdeas() {
  const f = ui.if || 'all';
  const list = state.ideas.filter((x) => f === 'all' || x.status === f).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  return `
  <div class="page-head">
    <div><h1>بنك الأفكار والمشاريع</h1><p>سجّل الأفكار والمشاريع، تابع حالتها، وصدّر أي مشروع بقالب «Project Template» المعتمد.</p></div>
    <button class="btn primary" data-act="i-add">+ فكرة أو مشروع</button>
  </div>
  <div class="l-tools"><div class="seg">${[['all', 'الكل'], ...Object.entries(IST)].map(([k, v]) => `<button class="${f === k ? 'on' : ''}" data-act="i-filter" data-f="${k}">${v} ${k === 'all' ? state.ideas.length : state.ideas.filter((x) => x.status === k).length}</button>`).join('')}</div></div>
  ${list.length ? `<div class="idea-grid">${list.map((x) => `
    <article class="idea">
      <div class="idea-img">${x.image ? `<img data-photo="${esc(x.image)}" alt="">` : `<span>${ICON.spark}</span>`}</div>
      <div class="idea-body">
        <div class="idea-tags"><span class="chip">${ITYPE[x.type] || 'فكرة'}</span><span class="lpill is-${x.status}">${IST[x.status] || ''}</span></div>
        <h3>${esc(x.name)}</h3>${x.name_en ? `<div class="idea-en" dir="ltr">${esc(x.name_en)}</div>` : ''}
        ${x.what ? `<p>${esc(x.what)}</p>` : ''}
        <div class="idea-meta">${x.owner ? `<span>${esc(x.owner)}</span>` : ''}${x.start ? `<span>${fmtDate(x.start)}${x.end ? ' – ' + fmtDate(x.end) : ''}</span>` : ''}</div>
      </div>
      <div class="idea-actions"><button class="btn sm primary" data-act="i-export" data-id="${x.id}">تصدير القالب</button><button class="btn sm" data-act="i-edit" data-id="${x.id}">تعديل</button></div>
    </article>`).join('')}</div>` : `<div class="ws-empty">${ICON.spark}<p>${state.ideas.length ? 'لا توجد عناصر بهذه الحالة.' : 'البنك فارغ. أضف أول فكرة، أو اطلب من المساعد في الرئيسية: «أضف فكرة مشروع عن…».'}</p><button class="btn primary" data-act="i-add">+ أضف فكرة</button></div>`}`;
}

async function aiJSON(prompt) {
  const eng = engine(); if (!eng) throw new Error('Claude غير متصل');
  if (eng === 'claude') return cap.sample.json(prompt, { cache: false });
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: ls.get(LS_KEY), dangerouslyAllowBrowser: true });
  const msg = await client.beta.messages.create({ model: 'claude-opus-5-5', max_tokens: 4000, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', messages: [{ role: 'user', content: prompt }] });
  if (msg.stop_reason === 'refusal') throw new Error('اعتذر Claude عن هذا الطلب');
  return parseJSONLoose(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

function ideaModal(x) {
  const isNew = !x;
  x ||= { type: 'idea', status: 'idea', name: '', outputs: ['', '', ''] };
  const o = x.outputs || [];
  let newImage = null;
  openModal({
    title: isNew ? 'فكرة أو مشروع جديد' : 'تعديل',
    body: `
      ${engine() ? `<div class="ai-fill"><textarea id="ai-brief" rows="2" placeholder="صف الفكرة في جملة أو جملتين، وسيملأ Claude الحقول…"></textarea><button type="button" class="btn sm primary" id="aiFillBtn">${ICON.spark} املأ بالمساعد</button></div>` : ''}
      <div class="row2">${field('النوع', sel('type', ITYPE, x.type))}${field('الحالة', sel('status', IST, x.status))}</div>
      <div class="row2">${field('اسم المشروع', inp('name', x.name, 'required'))}${field('Project Name', inp('name_en', x.name_en || '', 'dir="ltr"'))}</div>
      ${field('ما هو؟', area('what', x.what || '', 'rows="3"'))}
      <div class="field"><label>أهم المخرجات</label><div class="outs">${[0, 1, 2].map((i) => `<input name="out${i}" id="f-out${i}" value="${esc(o[i] || '')}" placeholder="المخرج ${i + 1}">`).join('')}</div></div>
      <div class="row2">${field('تاريخ البدء', inp('start', x.start || '', 'type="date"'))}${field('تاريخ الانتهاء', inp('end', x.end || '', 'type="date"'))}</div>
      ${field('الجهة المسؤولة', inp('owner', x.owner || ''))}
      <div class="field"><label>الصورة التعبيرية</label><div class="img-pick">${x.image ? `<img data-photo="${esc(x.image)}" alt="" id="ideaImgPrev">` : '<img alt="" id="ideaImgPrev" hidden>'}<label class="btn sm" for="ideaImg">اختر صورة</label><input type="file" id="ideaImg" accept="image/*" hidden><small>تظهر في الجانب الأيمن من شريحة القالب</small></div></div>
      ${field('ملاحظات', area('notes', x.notes || '', 'rows="2"'))}`,
    del: isNew ? null : () => { state.ideas = state.ideas.filter((y) => y.id !== x.id); commit('تم الحذف'); },
    onSave(d) {
      Object.assign(x, { type: d.type, status: d.status, name: d.name, name_en: d.name_en, what: d.what, outputs: [d.out0, d.out1, d.out2], start: d.start, end: d.end, owner: d.owner, notes: d.notes, updated: new Date().toISOString() });
      const finish = () => { if (isNew) { x.id = uid('i'); state.ideas.push(x); } commit(isNew ? 'أُضيف إلى بنك الأفكار' : 'تم الحفظ'); };
      if (newImage) { savePhoto(newImage).then((src) => { x.image = src; finish(); }).catch(() => { toast('تعذّر حفظ الصورة'); finish(); }); return; }
      finish();
    },
  });
  hydratePhotos(form);
  $('#ideaImg').onchange = (e) => { newImage = e.target.files[0]; if (newImage) { const p = $('#ideaImgPrev'); p.hidden = false; p.removeAttribute('data-photo'); p.src = URL.createObjectURL(newImage); } };
  const btn = $('#aiFillBtn');
  if (btn) btn.onclick = async () => {
    const brief = ($('#ai-brief').value || form.querySelector('[name=what]').value || form.querySelector('[name=name]').value).trim();
    if (!brief) { toast('اكتب وصفاً مختصراً أولاً'); const b = $('#ai-brief'); b.focus(); b.classList.remove('need'); void b.offsetWidth; b.classList.add('need'); return; }
    btn.disabled = true; btn.textContent = 'جارٍ الصياغة…';
    try {
      const r = await aiJSON(`You help the UAE government "Agentic AI" project team (مشروع الذكاء الاصطناعي المساعد لحكومة دولة الإمارات) fill a one-slide project card. From the idea below, write formal, concise Modern Standard Arabic. Do not invent specific figures, dates or entity names that the idea does not state; leave such fields empty.

Idea: ${brief}

Reply with only JSON: {"name":"Arabic project name, 2-6 words","name_en":"English project name","what":"one or two sentences: what it is and its value","outputs":["output 1","output 2","output 3"],"owner":"responsible entity if stated, else empty"}`);
      if (!r || !r.name) throw new Error('رد غير صالح');
      const set = (n, v) => { const el = form.querySelector(`[name=${n}]`); if (el && v) el.value = v; };
      set('name', r.name); set('name_en', r.name_en); set('what', r.what); set('owner', r.owner);
      (r.outputs || []).slice(0, 3).forEach((v, i) => set('out' + i, v));
      toast('ملأ المساعد الحقول. راجعها ثم احفظ');
    } catch (e) { toast((e && (e.message || e.code)) ? `تعذّر: ${e.message || e.code}` : 'تعذّر الاتصال بـ Claude'); }
    btn.disabled = false; btn.innerHTML = `${ICON.spark} املأ بالمساعد`;
  };
}

async function buildProjectPptx(x) {
  const JSZip = await loadJSZip();
  if (!window.AAI_PROJECT_TEMPLATE) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'assets/templates/project-template.js'; s.onload = res; s.onerror = () => rej(new Error('template')); document.head.appendChild(s); });
  const zip = await JSZip.loadAsync(Uint8Array.from(atob(window.AAI_PROJECT_TEMPLATE), (c) => c.charCodeAt(0)));
  const path = 'ppt/slides/slide1.xml';
  const doc = new DOMParser().parseFromString(await zip.file(path).async('string'), 'application/xml');
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const shapes = {};
  [...doc.getElementsByTagNameNS(P, 'sp')].forEach((sp) => { const c = sp.getElementsByTagNameNS(P, 'cNvPr')[0]; if (c) shapes[c.getAttribute('id')] = sp; });
  const setPara = (id, idx, text) => {
    const sp = shapes[id]; if (!sp) return;
    const p = sp.getElementsByTagNameNS(A, 'p')[idx]; if (!p) return;
    let ts = [...p.getElementsByTagNameNS(A, 't')];
    if (!ts.length) { const r = doc.createElementNS(A, 'a:r'); const t = doc.createElementNS(A, 'a:t'); r.appendChild(t); p.insertBefore(r, p.getElementsByTagNameNS(A, 'endParaRPr')[0] || null); ts = [t]; }
    ts[0].textContent = text; ts.slice(1).forEach((t) => { t.textContent = ''; });
  };
  const o = x.outputs || [];
  setPara('7', 0, x.name || ''); setPara('7', 1, x.name_en || '');
  setPara('10', 0, x.what || '…');
  setPara('16', 0, o[0] || '…'); setPara('18', 0, o[1] || '…'); setPara('21', 0, o[2] || '…');
  setPara('11', 0, x.start ? `${fmtDate(x.start)}${x.end ? ' – ' + fmtDate(x.end) : ''}` : '…');
  setPara('9', 1, x.owner || '…');
  if (x.image) {
    const b = await photoBlob(x.image).catch(() => null);
    if (b) { zip.file('ppt/media/image1.jpeg', await compressImage(b, 1800, 0.86, 3697300 / 6865964)); setPara('6', 0, ''); }
  }
  zip.file(path, new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
async function exportIdea(id) {
  const x = state.ideas.find((y) => y.id === id); if (!x) return;
  try { saveFile(await buildProjectPptx(x), `Project-${(x.name_en || 'Template').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Template'}.pptx`); }
  catch (e) { console.error(e); toast(e.message === 'jszip' ? 'تعذّر تحميل أداة الملفات. تحقق من الإنترنت.' : 'تعذّر تجهيز القالب'); }
}

/* ---------------- national committee meeting deck ---------------- */
// Fills the committee's own PowerPoint (assets/templates/committee-template.pptx):
// cover, agenda table, launches calendar statuses (from the launches tracker),
// first-batch summary figures, points to consider and the FedAI headline figures.
const DECK_DEFAULT_FEDAI_SUB = 'وجاري العمل على استكمال الربط لبقية الوزارات والجهات الاتحادية';
const TRACKS = { ops: 'مسار العمليات والدعم المؤسسي', strategic: 'مسار العمل الحكومي الاستراتيجي', services: 'مسار الخدمات الحكومية' };
const minutesWord = (n) => { n = +n; return n === 1 ? 'دقيقة' : n === 2 ? 'دقيقتان' : n >= 3 && n <= 10 ? 'دقائق' : 'دقيقة'; };
function deckWorking() {
  if (!ws.deck) {
    ws.deck = JSON.parse(JSON.stringify(state.deck || { agenda: [], points: ['', '', ''], batch: {}, fedai: {} }));
    ws.deck.fedai ||= {}; ws.deck.fedai.sub ??= DECK_DEFAULT_FEDAI_SUB;
    ['ops', 'strategic', 'services'].forEach((k) => { ws.deck.batch ||= {}; ws.deck.batch[k] ||= {}; });
    while ((ws.deck.points || []).length < 3) (ws.deck.points ||= []).push('');
  }
  if (!ws.dnum) ws.dnum = String(meetingsOf('national').reduce((n, m) => Math.max(n, m.items.length ? m.number || 0 : 0), 0) + 1);
  if (!ws.ddate) ws.ddate = todayStr();
  return ws.deck;
}
const dIn = (path, val, attrs = '') => `<input data-deck="${path}" value="${esc(val ?? '')}" ${attrs}>`;

function viewDeckTask(eng) {
  const d = deckWorking();
  const total = d.agenda.reduce((n, r) => n + (+r.minutes || 0), 0);
  return `
  <div class="deck-grid">
  <section class="ws-form card">
    <div class="ws-step"><span class="sn">1</span><h3>الاجتماع</h3></div>
    <div class="ws-fields">
      <div class="field"><label for="dk-num">رقم الاجتماع</label><input id="dk-num" data-wsd="dnum" type="number" min="1" value="${esc(ws.dnum)}"></div>
      <div class="field"><label for="dk-date">التاريخ</label><input id="dk-date" data-wsd="ddate" type="date" value="${esc(ws.ddate)}"></div>
      <div class="field"><label>المدة التقديرية (دقيقة)</label>${dIn('duration', d.duration || total, 'type="number" min="0"')}</div>
    </div>

    <div class="ws-step"><span class="sn">2</span><h3>أجندة الاجتماع</h3><small class="muted-t">مجموع الفقرات: ${total} دقيقة</small></div>
    <div class="agenda">${d.agenda.map((r, i) => `
      <div class="ag-row">
        <span class="ag-i">${i + 1}</span>
        ${dIn(`agenda.${i}.topic`, r.topic, 'placeholder="الفقرة"')}
        ${dIn(`agenda.${i}.sub`, r.sub, 'placeholder="تفاصيل (اختياري)"')}
        ${dIn(`agenda.${i}.presenter`, r.presenter, 'placeholder="المتحدث"')}
        ${dIn(`agenda.${i}.minutes`, r.minutes, 'type="number" min="0" placeholder="د"')}
        <button class="icon-btn sm" data-act="dk-rm" data-i="${i}" aria-label="حذف الفقرة">✕</button>
      </div>`).join('')}
      ${d.agenda.length > 7 ? '<small class="warn-t">جدول الأجندة في العرض يتسع لسبع فقرات تقريباً؛ قد تحتاج إلى تصغير الخط في PowerPoint.</small>' : ''}
      <button class="link" data-act="dk-addrow">+ إضافة فقرة</button>
    </div>

    <div class="ws-step"><span class="sn">3</span><h3>نقاط للأخذ بعين الاعتبار</h3>${eng ? `<button class="btn sm" data-act="dk-suggest">${ICON.spark} اقترح من المحاضر والإطلاقات</button>` : ''}</div>
    ${[0, 1, 2].map((i) => `<div class="field"><textarea data-deck="points.${i}" rows="2" aria-label="النقطة ${i + 1}">${esc(d.points[i] || '')}</textarea></div>`).join('')}

    <div class="ws-step"><span class="sn">4</span><h3>ملخص إطلاقات الدفعة</h3></div>
    <div class="batch-tbl"><div></div><b>عدد الجهات</b><b>المستهدف العام</b><b>مستهدف الدفعة</b><b>نسبة الإنجاز %</b><b>الجاهز / أُطلق</b>
      ${Object.entries(TRACKS).map(([k, v]) => `<span>${v}</span>${['entities', 'target', 'batch', 'pct', 'ready'].map((f) => dIn(`batch.${k}.${f}`, (d.batch[k] || {})[f], 'inputmode="numeric"')).join('')}`).join('')}
    </div>
    <div class="field"><label>الجهات التي لم تسلّم دفعات الإطلاق</label><textarea data-deck="notDelivered" rows="2">${esc(d.notDelivered || '')}</textarea></div>

    <div class="ws-step"><span class="sn">5</span><h3>المنظومة التقنية الوطنية (FedAI)</h3></div>
    <div class="field"><label>العنوان</label>${dIn('fedai.headline', d.fedai.headline)}</div>
    <div class="field"><label>السطر الثاني</label>${dIn('fedai.sub', d.fedai.sub)}</div>
    <div class="ws-fields five">
      <div class="field"><label>إجمالي الجهات</label>${dIn('fedai.total', d.fedai.total)}</div>
      <div class="field"><label>نسبة الربط %</label>${dIn('fedai.pct', d.fedai.pct)}</div>
      <div class="field"><label>تم الربط</label>${dIn('fedai.connected', d.fedai.connected)}</div>
      <div class="field"><label>جاري الربط</label>${dIn('fedai.inProgress', d.fedai.inProgress)}</div>
      <div class="field"><label>يمكنها الاستفادة</label>${dIn('fedai.eligible', d.fedai.eligible)}</div>
    </div>
    <div class="ws-go"><button class="btn primary gen" data-act="dk-build">${ICON.deck} إنشاء العرض (PowerPoint)</button></div>
  </section>
  <aside class="deck-side card">
    <h3>ما يتضمّنه العرض</h3>
    <ol class="deck-list">
      <li><b>الغلاف</b> · الاجتماع ${ORD[+ws.dnum] || ws.dnum} · ${ws.ddate ? `${dowOf(ws.ddate)}، ${fmtDate(ws.ddate)}` : ''}</li>
      <li><b>الأجندة</b> · ${d.agenda.length} فقرات</li>
      <li><b>تقويم الإطلاقات</b> · تُحدَّث حالات البطاقات من صفحة الإطلاقات (${state.launches.filter((l) => l.status === 'announced').length} من ${state.launches.length} أُعلن)</li>
      <li><b>ملخص إطلاقات الدفعة</b> · أرقام المسارات الثلاثة</li>
      <li><b>نقاط للأخذ بعين الاعتبار</b></li>
      <li><b>مستجدات المسارات</b> · شرائح فواصل يضيف بعدها كل مسار عرضه</li>
      <li><b>FedAI</b> · العنوان والأرقام (قوائم الجهات تُعدَّل في PowerPoint)</li>
    </ol>
    <p class="muted-t">يُبنى العرض على تصميم عرض اللجنة الأصلي. تُحفظ هذه البيانات لتكون نقطة البداية في الاجتماع القادم.</p>
  </aside>
  </div>`;
}

async function loadCommitteeTemplate() {
  if (!window.AAI_COMMITTEE_TEMPLATE) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'assets/templates/committee-template.js'; s.onload = res; s.onerror = () => rej(new Error('template')); document.head.appendChild(s); });
  return Uint8Array.from(atob(window.AAI_COMMITTEE_TEMPLATE), (c) => c.charCodeAt(0));
}
const normTitle = (t) => String(t || '').replace(/[ـ‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim().split(' ').map((w) => [...w].sort().join('')).sort().join(' ');

async function buildCommitteeDeck(d, num, date) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await loadCommitteeTemplate());
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const load = async (n) => new DOMParser().parseFromString(await zip.file(`ppt/slides/slide${n}.xml`).async('string'), 'application/xml');
  const save = (n, doc) => zip.file(`ppt/slides/slide${n}.xml`, new XMLSerializer().serializeToString(doc));
  const spMap = (doc) => { const m = {}; [...doc.getElementsByTagNameNS(P, 'sp')].forEach((sp) => { const c = sp.getElementsByTagNameNS(P, 'cNvPr')[0]; if (c) m[c.getAttribute('id')] = sp; }); return m; };
  const paras = (el) => [...el.getElementsByTagNameNS(A, 'p')];
  const setP = (p, text, split) => {
    if (!p) return; let ts = [...p.getElementsByTagNameNS(A, 't')];
    if (!ts.length) { const r = p.ownerDocument.createElementNS(A, 'a:r'); const t = p.ownerDocument.createElementNS(A, 'a:t'); r.appendChild(t); p.insertBefore(r, p.getElementsByTagNameNS(A, 'endParaRPr')[0] || null); ts = [t]; }
    if (split && ts.length > 1) { const i = text.indexOf(' '); ts[0].textContent = i > 0 ? text.slice(0, i + 1) : text; ts[1].textContent = i > 0 ? text.slice(i + 1) : ''; ts.slice(2).forEach((t) => { t.textContent = ''; }); return; }
    ts[0].textContent = text; ts.slice(1).forEach((t) => { t.textContent = ''; });
  };
  const setSp = (m, id, idx, text, split) => { const sp = m[id]; if (sp) setP(paras(sp)[idx], String(text ?? ''), split); };
  const report = { launches: 0 };

  // 1 cover
  let doc = await load(1); let m = spMap(doc);
  setSp(m, '15', 0, `اجتماع اللجنة الوطنية ${ORD[+num] || num}`);
  setSp(m, '16', 0, date ? `${dowOf(date)}، ${fmtDate(date)}` : '');
  save(1, doc);

  // 2 agenda
  doc = await load(2); m = spMap(doc);
  const dur = [...doc.getElementsByTagNameNS(P, 'sp')].find((sp) => /المدة التقديرية/.test(sp.textContent));
  if (dur) setP(paras(dur).find((p) => /المدة التقديرية/.test(p.textContent)), `المدة التقديرية للاجتماع – ${d.duration || d.agenda.reduce((n, r) => n + (+r.minutes || 0), 0)} دقيقة`);
  const tbl = doc.getElementsByTagNameNS(A, 'tbl')[0];
  if (tbl) {
    const rows = [...tbl.getElementsByTagNameNS(A, 'tr')];
    const tOpen = rows[0], tSimple = rows[1], tSub = rows[2] || rows[1];
    rows.forEach((r) => r.parentNode.removeChild(r));
    d.agenda.filter((r) => r.topic || r.presenter).forEach((r, i) => {
      const tr = (i === 0 ? tOpen : r.sub ? tSub : tSimple).cloneNode(true);
      const tcs = [...tr.getElementsByTagNameNS(A, 'tc')];
      const pres = r.presenter + (r.minutes ? ` – ${r.minutes} ${minutesWord(r.minutes)}` : '');
      setP(paras(tcs[0])[0], pres); paras(tcs[0]).slice(1).forEach((p) => setP(p, ''));
      const ps = paras(tcs[1]); setP(ps[0], r.topic || '');
      if (ps[1]) setP(ps[1], r.sub || ''); ps.slice(2).forEach((p) => setP(p, ''));
      tbl.appendChild(tr);
    });
  }
  save(2, doc);

  // 4 launches calendar: update the status label, its colour and the month badge of each matching card
  doc = await load(4);
  const geo = [...doc.getElementsByTagNameNS(P, 'sp')].map((sp) => {
    const off = sp.getElementsByTagNameNS(A, 'off')[0], ext = sp.getElementsByTagNameNS(A, 'ext')[0];
    return off && ext ? { sp, x: +off.getAttribute('x'), y: +off.getAttribute('y'), w: +ext.getAttribute('cx'), h: +ext.getAttribute('cy'), text: sp.textContent.trim() } : null;
  }).filter(Boolean);
  const FILL = { announced: '00B050', ready: 'FFC000', prep: 'FFC000', scheduled: '0062FD', planned: '7F7F7F' };
  const setFill = (sp, hex) => {
    const spPr = sp.getElementsByTagNameNS(P, 'spPr')[0]; const sf = spPr && [...spPr.children].find((c) => c.localName === 'solidFill'); if (!sf) return;
    while (sf.firstChild) sf.removeChild(sf.firstChild);
    const c = sp.ownerDocument.createElementNS(A, 'a:srgbClr'); c.setAttribute('val', hex); sf.appendChild(c);
  };
  state.launches.forEach((l) => {
    const t = geo.find((g) => g.text && normTitle(g.text) === normTitle(l.title)); if (!t) return;
    report.launches++;
    const note = geo.find((g) => g !== t && g.h < 260000 && Math.abs(g.x - t.x) < 120000 && g.y > t.y && g.y < t.y + 1100000 && g.text);
    if (note) {
      const label = l.status === 'announced' ? '✓ تم الإعلان' : (l.note || (l.date ? `موعد الإطلاق ${fmtDate(l.date)}` : LSTN[l.status]));
      setP(paras(note.sp)[0], label); setFill(note.sp, FILL[l.status] || 'FFC000');
    }
    const badge = geo.find((g) => g !== t && g.h < 320000 && g.y < t.y && g.y > t.y - 600000 && Math.abs((g.x + g.w) - (t.x + t.w)) < 200000);
    if (badge) setP(paras(badge.sp)[0], l.month ? MONTHS[+l.month.slice(5, 7) - 1] : 'للتحديد');
  });
  save(4, doc);

  // 5 first-batch summary
  doc = await load(5); m = spMap(doc);
  const B = d.batch || {}, ids = { ops: ['150', '125', '67', '33', '15'], strategic: ['160', '131', '4', '36', '19'], services: ['156', '135', '37', '39', '21'] };
  Object.entries(ids).forEach(([k, [ent, tgt, bat, pct, rdy]]) => {
    const b = B[k] || {};
    setSp(m, ent, 0, b.entities); setSp(m, tgt, 0, b.target); setSp(m, bat, 0, b.batch); setSp(m, rdy, 0, b.ready);
    setSp(m, pct, 1, ` ${b.pct || 0}% نسبة الإنجاز المتوقعة`);
  });
  setSp(m, '117', 1, d.notDelivered || '');
  save(5, doc);

  // 6 points to consider (first word keeps the highlight colour)
  doc = await load(6); m = spMap(doc);
  ['15', '17', '19'].forEach((id, i) => setSp(m, id, 0, (d.points[i] || '').trim(), true));
  save(6, doc);

  // 9 FedAI
  doc = await load(9); m = spMap(doc); const F = d.fedai || {};
  setSp(m, '9', 0, F.headline); setSp(m, '9', 1, F.sub);
  setSp(m, '17', 0, F.total); setSp(m, '121', 0, `${F.pct || 0}%`); setSp(m, '126', 0, F.connected); setSp(m, '25', 0, F.inProgress); setSp(m, '21', 0, F.eligible);
  save(9, doc);

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  return { blob, report };
}

async function generateDeck() {
  const d = deckWorking();
  state.deck = JSON.parse(JSON.stringify(d)); persistQuiet();
  toast('جارٍ إنشاء العرض…');
  try {
    const { blob, report } = await buildCommitteeDeck(d, ws.dnum, ws.ddate);
    await saveFile(blob, `National-Committee-Meeting-${ws.dnum || 'X'}${ws.ddate ? '-' + ws.ddate : ''}.pptx`);
    toast(`العرض جاهز · حُدِّثت ${report.launches} بطاقات في تقويم الإطلاقات`);
  } catch (e) { console.error(e); toast(e && e.message === 'jszip' ? 'تعذّر تحميل أداة الملفات. تحقق من الإنترنت.' : 'تعذّر إنشاء العرض'); }
}

async function suggestDeckPoints(btn) {
  const recent = meetingsOf('national').filter((m) => m.items.length).slice(-2);
  const pend = recent.flatMap((m) => m.items.filter((i) => !isDone(i)).map((i) => `- (${meetingLabel(m)}) ${i.topic}: ${i.directive}`)).slice(0, 40).join('\n');
  const lates = state.launches.filter(isOverdue).map((l) => `- ${l.title} (${LSTN[l.status]})`).join('\n') || 'لا يوجد';
  btn.disabled = true;
  try {
    const r = await aiJSON(`You prepare the "نقاط للأخذ بعين الاعتبار" slide for the next meeting of the UAE National Committee for Agentic AI (اللجنة الوطنية للذكاء الاصطناعي المساعد). Propose exactly three short, formal Arabic points (one sentence each, 10 to 22 words) that the committee should consider, based only on the pending directives and delayed launches below. Start each point with a verb-noun such as «النظر في», «ضمان», «تسريع», «متابعة».

Pending directives from the last two meetings:
${pend || 'لا يوجد'}

Delayed launches:
${lates}

Reply with only JSON: {"points":["…","…","…"]}`);
    if (!r || !Array.isArray(r.points)) throw new Error('رد غير صالح');
    deckWorking().points = r.points.slice(0, 3).map(String);
    render(); toast('اقترح المساعد ثلاث نقاط. عدّلها حسب الحاجة');
  } catch (e) { toast(`تعذّر الاقتراح: ${(e && (e.message || e.code)) || ''}`); }
  btn.disabled = false;
}

/* ---------------- agent: briefing, recommendations and actions on the site ---------------- */
// The briefing and recommendations are computed locally from the project data, so they
// show instantly and work without Claude. Typed requests go to Claude with a small set
// of page tools (read pending items, tick items done, add notes, prepare a minutes draft).
const ag = { turns: [], api: [], status: 'idle', draft: '', ctl: null, counted: false, open: false, more: false, local: null };
const daysSince = (s) => s ? Math.max(0, dayDiffStr(s, todayStr())) : 0;
function dayDiffStr(a, b) { const A = parse(a), B = parse(b); return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 864e5); }
const greeting = () => { const h = +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()); return h < 12 ? 'صباح الخير' : 'مساء الخير'; };
// Track leads: the agent names a directive's track instead of the person.
const TRACK_LEADS = [
  { name: 'مسار تقنيات الذكاء الاصطناعي والبيانات', leads: ['عمر العلماء'] },
  { name: 'مسار العمليات والدعم المؤسسي', leads: ['مريم الحمادي'] },
  { name: 'مسار الخدمات الحكومية', leads: ['محمد بن طليعة'] },
  { name: 'مسار بناء القدرات والتدريب', leads: ['عهود الرومي'] },
  { name: 'مسار العمل الحكومي الاستراتيجي', leads: ['هدى الهاشمي'] },
];
const trackList = () => (Array.isArray(state.tracks) && state.tracks.length ? state.tracks : TRACK_LEADS);
const trackOf = (owner) => (trackList().find((t) => t.leads.some((n) => String(owner).includes(n))) || {}).name || '';
const tracksOfItem = (i) => [...new Set(splitOwners(i.owners).map(trackOf).filter(Boolean))];
const splitOwners = (s) => String(s || '').split(/\s*(?:\+|،|,| و(?=معالي|سعادة|د\.))\s*/).map((x) => x.trim()).filter((x) => x.length > 2);

function projectSnapshot() {
  const { cur, list, idx } = currentStage();
  const pending = state.meetings.flatMap((m) => m.items.filter((i) => !isDone(i)).map((i) => ({ i, m })));
  const awaiting = state.meetings.filter((m) => !m.items.length && m.date && m.date <= todayStr());
  const tracks = {};
  pending.forEach(({ i }) => tracksOfItem(i).forEach((t) => { tracks[t] = (tracks[t] || 0) + 1; }));
  const topTrack = Object.entries(tracks).sort((a, b) => b[1] - a[1])[0];
  const daysLeft = cur ? Math.max(0, Math.ceil((endMs(cur) - Date.now()) / 864e5)) : 0;
  const oldest = pending.reduce((o, x) => (!o || (x.m.date || '9') < (o.m.date || '9')) ? x : o, null);
  const lActive = (state.launches || []).filter((l) => l.status !== 'announced');
  const lLate = lActive.filter(isOverdue), lReady = lActive.filter((l) => l.status === 'ready');
  const lMonth = lActive.filter((l) => l.month === thisYM());
  return { cur, idx, stages: list, pending, awaiting, topTrack, daysLeft, oldest, lLate, lReady, lMonth };
}

function agentRecs(s) {
  const recs = [];
  if (s.awaiting.length) recs.push({ icon: 'upload', t: `${s.awaiting.length} اجتماعات بانتظار رفع محاضرها`, d: s.awaiting.slice(0, 3).map((m) => `${COMMITTEES[m.committee]} · ${meetingLabel(m)}`).join('، '), act: 'ag-goto', view: 'minutes', label: 'ارفع المحاضر', s: `ارفع ${s.awaiting.length} محاضر` });
  if (s.lLate.length || s.lReady.length) {
    const l = s.lLate[0] || s.lReady[0];
    recs.push({ icon: 'spark', t: s.lLate.length ? `${s.lLate.length} إطلاقات تجاوزت موعدها` : `${s.lReady.length} إطلاقات جاهزة بانتظار تحديد الموعد`, d: l.title, act: 'ag-goto', view: 'launches', label: 'افتح الإطلاقات', s: s.lLate.length ? `${s.lLate.length} إطلاقات متأخرة` : `${s.lReady.length} إطلاقات بلا موعد` });
  }
  if (s.oldest && daysSince(s.oldest.m.date) > 21) {
    const n = s.pending.filter((x) => x.m === s.oldest.m).length;
    recs.push({ icon: 'note', t: `${n} توجيهات معلّقة منذ ${daysSince(s.oldest.m.date)} يوماً`, d: `${COMMITTEES[s.oldest.m.committee]} · ${meetingLabel(s.oldest.m)}`, act: 'ag-ask', q: `جهّز رسالة متابعة رسمية مختصرة للتوجيهات المعلّقة من ${meetingLabel(s.oldest.m)} لـ${COMMITTEES[s.oldest.m.committee]}، مجمّعة حسب أصحاب العلاقة.`, label: 'جهّز رسالة متابعة', s: `متابعة ${meetingLabel(s.oldest.m)} (${n})` });
  }
  if (s.topTrack && s.topTrack[1] > 1) recs.push({ icon: 'user', t: `${s.topTrack[0]}: ${s.topTrack[1]} توجيهات معلّقة`, d: 'المسار الأكثر توجيهات معلّقة', act: 'ag-ask', q: `ما التوجيهات المعلّقة على ${s.topTrack[0]}؟ وجهّز لي رسالة متابعة قصيرة للمسار.`, label: 'اعرض وجهّز متابعة', s: `${s.topTrack[0].replace(/^مسار\s+/, '')} · ${s.topTrack[1]}` });
  if (s.cur && s.daysLeft <= 30) recs.push({ icon: 'spark', t: `${s.daysLeft} يوماً على نهاية ${s.cur.name}`, d: s.cur.title || '', act: 'ag-ask', q: `لخّص وضع ${s.cur.name} (${s.cur.title}): ما أُنجز من توجيهات وما زال معلّقاً، وما الذي يجب أن نركّز عليه قبل نهايتها.`, label: 'لخّص الوضع', s: 'لخّص وضع المرحلة' });
  const nat = meetingsOf('national'); const next = nat.reduce((n, m) => Math.max(n, m.items.length ? m.number || 0 : 0), 0) + 1;
  recs.push({ icon: 'doc', t: `حضّر محضر الاجتماع ${ORD[next] || next} للجنة الوطنية`, d: 'من ملاحظاتك أو صورها في مساحة العمل', act: 'ag-minutes', c: 'national', label: 'ابدأ المحضر', s: `المحضر ${ORD[next] || next}` });
  return recs.slice(0, 5);
}

function briefingText(s) {
  const parts = [`${greeting()}.`];
  if (s.cur) parts.push(`نحن في ${s.cur.name} (${s.cur.title})، ويتبقى ${s.daysLeft} يوماً على نهايتها.`);
  parts.push(s.pending.length ? `لديك ${s.pending.length} توجيهاً معلّقاً${s.awaiting.length ? ` و${s.awaiting.length} اجتماعات بانتظار محاضرها` : ''}.` : 'لا توجد توجيهات معلّقة حالياً.');
  if (s.lMonth.length) parts.push(`وهذا الشهر ${s.lMonth.length} إطلاقات لم يُعلن عنها بعد.`);
  return parts.join(' ');
}

const AG_SUGGEST = ['ما الذي يجب أن أركّز عليه هذا الأسبوع؟', 'ما وضع إطلاقات نوفمبر؟', 'جهّز ملخصاً للقيادة عن وضع المشروع', 'أضف فكرة مشروع وصدّر قالبها'];

const AG_STEP = { get_project_status: 'قرأ حالة المشروع', get_pending_items: 'راجع التوجيهات', mark_items_done: 'حدّد بنوداً كمنجزة', add_item_note: 'أضاف ملاحظة', prepare_minutes_draft: 'جهّز المحضر', open_meeting: 'فتح الاجتماع', get_launches: 'راجع الإطلاقات', update_launch: 'حدّث إطلاقاً', list_ideas: 'راجع بنك الأفكار', add_idea: 'أضاف فكرة', export_project_template: 'جهّز القالب', prepare_committee_deck: 'جهّز عرض الاجتماع' };
function agentResult() {
  const k = ag.turns.length - 1; const t = ag.turns[k]; if (!t || t.role !== 'assistant') return '';
  const q = ag.turns[k - 1] ? ag.turns[k - 1].text : '';
  const busy = ag.status === 'running';
  return `<div class="ag-res ${busy ? 'busy' : ''} ${ag.more ? 'more' : ''}" id="agRes">
    <div class="ag-q"><span>${esc(q)}</span>${busy ? '<button class="link" data-act="ag-stop">إيقاف</button>' : `<button class="icon-btn sm" data-act="ag-clear" aria-label="إغلاق">✕</button>`}</div>
    <div class="ag-steps">${(t.steps || []).map((x) => `<span class="step-pill">${ICON.check}${esc(x)}</span>`).join('')}${busy ? `<span class="step-pill live"><span class="dots"><i></i><i></i><i></i></span>${t.text ? 'يكتب' : (t.steps || []).length ? 'يعمل' : 'يفكّر'}</span>` : ''}</div>
    ${t.text ? `<div class="ag-text">${fmtAgent(t.text)}</div>` : ''}
    ${(t.actions || []).map((a, j) => actionCard(a, k, j)).join('')}
    ${!busy && t.text ? `<div class="ag-res-f"><button class="link" data-act="ag-more">${ag.more ? 'أقل' : 'عرض كامل الرد'}</button><button class="link" data-act="ag-copy" data-k="${k}">نسخ</button><button class="link" data-act="ag-speak" data-k="${k}">استمع</button><button class="link" data-act="ag-open-ask">طلب آخر</button></div>` : ''}
  </div>`;
}
// Direct actions: each tile does the job itself (draft, file, export, page), no chat needed.
function agentActions(s) {
  const out = [];
  if (s.topTrack) out.push({ act: 'ag-follow', k: 'track:' + s.topTrack[0], icon: 'note', t: 'جهّز رسالة متابعة للمسارات', d: 'اختر المسار ← رسالة جاهزة للإرسال' });
  out.push({ act: 'ag-deck', icon: 'deck', t: 'عرض الاجتماع القادم', d: 'عرض اللجنة الوطنية PowerPoint' });
  out.push({ act: 'ag-idea', icon: 'bulb', t: 'أضف فكرة مشروع', d: 'إلى بنك الأفكار' });
  return out;
}
function agentTile(a, i) {
  const inner = `<span class="at-ico">${ICON[a.icon] || ICON.spark}</span><b>${esc(a.t)}</b><small>${esc(a.d)}</small>`;
  return a.upload ? `<label class="atile" style="--i:${i}" for="docxInput" tabindex="0">${inner}</label>`
    : `<button class="atile" style="--i:${i}" data-act="${a.act}" ${a.k ? `data-k="${esc(a.k)}"` : ''} ${a.c ? `data-c="${a.c}"` : ''}>${inner}</button>`;
}
const canVoice = () => !!(cap.dictation || window.SpeechRecognition || window.webkitSpeechRecognition);
function agentPanel() {
  const s = projectSnapshot();
  const eng = engine();
  const busy = ag.status === 'running';
  return `
  <section class="agent big ${busy ? 'busy' : ''} ${voice.on ? 'listening' : ''}" aria-label="المساعد">
    <span class="engine ${eng ? 'on' : ''}">${eng === 'claude' ? 'Claude' : eng === 'api' ? 'Claude API' : 'بدون اتصال'}</span>
    <button class="ag-icon" data-act="${canVoice() ? 'ag-voice' : 'ag-focus'}" aria-label="${canVoice() ? 'تحدّث إلى المساعد' : 'اسأل المساعد'}"><img src="assets/agent-icon.png" alt=""></button>
    <h2 class="ag-title">${esc(greeting())}، كيف أساعدك اليوم؟</h2>
    <p class="ag-sub" id="agSub">${voice.on ? 'أستمع إليك…' : 'اختر إجراءً، أو اكتب أو تحدّث بطلبك.'}</p>
    <form class="ag-ask" onsubmit="return false">
      <input id="ag-input" autocomplete="off" placeholder="أنا مساعدك، اكتب أو تحدّث.." value="${esc(ag.draft)}" aria-label="اطلب من المساعد">
      ${canVoice() ? `<button type="button" class="mic ${voice.on ? 'on' : ''}" id="ag-mic" data-act="ag-voice" aria-label="${voice.on ? 'إيقاف الاستماع' : 'تحدّث'}" title="تحدّث">${ICON.mic}</button>` : ''}
      <button type="button" class="btn primary" data-act="ag-send" ${busy ? 'disabled' : ''}>أرسل</button>
    </form>
    <div class="ag-tiles">${agentActions(s).map(agentTile).join('')}</div>
    ${agentLocal()}
    ${agentResult()}
  </section>`;
}

// follow-up drafts built from the tracker, ready to copy, email or listen to
function followupDraft(key) {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const pend = projectSnapshot().pending;
  const items = kind === 'track' ? pend.filter(({ i }) => tracksOfItem(i).includes(id)) : pend.filter(({ m }) => m.id === id);
  const m0 = kind === 'meeting' ? findMeeting(id) : null;
  const to = kind === 'track' ? id : COMMITTEES[m0.committee];
  const subject = kind === 'track' ? `متابعة التوجيهات المعلّقة – ${id}` : `متابعة توجيهات ${meetingLabel(m0)} – ${COMMITTEES[m0.committee]}`;
  const lines = items.slice(0, 15).map(({ i, m }, n) => `${n + 1}. ${i.topic.replace(/\.$/, '')}: ${i.directive}${kind === 'track' ? ` (${meetingLabel(m)})` : ''}`);
  const body = ['السلام عليكم ورحمة الله وبركاته،', '', `تحية طيبة وبعد، نود متابعة التوجيهات المعلّقة الخاصة بـ${to}:`, '', ...lines, '', 'نأمل التكرم بتزويدنا بآخر المستجدات والموعد المتوقع للإنجاز.', '', 'وتفضلوا بقبول فائق الاحترام،', 'فريق مشروع الذكاء الاصطناعي المساعد'].join('\n');
  return { key, title: subject, subject, text: body, n: items.length };
}
const trackCounts = () => { const p = projectSnapshot().pending; return trackList().map((t) => [t.name, p.filter(({ i }) => tracksOfItem(i).includes(t.name)).length]); };
// Refresh the home page's figures (KPIs, pending counts, follow-up draft) without a full re-render.
function refreshDash() {
  if (route() !== 'dashboard') return;
  const tpl = document.createElement('div'); tpl.innerHTML = viewDashboard();
  const k = $('.kpis'), k2 = tpl.querySelector('.kpis'); if (k && k2) k.replaceWith(k2);
  const fresh = tpl.querySelectorAll('.pend-card');
  document.querySelectorAll('.pend-card').forEach((c, i) => {
    const f = fresh[i]; if (!f) return;
    c.querySelector('.count').textContent = f.querySelector('.count').textContent;
    c.querySelectorAll('.pend-group').forEach((g) => { const sp = g.querySelector('.pend-gh span'); if (sp) sp.textContent = g.querySelectorAll('li').length; });
    if (!c.querySelector('.pend-group')) c.querySelector('.pend-body').replaceWith(f.querySelector('.pend-body'));
  });
  if (ag.local) { ag.local = followupDraft(ag.local.key); const l = $('.ag-local'); if (l) { const d = document.createElement('div'); d.innerHTML = agentLocal(); l.replaceWith(d.firstElementChild); } }
}
function agentLocal() {
  const d = ag.local; if (!d) return '';
  return `<div class="ag-res ag-local">
    <div class="ag-q"><span>${esc(d.title)}${d.n ? ` · ${d.n} بنود` : ''}</span><button class="icon-btn sm" data-act="ag-local-close" aria-label="إغلاق">✕</button></div>
    ${d.key.startsWith('track:') ? `<div class="ag-tracks" role="group" aria-label="المسار">${trackCounts().map(([t, n]) => `<button class="chip ${d.key === 'track:' + t ? 'on' : ''}" data-act="ag-follow" data-k="${esc('track:' + t)}">${esc(t.replace(/^مسار\s+/, ''))} <b>${n}</b></button>`).join('')}</div>` : ''}
    <textarea id="agLocalText" rows="9" dir="rtl">${esc(d.text)}</textarea>
    <div class="ag-acts">
      <button class="btn primary sm" data-act="ag-mail">${ICON.mail} فتح في البريد</button>
      <button class="btn sm" data-act="ag-local-copy">نسخ</button>
      <button class="btn sm" data-act="ag-speak" data-src="local">${ICON.speaker} استمع</button>
      ${engine() ? '<button class="btn sm" data-act="ag-refine">حسّنها مع Claude</button>' : ''}
    </div>
  </div>`;
}

// voice: claude.ai dictation when offered, else the browser's speech recognition
const voice = { on: false, base: '', rec: null };
function setVoice(on) {
  voice.on = on;
  $('.agent')?.classList.toggle('listening', on);
  const b = $('#ag-mic'); if (b) b.classList.toggle('on', on);
  const sub = $('#agSub'); if (sub) sub.textContent = on ? 'أستمع إليك…' : 'اختر إجراءً، أو اكتب أو تحدّث بطلبك.';
}
function voiceText(t, final) {
  const i = $('#ag-input'); const v = (voice.base + ' ' + t).trim();
  if (final) voice.base = v;
  if (i) i.value = v; ag.draft = v;
}
function voiceDone() {
  setVoice(false);
  const q = (ag.draft || '').trim(); if (q) agentSubmit(q);
}
function wireDictation(d) {
  d.onPartial(({ text }) => voiceText(text, false));
  d.onFinal(({ text }) => voiceText(text, true));
  d.onState(({ state: st, reason }) => {
    if (st === 'listening') setVoice(true);
    if (st === 'idle') { if (reason === 'not_granted') { toast('لم يُسمح باستخدام الميكروفون'); setVoice(false); } else voiceDone(); }
  });
}
function voiceToggle() {
  if (cap.dictation) {
    if (voice.on || cap.dictation.active()) { cap.dictation.stop().catch(() => {}); return; }
    voice.base = ''; ag.draft = '';
    cap.dictation.start({ language: 'ar-AE' }).catch((e) => { setVoice(false); if (e && e.code === 'not_granted') toast('لم يُسمح باستخدام الميكروفون'); else if (e && e.code !== 'dismissed') toast('تعذّر تشغيل الإملاء الصوتي'); });
    setVoice(true); return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  if (voice.rec) { voice.rec.stop(); return; }
  const r = new SR(); voice.rec = r; voice.base = ''; ag.draft = '';
  r.lang = 'ar-AE'; r.interimResults = true; r.continuous = false;
  r.onresult = (e) => { let fin = '', tmp = ''; for (let k = e.resultIndex; k < e.results.length; k++) (e.results[k].isFinal ? (fin += e.results[k][0].transcript) : (tmp += e.results[k][0].transcript)); if (fin) voiceText(fin, true); else voiceText(tmp, false); };
  r.onerror = (e) => { if (e.error === 'not-allowed') toast('لم يُسمح باستخدام الميكروفون'); };
  r.onend = () => { voice.rec = null; voiceDone(); };
  try { r.start(); setVoice(true); } catch { voice.rec = null; }
}
function speak(text) {
  text = String(text || '').replace(/[*#_`>]/g, '').slice(0, 2000); if (!text) return;
  if (cap.tts) { cap.tts.speak(text).catch((e) => { if (e && e.code === 'not_granted') toast('القراءة الصوتية غير مفعّلة'); }); return; }
  if (window.speechSynthesis) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'ar-AE'; speechSynthesis.speak(u); return; }
  toast('القراءة الصوتية غير متاحة هنا');
}

// typed or spoken requests: simple commands run directly; anything else goes to Claude
function localIntent(q) {
  const s = projectSnapshot();
  const words = q.split(/\s+/).map((w) => w.replace(/^(ل|و|ب)?(ل)?/, '')).filter((w) => w.length > 3);
  const score = (t) => (t.leads.some((n) => q.includes(n)) ? 9 : 0) + t.name.replace(/^مسار\s+/, '').split(/\s+/).filter((w) => w.length > 3 && words.some((x) => x === w || x === w.replace(/^ال/, '') || ('ال' + x) === w || x.includes(w))).length;
  const tr = trackList().map((t) => [t, score(t)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (/متابع/.test(q)) {
    if (tr) return () => openFollowup('track:' + tr.name);
    if (s.topTrack) return () => openFollowup('track:' + s.topTrack[0]);
  }
  if (/صد[ّ]?ر.*إطلاق|إطلاق.*(باوربوينت|pptx|powerpoint|بوربوينت)/i.test(q)) return () => runAction('ag-lpptx');
  if (/عرض.*(اجتماع|لجنة)|(اجتماع|لجنة).*عرض/.test(q)) return () => runAction('ag-deck');
  if (/(حض|جه|اكتب).*محضر/.test(q)) return () => runAction('ag-minutes', { c: /وزار/.test(q) ? 'ministry' : 'national' });
  if (/فكر/.test(q) && /(أضف|اضف|جديد)/.test(q)) return () => ideaModal();
  if (/إطلاق|اطلاق/.test(q)) return () => { location.hash = '#launches'; };
  if (/محاضر|توجيه/.test(q)) return () => { location.hash = '#minutes'; };
  return null;
}
function agentSubmit(q) {
  q = String(q || '').trim(); if (!q) return;
  const eng = engine(); const fn = localIntent(q);
  if (!eng) { if (fn) { ag.draft = ''; fn(); } else toast('اربط Claude من الإعدادات للطلبات المفتوحة، أو اختر أحد الإجراءات'); return; }
  agentAsk(q);
}
function openFollowup(key) {
  ag.local = followupDraft(key); ag.turns = []; ag.api = [];
  if (route() !== 'dashboard') location.hash = '#dashboard'; else render();
  setTimeout(() => $('.ag-local')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}
function runAction(act, o = {}) {
  if (act === 'ag-minutes') { ws.task = 'minutes'; ws.committee = o.c || 'national'; seedMeetingFields(true); saveDraft(); location.hash = '#workspace'; }
  if (act === 'ag-deck') { ws.task = 'committee'; saveDraft(); location.hash = '#workspace'; }
  if (act === 'ag-lpptx') { location.hash = '#launches'; setTimeout(() => { const b = $('[data-act=l-pptx]'); if (b) exportLaunchesPptx(b); }, 1200); }
}
function animateCounts() {
  if (ag.counted) return; ag.counted = true;
  const els = [...document.querySelectorAll('.agent [data-count]')];
  if (!els.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach((e) => { e.textContent = e.dataset.count; }); return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3); els.forEach((el) => { el.textContent = Math.round(+el.dataset.count * e); }); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// light formatting for agent replies: paragraphs, bullet lists, **bold**
function fmtAgent(t) {
  const lines = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n/);
  let html = '', inList = false;
  for (const l of lines) {
    const m = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (l.trim()) html += `<p>${l.replace(/^#+\s*/, '')}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

function actionCard(a, k, j) {
  if (a.type === 'done') return `<div class="act-card ok">${ICON.check}<span>${a.undone ? 'تم التراجع عن' : 'تم تحديد'} ${a.ids.length} ${a.ids.length === 1 ? 'توجيه' : 'توجيهات'} ${a.undone ? '' : 'كمنجزة'}: ${esc(a.label)}</span>${a.undone ? '' : `<button class="link" data-act="ag-undo" data-k="${k}" data-j="${j}">تراجع</button>`}</div>`;
  if (a.type === 'note') return `<div class="act-card">${ICON.note}<span>أُضيفت ملاحظة على «${esc(a.label)}»</span></div>`;
  if (a.type === 'launch') return `<div class="act-card ok">${ICON.check}<span>${esc(a.label)}</span><button class="link" data-act="ag-goto" data-view="launches">الإطلاقات</button></div>`;
  if (a.type === 'export') return `<div class="act-card">${ICON.doc}<span>قالب المشروع «${esc(a.label)}» جاهز</span><button class="btn sm primary" data-act="ag-export" data-id="${a.id}">تنزيل القالب</button></div>`;
  if (a.type === 'open') return `<div class="act-card">${ICON.doc}<span>${esc(a.label)}</span><button class="btn sm" data-act="ag-open" data-k="${k}" data-j="${j}">افتح</button></div>`;
  return '';
}

/* tools Claude can call on this page */
function findItemsByIds(ids) {
  const want = new Set((ids || []).map(String)); const out = [];
  state.meetings.forEach((m) => m.items.forEach((i) => { if (want.has(i.id)) out.push({ i, m }); }));
  return out;
}
const AG_TOOLS = [
  {
    name: 'get_project_status',
    description: 'Returns the current project stage, days left in it, all eight stages, counts of pending and done directives per committee, meetings still waiting for their minutes, and the latest news headlines.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const s = projectSnapshot();
      const by = (c) => { const its = meetingsOf(c).flatMap((m) => m.items); return { pending: its.filter((i) => !isDone(i)).length, done: its.filter(isDone).length }; };
      return {
        today: todayStr(), stage: s.cur && { name: s.cur.name, title: s.cur.title, start: s.cur.start, end: s.cur.end, days_left: s.daysLeft, number: s.idx + 1, of: s.stages.length },
        stages: s.stages.map((x) => `${x.name}: ${x.title} (${x.start} → ${x.end})`),
        national: by('national'), ministry: by('ministry'),
        meetings_awaiting_minutes: s.awaiting.map((m) => `${COMMITTEES[m.committee]} – ${meetingLabel(m)} (${m.date})`),
        news: [...(news.uae || []), ...(news.global || [])].slice(0, 6).map((n) => n.title),
        launches: { total: state.launches.length, announced: state.launches.filter((l) => l.status === 'announced').length, overdue: state.launches.filter(isOverdue).map((l) => l.title), this_month: s.lMonth.map((l) => l.title) },
        ideas_bank: state.ideas.length,
      };
    },
  },
  {
    name: 'get_pending_items',
    description: 'Lists pending (not done) meeting directives with their id, committee, meeting, topic, directive, owners, track and days open. Optional filters: committee ("national" or "ministry"), track (part of a track name, e.g. "الخدمات الحكومية"), owner (part of a name), text (words in topic or directive). Use before marking items done or writing follow-ups.',
    schema: { type: 'object', properties: { committee: { type: 'string', enum: ['national', 'ministry'] }, track: { type: 'string' }, owner: { type: 'string' }, text: { type: 'string' } }, additionalProperties: false },
    run(inp) {
      const owner = String(inp.owner || '').trim(), text = String(inp.text || '').trim(), track = String(inp.track || '').trim();
      return projectSnapshot().pending
        .filter(({ m }) => !inp.committee || m.committee === inp.committee)
        .filter(({ i }) => !owner || i.owners.includes(owner))
        .filter(({ i }) => !track || tracksOfItem(i).some((t) => t.includes(track)))
        .filter(({ i }) => !text || `${i.topic} ${i.directive}`.includes(text))
        .slice(0, 60)
        .map(({ i, m }) => ({ id: i.id, committee: COMMITTEES[m.committee], meeting: meetingLabel(m), meeting_date: m.date, topic: i.topic, directive: i.directive, owners: i.owners, track: tracksOfItem(i).join(' + ') || undefined, days_open: daysSince(m.date), note: i.note || undefined }));
    },
  },
  {
    name: 'mark_items_done',
    description: 'Marks the given directives as done (ticked) in the minutes tracker. Only call it when the user clearly asked to mark specific items done; get their ids from get_pending_items first. The user can undo it.',
    schema: { type: 'object', properties: { item_ids: { type: 'array', items: { type: 'string' } } }, required: ['item_ids'], additionalProperties: false },
    run(inp, acts) {
      const found = findItemsByIds(inp.item_ids).filter(({ i }) => !isDone(i));
      if (!found.length) throw new Error('No pending items with those ids');
      found.forEach(({ i }) => { i.status = 'done'; i.doneDate = todayStr(); });
      acts.push({ type: 'done', ids: found.map(({ i }) => i.id), label: found.map(({ i }) => i.topic).join('، ') });
      persistQuiet();
      return { marked_done: found.map(({ i }) => i.topic) };
    },
  },
  {
    name: 'add_item_note',
    description: 'Adds or replaces the follow-up note on one directive (for example "تم التواصل، بانتظار العرض"). Only when the user asked for it.',
    schema: { type: 'object', properties: { item_id: { type: 'string' }, note: { type: 'string' } }, required: ['item_id', 'note'], additionalProperties: false },
    run(inp, acts) {
      const [hit] = findItemsByIds([inp.item_id]);
      if (!hit) throw new Error('No item with that id');
      hit.i.note = String(inp.note || '').slice(0, 500);
      acts.push({ type: 'note', label: hit.i.topic });
      persistQuiet();
      return { ok: true };
    },
  },
  {
    name: 'prepare_minutes_draft',
    description: 'Prepares the workspace to draft the minutes of a committee meeting: sets the committee, meeting number and any notes the user gave, and gives the user a button to open it. Use when the user wants to write or issue meeting minutes.',
    schema: { type: 'object', properties: { committee: { type: 'string', enum: ['national', 'ministry'] }, meeting_number: { type: 'integer' }, notes: { type: 'string' } }, required: ['committee'], additionalProperties: false },
    run(inp, acts) {
      ws.task = 'minutes'; ws.committee = inp.committee === 'ministry' ? 'ministry' : 'national';
      seedMeetingFields(true);
      if (inp.meeting_number) ws.number = String(inp.meeting_number);
      if (inp.notes) ws.notes = String(inp.notes);
      ws.result = null; ws.status = 'idle'; saveDraft();
      acts.push({ type: 'open', view: 'workspace', label: `محضر ${COMMITTEES[ws.committee]} · الاجتماع ${ORD[+ws.number] || ws.number} جاهز للإعداد في مساحة العمل` });
      return { ok: true, meeting_number: ws.number };
    },
  },
  {
    name: 'get_launches',
    description: 'Lists the launches and announcements calendar: id, title, month, date, status (planned, prep, ready, scheduled, announced), status note, group and whether it is overdue.',
    schema: { type: 'object', properties: { status: { type: 'string', enum: LST.map(([k]) => k) } }, additionalProperties: false },
    run(inp) { return state.launches.filter((l) => !inp.status || l.status === inp.status).map((l) => ({ id: l.id, title: l.title, month: l.month, date: l.date, status: l.status, status_label: LSTN[l.status], note: l.note, group: l.group, owner: l.owner, overdue: isOverdue(l) })); },
  },
  {
    name: 'update_launch',
    description: 'Updates one launch: its status, status note and/or date. Only when the user asked. Get the id from get_launches.',
    schema: { type: 'object', properties: { launch_id: { type: 'string' }, status: { type: 'string', enum: LST.map(([k]) => k) }, note: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['launch_id'], additionalProperties: false },
    run(inp, acts) {
      const l = state.launches.find((x) => x.id === String(inp.launch_id)); if (!l) throw new Error('No launch with that id');
      if (inp.status && LSTN[inp.status]) l.status = inp.status;
      if (typeof inp.note === 'string') l.note = inp.note.slice(0, 200);
      if (/^\d{4}-\d{2}-\d{2}$/.test(inp.date || '')) { l.date = inp.date; l.month = inp.date.slice(0, 7); }
      acts.push({ type: 'launch', label: `${l.title}: ${LSTN[l.status]}${l.date ? ' · ' + fmtDate(l.date) : ''}` });
      persistQuiet(); return { ok: true, status: l.status };
    },
  },
  {
    name: 'list_ideas',
    description: 'Lists the ideas and projects bank: id, type, status, name, what it is, outputs, owner and dates.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run() { return state.ideas.map((x) => ({ id: x.id, type: x.type, status: x.status, name: x.name, name_en: x.name_en, what: x.what, outputs: x.outputs, owner: x.owner, start: x.start, end: x.end })); },
  },
  {
    name: 'add_idea',
    description: 'Adds an idea or project to the ideas bank with the project-card fields (Arabic name, English name, what it is, up to three outputs, start and end dates, responsible entity). Write formal Arabic; leave unknown fields empty rather than inventing figures or entities.',
    schema: { type: 'object', properties: { type: { type: 'string', enum: ['idea', 'project'] }, name: { type: 'string' }, name_en: { type: 'string' }, what: { type: 'string' }, outputs: { type: 'array', items: { type: 'string' } }, start: { type: 'string' }, end: { type: 'string' }, owner: { type: 'string' } }, required: ['name'], additionalProperties: false },
    run(inp, acts) {
      const x = { id: uid('i'), type: inp.type === 'project' ? 'project' : 'idea', status: 'idea', name: String(inp.name).slice(0, 120), name_en: String(inp.name_en || ''), what: String(inp.what || ''), outputs: (Array.isArray(inp.outputs) ? inp.outputs : []).slice(0, 3).map(String), owner: String(inp.owner || ''), updated: new Date().toISOString() };
      if (/^\d{4}-\d{2}-\d{2}$/.test(inp.start || '')) x.start = inp.start; if (/^\d{4}-\d{2}-\d{2}$/.test(inp.end || '')) x.end = inp.end;
      state.ideas.push(x);
      acts.push({ type: 'export', id: x.id, label: x.name });
      persistQuiet(); return { ok: true, id: x.id };
    },
  },
  {
    name: 'export_project_template',
    description: 'Prepares the official one-slide Project Template (PowerPoint) for an idea or project in the bank and gives the user a download button.',
    schema: { type: 'object', properties: { idea_id: { type: 'string' } }, required: ['idea_id'], additionalProperties: false },
    run(inp, acts) {
      const x = state.ideas.find((y) => y.id === String(inp.idea_id)); if (!x) throw new Error('No idea with that id');
      acts.push({ type: 'export', id: x.id, label: x.name }); return { ok: true };
    },
  },
  {
    name: 'prepare_followup',
    description: 'Builds a ready follow-up message for the pending directives of one track (track name, e.g. "مسار الخدمات الحكومية") or one meeting (meeting_id), and shows it to the user as a card with Email, Copy and Listen buttons. Prefer this over writing a follow-up message in your reply.',
    schema: { type: 'object', properties: { track: { type: 'string' }, meeting_id: { type: 'string' } }, additionalProperties: false },
    run(inp) {
      let key = '';
      if (inp.meeting_id && findMeeting(inp.meeting_id)) key = 'meeting:' + inp.meeting_id;
      else if (inp.track) { const t = trackList().find((x) => x.name.includes(String(inp.track).replace(/^مسار\s+/, ''))); if (t) key = 'track:' + t.name; }
      if (!key) throw new Error('unknown track or meeting');
      ag.local = followupDraft(key);
      return { ok: true, items: ag.local.n, shown_to_user: true };
    },
  },
  {
    name: 'prepare_committee_deck',
    description: "Prepares the National Committee meeting presentation in the workspace (cover, agenda, launches calendar statuses, batch figures, points to consider, FedAI figures) for a meeting number and date, and gives the user a button to open it. Optionally replaces the three 'points to consider'.",
    schema: { type: 'object', properties: { meeting_number: { type: 'integer' }, date: { type: 'string', description: 'YYYY-MM-DD' }, points: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
    run(inp, acts) {
      ws.task = 'committee'; ws.deck = null; deckWorking();
      if (inp.meeting_number) ws.dnum = String(inp.meeting_number);
      if (/^\d{4}-\d{2}-\d{2}$/.test(inp.date || '')) ws.ddate = inp.date;
      if (Array.isArray(inp.points) && inp.points.length) ws.deck.points = inp.points.slice(0, 3).map(String);
      saveDraft();
      acts.push({ type: 'open', view: 'workspace', label: `عرض الاجتماع ${ORD[+ws.dnum] || ws.dnum} للجنة الوطنية جاهز للمراجعة والإنشاء في مساحة العمل` });
      return { ok: true, meeting_number: ws.dnum, date: ws.ddate };
    },
  },
  {
    name: 'open_meeting',
    description: 'Gives the user a button to open a specific meeting in the minutes tracker.',
    schema: { type: 'object', properties: { committee: { type: 'string', enum: ['national', 'ministry'] }, meeting_number: { type: 'integer' } }, required: ['committee', 'meeting_number'], additionalProperties: false },
    run(inp, acts) {
      const m = meetingsOf(inp.committee).find((x) => x.number === Number(inp.meeting_number));
      if (!m) throw new Error('Meeting not found');
      acts.push({ type: 'open', view: 'minutes', committee: m.committee, mid: m.id, label: `${COMMITTEES[m.committee]} · ${meetingLabel(m)}` });
      return { ok: true };
    },
  },
];

// save without re-rendering mid-conversation (the reply re-renders at the end)
function persistQuiet() {
  state.updatedAt = new Date().toISOString(); ls.set(LS_STATE, state);
  if (ghOn()) { clearTimeout(saveTimer); saveTimer = setTimeout(() => ghSave().then(() => setSync('ok', 'تمت المزامنة ✓')).catch(() => setSync('err', 'تعذّرت المزامنة')), 1200); }
}

const AG_SYSTEM = `أجب باختصار شديد (جملة أو جملتان)، وفضّل تنفيذ المطلوب بالأدوات التي تعطي المستخدم أزراراً وبطاقات جاهزة (مثل prepare_followup وprepare_minutes_draft وprepare_committee_deck وexport_project_template) بدلاً من الشرح النصي الطويل.\n\nأنت «المساعد» في لوحة متابعة مشروع الذكاء الاصطناعي المساعد لحكومة دولة الإمارات (Agentic AI for UAE Government). يستخدمك فريق المشروع في وزارة شؤون مجلس الوزراء لمتابعة مراحل المشروع وتوجيهات اللجنة الوطنية للذكاء الاصطناعي المساعد ولجنة الوزارة، ولإعداد أعمالهم المتكررة.

- اكتب بالعربية الفصحى بأسلوب حكومي واضح ومختصر، واستخدم قوائم قصيرة عند الحاجة.
- اعتمد على الأدوات للاطلاع على البيانات الفعلية قبل الإجابة عن المراحل أو التوجيهات أو المحاضر، ولا تخمّن أرقاماً أو أسماء.
- نفّذ التغييرات (تحديد بند كمنجز، إضافة ملاحظة) فقط عندما يطلبها المستخدم صراحةً، ولا تقل إنك نفّذت شيئاً لم تنفّذه أداة.
- عند الإشارة إلى أصحاب العلاقة في إجاباتك، اذكر اسم المسار (حقل track، مثل «مسار الخدمات الحكومية») بدلاً من أسماء الأشخاص، ولا تذكر اسم الشخص إلا إذا لم يرتبط البند بمسار أو طلبه المستخدم صراحةً.\n- عند طلب رسالة متابعة أو ملخص، اكتب النص كاملاً جاهزاً للنسخ، موجّهاً إلى المسار المعني.
- عند طلب إعداد محضر، استخدم prepare_minutes_draft ثم أخبر المستخدم أن يفتح مساحة العمل.
- لعرض اجتماع اللجنة الوطنية استخدم prepare_committee_deck.
- للإطلاقات والإعلانات استخدم get_launches وupdate_launch. لبنك الأفكار استخدم list_ideas وadd_idea وexport_project_template (الأخيرة تعطي المستخدم زر تنزيل القالب).`;

async function agentRunSDK(signal, onText, acts) {
  let Anthropic;
  try { ({ default: Anthropic } = await import(SDK_URL)); }
  catch (e) { throw new Error(`تعذّر تحميل مكتبة Claude من الإنترنت (cdn.jsdelivr.net): ${e && e.message || e}`); }
  const client = new Anthropic({ apiKey: ls.get(LS_KEY), dangerouslyAllowBrowser: true });
  const tools = AG_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true }));
  let shown = '';
  for (let round = 0; round < 6; round++) {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5', max_tokens: 8000, system: AG_SYSTEM, tools,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      messages: ag.api,
    }, { signal });
    const base = shown;
    stream.on('text', (_d, snap) => { shown = base + (base ? '\n\n' : '') + snap; onText(shown); });
    let msg;
    try { msg = await stream.finalMessage(); }
    catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) throw { cancelled: true };
      if (e instanceof Anthropic.AuthenticationError) throw new Error('مفتاح Claude API غير صالح. حدّثه من الإعدادات.');
      if (e instanceof Anthropic.APIError) throw new Error(`خطأ من خدمة Claude (${e.status}): ${(e.error && e.error.error && e.error.error.message) || e.message}`);
      throw e;
    }
    ag.api.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason === 'refusal') throw new Error('اعتذر Claude عن هذا الطلب.');
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason === 'max_tokens' && uses.length) throw new Error('انقطع الرد قبل اكتماله. حاول بطلب أقصر.');
    if (msg.stop_reason !== 'tool_use' || !uses.length) return shown;
    const results = uses.map((u) => {
      const tool = AG_TOOLS.find((t) => t.name === u.name);
      try {
        const input = u.input && typeof u.input === 'object' ? u.input : {};
        if (!tool) throw new Error('Unknown tool');
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(runTool(tool, input, acts)) };
      } catch (err) { return { type: 'tool_result', tool_use_id: u.id, content: String(err.message || err), is_error: true }; }
    });
    ag.api.push({ role: 'user', content: results });
  }
  return shown;
}

async function agentRunSample(signal, onText, acts) {
  const lim = await cap.sample.limits().catch(() => null);
  const ctx = lim && lim.tools ? '' : `\n\nبيانات المشروع الحالية (JSON):\n${JSON.stringify({ status: AG_TOOLS[0].run(), pending: AG_TOOLS[1].run({}) }).slice(0, 60000)}`;
  const turns = [{ role: 'user', content: AG_SYSTEM + ctx }, ...ag.turns.filter((t) => t.text).map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', content: t.text }))];
  try {
    const { text } = await cap.sample(turns, {
      signal, onText: ({ text }) => onText(text),
      ...(lim && lim.tools ? { tools: AG_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema, execute: (input) => runTool(t, input || {}, acts) })) } : { cache: false }),
    });
    return text;
  } catch (e) {
    if (e && e.code === 'cancelled') throw { cancelled: true };
    const msg = { not_granted: 'لم يُسمح لهذه الصفحة باستخدام Claude. أعد تحميل الصفحة واختر «السماح».', rate_limited: 'تم بلوغ حد الاستخدام مؤقتاً. حاول لاحقاً.', refused: 'اعتذر Claude عن هذا الطلب.', session_expired: 'انتهت الجلسة. سجّل الدخول إلى claude.ai مرة أخرى.' }[e && e.code];
    throw new Error(msg || `تعذّر الاتصال بـ Claude (${(e && e.code) || 'unknown'}).`);
  }
}

let agReply = null;
function agLive() { const el = $('#agRes'); if (el) el.outerHTML = agentResult(); }
function runTool(tool, input, acts) {
  if (agReply) { (agReply.steps ||= []).push(AG_STEP[tool.name] || tool.name); agLive(); }
  return tool.run(input, acts);
}
async function agentAsk(q) {
  q = String(q || '').trim(); const eng = engine();
  if (!q || !eng || ag.status === 'running') return;
  if (route() !== 'dashboard') location.hash = '#dashboard';
  ag.turns.push({ role: 'user', text: q });
  const reply = { role: 'assistant', text: '', actions: [], steps: [] };
  agReply = reply;
  ag.turns.push(reply);
  if (eng === 'api') ag.api.push({ role: 'user', content: q });
  ag.draft = ''; ag.status = 'running'; ag.more = false; ag.open = false; ag.ctl = new AbortController();
  render();
  let last = 0;
  const onText = (t) => { reply.text = t; const now = Date.now(); if (now - last > 150) { last = now; agLive(); } };
  try {
    reply.text = eng === 'claude' ? await agentRunSample(ag.ctl.signal, onText, reply.actions) : await agentRunSDK(ag.ctl.signal, onText, reply.actions);
    if (!reply.text.trim()) reply.text = reply.actions.length ? 'تم.' : 'لم يصل رد. حاول مرة أخرى.';
  } catch (e) {
    if (e && e.cancelled) reply.text = (reply.text || '') + (reply.text ? '\n\n' : '') + '(أُوقف)';
    else reply.text = (reply.text ? reply.text + '\n\n' : '') + '⚠ ' + ((e && e.message) || 'حدث خطأ غير متوقع.');
    if (eng === 'api' && ag.api.length && ag.api[ag.api.length - 1].role === 'user' && typeof ag.api[ag.api.length - 1].content !== 'string') ag.api.pop();
  }
  ag.status = 'idle'; ag.ctl = null; agReply = null;
  render();
}

function typeBriefing() {
  const el = $('#agBrief'); if (!el || ag.typed) return;
  ag.typed = true;
  const full = el.dataset.full || '';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = full; return; }
  let i = 0;
  const step = () => { i = Math.min(full.length, i + 2); el.textContent = full.slice(0, i); if (i < full.length && document.body.contains(el)) setTimeout(step, 18); };
  step();
}

/* ---------------- modal ---------------- */
const dlg = $('#modal');
const form = $('#modalForm');
let onSubmit = null;
let confirmDel = null;
function openModal({ title, body, submit = 'حفظ', del, onSave }) {
  form.innerHTML = `
    <div class="m-h"><h3>${title}</h3><button type="button" class="icon-btn" data-close aria-label="إغلاق">✕</button></div>
    <div class="m-b">${body}</div>
    <div class="m-f">${del ? `<button type="button" class="btn danger" data-del>حذف</button>` : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-close>إلغاء</button>${submit ? `<button type="submit" class="btn primary">${submit}</button>` : ''}</div>`;
  onSubmit = onSave;
  form.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => dlg.close());
  const d = form.querySelector('[data-del]');
  if (d) d.onclick = () => {
    // two-step delete (no browser confirm dialog)
    if (confirmDel !== d) { confirmDel = d; d.textContent = 'تأكيد الحذف'; return; }
    dlg.close(); del();
  };
  confirmDel = null;
  dlg.showModal();
  const f = form.querySelector('input:not([type=hidden]),textarea,select'); if (f) f.focus();
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!onSubmit) return dlg.close();
  const data = Object.fromEntries(new FormData(form).entries());
  for (const k in data) if (typeof data[k] === 'string') data[k] = data[k].trim();
  const r = onSubmit(data, form);
  if (r !== false) dlg.close();
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

const field = (label, input, hint = '') => `<div class="field"><label>${label}</label>${input}${hint ? `<small>${hint}</small>` : ''}</div>`;
const inp = (name, val = '', attrs = '') => `<input name="${name}" id="f-${name}" value="${esc(val)}" ${attrs}>`;
const area = (name, val = '', attrs = '') => `<textarea name="${name}" id="f-${name}" ${attrs}>${esc(val)}</textarea>`;
const sel = (name, opts, val) => `<select name="${name}" id="f-${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${v}</option>`).join('')}</select>`;

function itemModal(m, it) {
  const isNew = !it;
  it ||= { topic: '', directive: '', owners: '', status: 'pending' };
  openModal({
    title: isNew ? 'إضافة توجيه' : 'تعديل التوجيه',
    body:
      field('الموضوع', inp('topic', it.topic, 'required')) +
      field('التوجيه', area('directive', it.directive)) +
      field('أصحاب العلاقة', inp('owners', it.owners)) +
      field('ملاحظات المتابعة', area('note', it.note || '', 'placeholder="مثال: تم التواصل مع الفريق، بانتظار العرض"'), 'اختياري'),
    del: isNew ? null : () => { m.items = m.items.filter((i) => i.id !== it.id); commit('تم حذف التوجيه'); },
    onSave(d) {
      Object.assign(it, { topic: d.topic, directive: d.directive, owners: d.owners });
      d.note ? it.note = d.note : delete it.note;
      if (isNew) { it.id = uid('i'); m.items.push(it); }
      commit(isNew ? 'تمت إضافة التوجيه' : 'تم حفظ التعديلات');
    },
  });
}

function meetingModal(m) {
  const isNew = !m;
  m ||= { committee: ui.committee, title: '', date: todayStr(), time: '', attendees: '', items: [] };
  const nextNum = meetingsOf(m.committee).reduce((n, x) => Math.max(n, x.number || 0), 0) + 1;
  openModal({
    title: isNew ? 'إضافة اجتماع' : 'تعديل بيانات الاجتماع',
    body:
      `<div class="row2">${field('اللجنة', sel('committee', COMMITTEES, m.committee))}${field('رقم الاجتماع', inp('number', m.number || (isNew ? nextNum : ''), 'type="number" min="1"'))}</div>` +
      field('عنوان الاجتماع', inp('title', m.title, 'placeholder="يُولَّد تلقائياً إن تُرك فارغاً"')) +
      `<div class="row2">${field('التاريخ', inp('date', m.date, 'type="date"'))}${field('الوقت', inp('time', m.time || ''))}</div>` +
      field('الحضور', area('attendees', m.attendees || '')),
    del: isNew ? null : () => { state.meetings = state.meetings.filter((x) => x.id !== m.id); commit('تم حذف الاجتماع'); },
    onSave(d) {
      const num = d.number ? Number(d.number) : null;
      const title = d.title || defaultTitle(d.committee, num);
      Object.assign(m, { committee: d.committee, title, date: d.date, time: d.time, attendees: d.attendees });
      num ? m.number = num : delete m.number;
      if (isNew) { m.id = uid('m'); state.meetings.push(m); }
      ui.committee = m.committee; ui.meeting[m.committee] = m.id; saveUI();
      commit(isNew ? 'تمت إضافة الاجتماع' : 'تم حفظ التعديلات');
    },
  });
}

function stagesModal() {
  const p = state.project;
  const row = (s, i) => `<div class="stage-row" data-row>
    ${field(i === 0 ? 'المرحلة' : '', inp('name', s.name, 'required'))}
    ${field(i === 0 ? 'الوصف' : '', inp('title', s.title || ''))}
    ${field(i === 0 ? 'من (أول الشهر)' : '', inp('start', s.start, 'type="date" required'))}
    ${field(i === 0 ? 'إلى (آخر الشهر)' : '', inp('end', s.end, 'type="date" required'))}
    <button type="button" class="btn sm danger" data-rm aria-label="حذف المرحلة">✕</button></div>`;
  openModal({
    title: 'مراحل المشروع',
    body: `<div class="hint">حسب نظام العمل: ثماني مراحل مدة كل منها ثلاثة أشهر. تبدأ كل مرحلة في أول يوم من الشهر وتنتهي في آخر يوم من الشهر المحدد (بتوقيت الإمارات).</div>
      <div id="stageRows">${state.stages.map(row).join('')}</div>
      <button type="button" class="btn sm" id="addStage">+ إضافة مرحلة</button>
      <div class="section-t">الإطار الزمني للمشروع</div>
      <div class="row2">${field('بداية المشروع', inp('pstart', p.start || '', 'type="date"'))}${field('نهاية المشروع', inp('pend', p.end || '', 'type="date"'))}</div>`,
    onSave(d, f) {
      const rows = [...f.querySelectorAll('[data-row]')].map((r) => ({
        name: r.querySelector('[name=name]').value.trim(), title: r.querySelector('[name=title]').value.trim(),
        start: r.querySelector('[name=start]').value, end: r.querySelector('[name=end]').value,
      })).filter((s) => s.name && s.start && s.end);
      const bad = rows.find((s) => s.end < s.start);
      if (bad) { toast(`تاريخ نهاية «${bad.name}» قبل بدايتها`); return false; }
      state.stages = rows.map((s, i) => ({ id: state.stages[i]?.id || uid('s'), ...s }));
      Object.assign(state.project, { start: d.pstart, end: d.pend });
      commit('تم حفظ المراحل');
    },
  });
  const wire = () => form.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => b.closest('[data-row]').remove());
  wire();
  $('#addStage').onclick = () => {
    const last = [...form.querySelectorAll('[data-row] [name=end]')].pop();
    $('#stageRows').insertAdjacentHTML('beforeend', row({ name: `المرحلة ${form.querySelectorAll('[data-row]').length + 1}`, start: last && last.value ? dayAfter(last.value) : todayStr(), end: '' }, 1));
    wire();
  };
}

function settingsModal() {
  const g = gh() || { owner: 'azalmulla', repo: 'website', branch: '', token: '' };
  const theme = ls.get('aai.theme') || 'auto';
  openModal({
    title: 'الإعدادات والبيانات',
    body: `
      ${field('المظهر', sel('theme', { auto: 'تلقائي (حسب الجهاز)', light: 'فاتح', dark: 'داكن' }, theme))}
      <div class="section-t">المزامنة مع GitHub</div>
      <div class="hint">بدون مزامنة تُحفظ تعديلاتك (المحاضر، علامات الإنجاز، المراحل) في هذا المتصفح فقط. لحفظها في المستودع وعرضها على كل الأجهزة، أدخل <b>Fine-grained token</b> بصلاحية <b>Contents: Read and write</b> على هذا المستودع فقط. يُحفظ الرمز على هذا الجهاز فقط.</div>
      <div class="row2">${field('المالك (Owner)', inp('owner', g.owner, 'dir="ltr"'))}${field('المستودع', inp('repo', g.repo, 'dir="ltr"'))}</div>
      <div class="row2">${field('الفرع (Branch)', inp('branch', g.branch, 'dir="ltr"'), 'اتركه فارغاً لاستخدام الفرع الافتراضي')}${field('الرمز (Token)', inp('token', g.token, 'type="password" dir="ltr" autocomplete="off" placeholder="github_pat_…"'))}</div>
      <div class="section-t">Claude لمساحة العمل</div>
      <div class="hint">عند فتح اللوحة من رابطها على claude.ai تعمل مساحة العمل بحسابك في Claude مباشرة. في النسخة المحلية (localhost) أضف مفتاح Claude API من console.anthropic.com. يُحفظ المفتاح على هذا الجهاز فقط، والاستخدام يُحتسب على حساب الـ API.</div>
      ${field('مفتاح Claude API', inp('apikey', ls.get(LS_KEY) || '', 'type="password" dir="ltr" autocomplete="off" placeholder="sk-ant-…"'))}
      <div class="section-t">النسخ الاحتياطي</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="exportBtn">تصدير البيانات (JSON)</button>
        <label class="btn sm" for="importFile">استيراد نسخة</label><input type="file" accept="application/json" id="importFile" hidden>
        <button type="button" class="btn sm" id="stagesBtn">تعديل المراحل</button>
        <button type="button" class="btn sm danger" id="resetBtn">استعادة بيانات المستودع</button>
      </div>
      <small style="color:var(--muted)">آخر تعديل: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString('ar-AE', { timeZone: TZ }) : '—'}</small>`,
    onSave(d) {
      ls.set('aai.theme', d.theme); applyTheme();
      d.apikey ? ls.set(LS_KEY, d.apikey) : ls.del(LS_KEY);
      if (route() === 'workspace') render();
      if (d.token) {
        ls.set(LS_GH, { owner: d.owner, repo: d.repo, branch: d.branch, token: d.token });
        setSync('', 'جارٍ الاتصال…');
        ghLoad().then((remote) => {
          if ((remote.updatedAt || '') > (state.updatedAt || '')) { state = remote; ls.set(LS_STATE, state); render(); setSync('ok', 'تم التحميل من GitHub'); }
          else commit('تم تفعيل المزامنة');
        }).catch(() => setSync('err', 'تعذّر الاتصال. تحقق من الرمز'));
      } else { ls.del(LS_GH); setSync(); toast('تم الحفظ'); }
    },
  });
  $('#exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
    a.download = `project-${todayStr()}.json`; a.click();
  };
  $('#importFile').onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(d.meetings)) throw 0;
      state = d; dlg.close(); commit('تم استيراد البيانات');
    } catch { toast('ملف غير صالح'); }
  };
  const rb = $('#resetBtn');
  rb.onclick = async () => {
    if (!rb.dataset.armed) { rb.dataset.armed = 1; rb.textContent = 'تأكيد: استبدال التعديلات المحلية'; return; }
    try { state = await fetchJSON(DATA_PATH); ls.del(LS_STATE); dlg.close(); render(); toast('تمت الاستعادة'); }
    catch { toast('تعذّر تحميل بيانات المستودع'); }
  };
}

function applyTheme() {
  const t = ls.get('aai.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/* ---------------- actions ---------------- */
app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const ds = t.dataset;
  switch (ds.act) {
    case 'toggle-item': {
      const it = findItem(ds.mid, ds.iid); if (!it) return;
      if (isDone(it)) { it.status = 'pending'; delete it.doneDate; it.untickedAt = todayStr(); } else { it.status = 'done'; it.doneDate = todayStr(); delete it.untickedAt; }
      // save without re-rendering the page, then update the row and counters in place
      commit(isDone(it) ? 'تم: أُنجز التوجيه' : 'أُعيد التوجيه إلى المعلّق', true);
      const row = t.closest('li'); if (row) row.classList.toggle('is-done', isDone(it));
      t.checked = isDone(it);
      // on the home page a ticked item leaves the pending list, and the figures update in place
      if (t.closest('.pend-card') && isDone(it) && row) {
        row.classList.add('leaving');
        setTimeout(() => { const g = row.closest('.pend-group'); row.remove(); if (g && !g.querySelector('li')) g.remove(); refreshDash(); }, 320);
      }
      if (route() === 'minutes') { const m = findMeeting(ds.mid); const d = m.items.filter(isDone).length; const b = $('.seg button[data-v="0"]'); if (b) b.textContent = `المعلّق (${m.items.length - d})`; }
      break;
    }
    case 'edit-item': itemModal(findMeeting(ds.mid), findItem(ds.mid, ds.iid)); break;
    case 'add-item': itemModal(findMeeting(ds.mid)); break;
    case 'add-meeting': meetingModal(); break;
    case 'edit-meeting': meetingModal(findMeeting(ds.mid)); break;
    case 'edit-stages': stagesModal(); break;
    case 'committee': ui.committee = ds.c; saveUI(); render(); break;
    case 'pick-meeting': ui.meeting[ui.committee] = ds.mid; saveUI(); render(); break;
    case 'show-done': ui.showDone = ds.v === '1'; saveUI(); render(); break;
    case 'target-meeting': importTarget = ds.mid; break;
    case 'goto-committee': ui.committee = ds.c; saveUI(); break;
    case 'goto-meeting': ui.committee = ds.c; ui.meeting[ds.c] = ds.mid; saveUI(); break;
    case 'ws-menu': ws.menu = !ws.menu; render(); if (ws.menu) $('.pm-item:not([disabled])')?.focus(); break;
    case 'ws-task': ws.task = ds.t; ws.menu = false; seedMeetingFields(false); saveDraft(); render(); break;
    case 'ws-committee': if (ws.committee !== ds.c) { ws.committee = ds.c; ws.result = null; ws.status = 'idle'; seedMeetingFields(true); saveDraft(); render(); } break;
    case 'ws-rmimg': URL.revokeObjectURL(ws.images[+ds.i].url); ws.images.splice(+ds.i, 1); render(); break;
    case 'ws-generate': generateMinutes(); break;
    case 'ws-stop': ws.ctl?.abort(); break;
    case 'ws-download': downloadMinutes(); break;
    case 'ws-save': saveMinutesToTracker(); break;
    case 'ws-copy': navigator.clipboard.writeText(minutesAsText()).then(() => toast('تم نسخ نص المحضر'), () => toast('تعذّر النسخ')); break;
    case 'ws-templates': templatesModal(); break;
    case 'open-settings': settingsModal(); break;
    case 'l-add': launchModal(); break;
    case 'l-reset': {
      if (!ui.lresetArm) { ui.lresetArm = true; render(); setTimeout(() => { if (ui.lresetArm) { ui.lresetArm = false; if (route() === 'launches') render(); } }, 5000); break; }
      ui.lresetArm = false;
      fetchJSON(DATA_PATH).then((d) => { if (!Array.isArray(d.launches)) throw 0; lSnap(); state.launches = d.launches; commit('أُعيدت الإطلاقات إلى حالاتها الأصلية'); })
        .catch(() => { toast('تعذّر تحميل البيانات الأصلية'); render(); });
      break;
    }
    case 'l-status': break;
    case 'l-pptx': exportLaunchesPptx(t); break;
    case 'l-edit': launchModal(state.launches.find((l) => l.id === ds.id)); break;
    case 'l-undo': { const prev = lHist.pop(); if (prev) { state.launches = JSON.parse(prev); commit('تم التراجع عن آخر تغيير'); } break; }
    case 'l-next': { const l = state.launches.find((x) => x.id === ds.id); const nx = l && lNext(l.status); if (nx) { lSnap(); l.status = nx; if (nx === 'announced') l.note = 'تم الإعلان'; commit(`${l.title}: ${LSTN[nx]}`); } break; }
    case 'l-filter': ui.lf = ds.f; saveUI(); render(); break;
    case 'l-view': ui.lview = ds.v; saveUI(); render(); break;
    case 'ev-add': eventModal(); break;
    case 'ev-open': eventModal(state.events.find((e) => e.id === ds.id)); break;
    case 'a-filter': { const o = ui.aoff || []; ui.aoff = o.includes(ds.cat) ? o.filter((x) => x !== ds.cat) : [...o, ds.cat]; saveUI(); render(); break; }
    case 'i-add': ideaModal(); break;
    case 'i-edit': ideaModal(state.ideas.find((x) => x.id === ds.id)); break;
    case 'i-export': exportIdea(ds.id); break;
    case 'i-filter': ui.if = ds.f; saveUI(); render(); break;
    case 'ag-export': exportIdea(ds.id); break;
    case 'dk-addrow': deckWorking().agenda.push({ topic: '', sub: '', presenter: '', minutes: '5' }); render(); break;
    case 'dk-rm': deckWorking().agenda.splice(+ds.i, 1); render(); break;
    case 'dk-suggest': suggestDeckPoints(t); break;
    case 'dk-build': generateDeck(); break;
    case 'ag-ask': agentAsk(ds.q); break;
    case 'ag-send': agentSubmit($('#ag-input')?.value); break;
    case 'ag-voice': voiceToggle(); break;
    case 'ag-follow': openFollowup(ds.k); break;
    case 'ag-deck': case 'ag-lpptx': runAction(ds.act); break;
    case 'ag-idea': ideaModal(); break;
    case 'ag-local-close': ag.local = null; render(); break;
    case 'ag-local-copy': navigator.clipboard.writeText($('#agLocalText').value).then(() => toast('تم النسخ'), () => toast('تعذّر النسخ')); break;
    case 'ag-mail': { const d = ag.local; const body = $('#agLocalText').value; location.href = `mailto:?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}`; break; }
    case 'ag-speak': speak(ds.src === 'local' ? $('#agLocalText').value : (ag.turns[+ds.k] || {}).text); break;
    case 'ag-refine': { const body = $('#agLocalText').value; ag.local = null; agentAsk(`حسّن صياغة رسالة المتابعة التالية واجعلها رسمية ومختصرة، وأعد النص كاملاً فقط:\n\n${body}`); break; }
    case 'ag-stop': ag.ctl?.abort(); break;
    case 'ag-clear': ag.turns = []; ag.api = []; ag.more = false; render(); break;
    case 'ag-open-ask': case 'ag-focus': { const i = $('#ag-input'); if (i) { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); i.focus(); } break; }
    case 'ag-more': ag.more = !ag.more; agLive(); break;
    case 'ag-goto': location.hash = '#' + ds.view; break;
    case 'ag-minutes': runAction('ag-minutes', { c: ds.c }); break;
    case 'ag-copy': navigator.clipboard.writeText(ag.turns[+ds.k].text).then(() => toast('تم نسخ الرد'), () => toast('تعذّر النسخ')); break;
    case 'ag-undo': {
      const a = ag.turns[+ds.k].actions[+ds.j];
      findItemsByIds(a.ids).forEach(({ i }) => { i.status = 'pending'; delete i.doneDate; });
      a.undone = true; commit('تم التراجع'); break;
    }
    case 'ag-open': {
      const a = ag.turns[+ds.k].actions[+ds.j];
      if (a.view === 'minutes' && a.mid) { ui.committee = a.committee; ui.meeting[a.committee] = a.mid; saveUI(); }
      location.hash = '#' + a.view; break;
    }
  }
});
app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.a3c')) { launchModal(state.launches.find((l) => l.id === e.target.dataset.id)); return; }
  if (e.target.id === 'ag-input' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); agentSubmit(e.target.value); }
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'ag-input') { ag.draft = e.target.value; return; }
  if (e.target.dataset.deck) { const path = e.target.dataset.deck.split('.'); let o = deckWorking(); while (path.length > 1) { const k = path.shift(); o = o[k] ??= {}; } o[path[0]] = e.target.value; return; }
  if (e.target.dataset.wsd) { ws[e.target.dataset.wsd] = e.target.value; return; }
  const f = e.target.dataset.ws;
  if (f) { ws[f] = e.target.value; saveDraft(); return; }
  const ed = e.target.closest && e.target.closest('[data-ed]');
  if (ed && ws.result) {
    const path = ed.dataset.ed.split('.'), v = ed.textContent.trim();
    if (path[0] === 'items') ws.result.items[+path[1]][path[2]] = v; else ws.result[path[0]] = v;
  }
});
app.addEventListener('dragover', (e) => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
app.addEventListener('dragleave', (e) => { const z = e.target.closest('[data-drop]'); if (z) z.classList.remove('over'); });
app.addEventListener('drop', (e) => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); addImages([...e.dataTransfer.files]); } });
document.addEventListener('click', (e) => { if (ws.menu && !e.target.closest('.picker')) { ws.menu = false; render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ws.menu) { ws.menu = false; render(); $('.picker-btn')?.focus(); } });
app.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'l-status') {
    const l = state.launches.find((x) => x.id === e.target.dataset.id);
    if (l && l.status !== e.target.value) { lSnap(); l.status = e.target.value; delete l.note; commit(`${l.title}: ${LSTN[l.status]}`); }
    return;
  }
  if (e.target.id === 'ws-img') { addImages([...e.target.files]); e.target.value = ''; return; }
  if (e.target.id !== 'docxInput') return;
  const files = [...e.target.files];
  e.target.value = '';
  importFiles(files);
});
$('#settingsBtn').addEventListener('click', settingsModal);
dlg.addEventListener('click', (e) => { if (e.target.id === 'stagesBtn') { e.preventDefault(); dlg.close(); setTimeout(stagesModal, 0); } });

/* ---------------- boot ---------------- */
applyTheme();
initCapabilities();
load().then(render).catch((e) => { console.error(e); app.innerHTML = '<div class="empty">تعذّر تحميل البيانات.</div>'; });
})();
