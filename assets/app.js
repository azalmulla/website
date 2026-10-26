/* لوحة متابعة مشروع الذكاء الاصطناعي المساعد
 * Static single-page app. Data lives in data/project.json (stages, meetings & directives)
 * and data/news.json (refreshed daily by GitHub Actions). Edits are saved in the
 * browser and, if GitHub sync is configured in settings, committed back to the repo.
 */
(() => {
'use strict';

const TZ = 'Asia/Dubai';
const SCHEMA = 2;
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
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------------- state & persistence ---------------- */
let state = null;
let news = null;
let fileSha = null;
const ui = Object.assign({ committee: 'national', meeting: {}, showDone: false }, ls.get(LS_UI) || {});
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
function commit(msg) {
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
  render();
}

async function fetchJSON(path) {
  const res = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' ' + res.status);
  return res.json();
}

// An older browser copy keeps its ticks and any meetings added in the browser,
// but takes the new stages and meeting list from the repo.
function migrate(local, remote) {
  const done = new Map();
  (local.meetings || []).forEach((m) => (m.items || []).forEach((it) => done.set(it.id, it)));
  remote.meetings.forEach((m) => (m.items || []).forEach((it) => {
    const old = done.get(it.id);
    if (old && old.status === 'done') { it.status = 'done'; if (old.doneDate) it.doneDate = old.doneDate; }
    if (old && old.note) it.note = old.note;
  }));
  const ids = new Set(remote.meetings.map((m) => m.id));
  (local.meetings || []).forEach((m) => { if (!ids.has(m.id) && (m.items || []).length) remote.meetings.push(m); });
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
  else state = remote;
  if (!state) state = { schema: SCHEMA, updatedAt: '', project: {}, stages: [], meetings: [] };
  state.meetings ||= []; state.stages ||= []; state.project ||= {};
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
const route = () => (location.hash.replace('#', '') || 'dashboard') === 'minutes' ? 'minutes' : 'dashboard';
function render() {
  const r = route();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r));
  app.innerHTML = r === 'minutes' ? viewMinutes() : viewDashboard();
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
  const withMinutes = state.meetings.filter((m) => m.items.length).length;

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
      <div class="eyebrow">المرحلة الحالية · ${idx + 1} من ${stages.length}</div>
      <h2>${esc(cur.name)}</h2>
      <div class="hero-sub">${esc(cur.title || '')}</div>
      <div class="range">${fmtDate(cur.start)} — ${fmtDate(cur.end)}</div>
      <button class="btn sm" data-act="edit-stages">تعديل المراحل</button>
    </div>
    <div class="hero-count">
      <div class="cd-label" id="cdLabel"></div>
      <div class="countdown" id="countdown">
        ${['يوم', 'ساعة', 'دقيقة', 'ثانية'].map((l, i) => `<div class="cd-unit"><b data-cd="${i}">--</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="bar"><i id="stageBar" style="width:0"></i></div>
      <div class="bar-meta"><span id="stagePct"></span><span>تنتهي ${fmtDate(cur.end)}</span></div>
    </div>
    <ol class="track" aria-label="مراحل المشروع">${track}</ol>
    ${p.start && p.end ? `<div class="target">
      <div class="t">${esc(p.targetLabel || 'الإطار الزمني للمشروع')} · ${fmtYM(p.start)} – ${fmtYM(p.end)}</div>
      <div class="bar"><i id="targetBar" style="width:0"></i></div>
      <div class="bar-meta"><span id="targetPct"></span><span id="targetLeft"></span></div>
    </div>` : ''}
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
                <div class="li-title">${esc(i.topic)}</div>
                ${i.owners ? `<div class="li-sub">${esc(i.owners)}</div>` : ''}
              </div>
            </li>`).join('')}</ul>
        </div>`).join('') : `<div class="empty">${meetingsOf(c).some((m) => m.items.length) ? 'لا توجد بنود معلّقة.' : 'لم تُرفع محاضر بعد.'}</div>`}
      </div>
    </div>`;
  };

  return `
  <section class="hero">${hero}</section>

  <section class="kpis">
    <div class="card kpi"><div class="l"><span class="dot" style="--c:var(--c-national)"></span>معلّق · اللجنة الوطنية</div><div class="v">${pend.national.length}</div><div class="s">${meetingsOf('national').filter((m) => m.items.length).length} محاضر مرفوعة</div></div>
    <div class="card kpi"><div class="l"><span class="dot" style="--c:var(--c-ministry)"></span>معلّق · لجنة الوزارة</div><div class="v">${pend.ministry.length}</div><div class="s">${meetingsOf('ministry').filter((m) => m.items.length).length} محاضر مرفوعة</div></div>
    <div class="card kpi"><div class="l">نسبة إنجاز التوجيهات</div><div class="v" style="color:var(--ok)">${all.length ? Math.round(doneN / all.length * 100) : 0}%</div><div class="s">${doneN} من ${all.length} بنداً</div></div>
    <div class="card kpi"><div class="l">المحاضر المرفوعة</div><div class="v" style="color:var(--accent-fg)">${withMinutes}</div><div class="s">من ${state.meetings.length} اجتماعاً مسجلاً</div></div>
  </section>

  <h2 class="sec-h">ما زال معلّقاً</h2>
  <section class="dash-cols">${pendCard('national')}${pendCard('ministry')}</section>

  <section class="news-cols">
    ${newsCard('أخبار الذكاء الاصطناعي المساعد في الإمارات', 'UAE', news.uae)}
    ${newsCard('أخبار Agentic AI عالمياً', 'Global', news.global)}
  </section>
  <p class="section-note">تُحدَّث الأخبار تلقائياً يومياً الساعة 7:00 صباحاً بتوقيت الإمارات (أحدث 3 أخبار، وتبقى السابقة إن لم يوجد جديد)${news.updatedAt ? ` · آخر تحديث ${newsDate(news.updatedAt)}` : ''}.</p>
  `;
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
  $('#stagePct').textContent = before ? 'لم تبدأ بعد' : `اليوم ${Math.floor((now - start) / 864e5) + 1} من ${Math.round((end - start) / 864e5)} · ${pct.toFixed(0)}%`;
  const p = state.project;
  if (p.start && p.end && $('#targetBar')) {
    const s = uaeMidnight(p.start), t = uaeMidnight(dayAfter(p.end));
    const tp = Math.min(100, Math.max(0, (now - s) / (t - s) * 100));
    $('#targetBar').style.width = tp + '%';
    $('#targetPct').textContent = `مضى ${tp.toFixed(1)}% من مدة المشروع`;
    $('#targetLeft').textContent = `متبقٍّ ${Math.max(0, Math.ceil((t - now) / 864e5))} يوماً`;
  }
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
        const committee = d[`c${k}`], number = Number(d[`n${k}`]) || null, date = d[`d${k}`] || '';
        let m = state.meetings.find((x) => x.committee === committee && number && x.number === number);
        const title = r.title && r.title.length < 120 ? r.title : `الاجتماع ${ORD[number] || number} ${committee === 'national' ? 'للجنة الوطنية للذكاء الاصطناعي المساعد' : 'للجنة الوزارة'}`;
        if (m) {
          const prev = new Map(m.items.map((i) => [i.topic.trim(), i]));
          r.items.forEach((i) => { const o = prev.get(i.topic.trim()); if (o && isDone(o)) { i.status = 'done'; i.doneDate = o.doneDate; } if (o && o.note) i.note = o.note; });
          Object.assign(m, { title, items: r.items });
          if (date) m.date = date; if (r.time) m.time = r.time; if (r.attendees) m.attendees = r.attendees;
          updated++;
        } else {
          m = { id: uid('m'), committee, number, title, date, time: r.time, attendees: r.attendees, items: r.items };
          state.meetings.push(m); added++;
        }
        ui.committee = committee; ui.meeting[committee] = m.id;
      });
      saveUI();
      if (route() !== 'minutes') location.hash = '#minutes';
      commit(`تم حفظ المحاضر: ${added} جديد، ${updated} محدَّث`);
    },
  });
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
      const title = d.title || `الاجتماع ${ORD[num] || num || ''} ${d.committee === 'national' ? 'للجنة الوطنية للذكاء الاصطناعي المساعد' : 'للجنة الوزارة'}`.replace(/\s+/g, ' ');
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
      <div class="section-t">النسخ الاحتياطي</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="exportBtn">تصدير البيانات (JSON)</button>
        <label class="btn sm" for="importFile">استيراد نسخة</label><input type="file" accept="application/json" id="importFile" hidden>
        <button type="button" class="btn sm danger" id="resetBtn">استعادة بيانات المستودع</button>
      </div>
      <small style="color:var(--muted)">آخر تعديل: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString('ar-AE', { timeZone: TZ }) : '—'}</small>`,
    onSave(d) {
      ls.set('aai.theme', d.theme); applyTheme();
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
      if (isDone(it)) { it.status = 'pending'; delete it.doneDate; } else { it.status = 'done'; it.doneDate = todayStr(); }
      commit(isDone(it) ? 'تم: أُنجز التوجيه' : 'أُعيد التوجيه إلى المعلّق');
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
  }
});
app.addEventListener('change', (e) => {
  if (e.target.id !== 'docxInput') return;
  const files = [...e.target.files];
  e.target.value = '';
  importFiles(files);
});
$('#settingsBtn').addEventListener('click', settingsModal);

/* ---------------- boot ---------------- */
applyTheme();
load().then(render).catch((e) => { console.error(e); app.innerHTML = '<div class="empty">تعذّر تحميل البيانات.</div>'; });
})();
