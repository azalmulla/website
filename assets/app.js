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
const route = () => { const h = location.hash.replace('#', ''); return ['minutes', 'workspace'].includes(h) ? h : 'dashboard'; };
function render() {
  const r = route();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r));
  app.innerHTML = r === 'minutes' ? viewMinutes() : r === 'workspace' ? viewWorkspace() : viewDashboard();
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

const defaultTitle = (committee, number) => `الاجتماع ${ORD[number] || number || ''} ${committee === 'national' ? 'للجنة الوطنية للذكاء الاصطناعي المساعد' : 'للجنة الوزارة'}`.replace(/\s+/g, ' ');

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
const COMMITTEE_FULL = { national: 'اللجنة الوطنية للذكاء الاصطناعي المساعد', ministry: 'لجنة الوزارة' };
const TASKS = [
  { id: 'minutes', icon: 'doc', t: 'إصدار محضر اجتماع', d: 'من ملاحظاتك المكتوبة أو صورها إلى محضر رسمي بقالب اللجنة' },
  { id: 'deck', icon: 'deck', t: 'إعداد عرض تقديمي', d: 'شرائح بهوية المشروع', soon: true },
  { id: 'news', icon: 'news', t: 'صياغة خبر صحفي', d: 'خبر إطلاق بأسلوب الإعلام الحكومي', soon: true },
  { id: 'brief', icon: 'brief', t: 'ملخص تنفيذي', d: 'موجز للقيادات عن مستجدات المشروع', soon: true },
];
Object.assign(ICON, {
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
const cap = { sample: null, sampleImages: false, downloads: null, ready: false };

function initCapabilities() {
  if (!window.claude || typeof window.claude.use !== 'function') { cap.ready = true; return; }
  window.claude.use('sample').then((s) => {
    cap.sample = s;
    if (s) s.limits().then((l) => { cap.sampleImages = !!(l && l.images); if (route() === 'workspace') render(); }).catch(() => {});
  }).catch(() => {}).finally(() => { cap.ready = true; if (route() === 'workspace') render(); });
  window.claude.use('downloads').then((d) => { cap.downloads = d; }).catch(() => {});
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
  return head + picker + viewMinutesTask(eng);
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

function minutesTitle() { return `محضر الاجتماع (${ORD[+ws.number] || ws.number || '…'}) ${ws.committee === 'national' ? 'للجنة الوطنية للذكاء الاصطناعي المساعد' : 'للجنة الوزارة'}`; }
function minutesDateText(r) { return ws.date ? `${dowOf(ws.date)}، ${fmtDate(ws.date)}` : (r && r.date_text) || ''; }

function viewMinutesOutput() {
  if (ws.status === 'running') {
    const n = (ws.progress.match(/"topic"/g) || []).length;
    return `<div class="card out-card thinking">
      <div class="think-h">${ICON.spark}<b>${ws.progress ? `يكتب Claude المحضر… ${n ? `${n} توجيهات حتى الآن` : ''}` : 'يقرأ Claude ملاحظاتك…'}</b></div>
      <div class="skel"><i></i><i></i><i></i><i></i><i></i></div>
    </div>`;
  }
  if (ws.status === 'error') return `<div class="card out-card"><div class="err-box"><b>تعذّر إنشاء المحضر</b><p>${esc(ws.error)}</p></div></div>`;
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
  const { default: Anthropic } = await import(SDK_URL);
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
    if (e instanceof Anthropic.AuthenticationError) throw { userMsg: 'مفتاح Claude API غير صالح. حدّثه من الإعدادات.' };
    if (e instanceof Anthropic.PermissionDeniedError) throw { userMsg: 'مفتاح API لا يملك صلاحية استخدام هذا النموذج.' };
    if (e instanceof Anthropic.RateLimitError) throw { userMsg: 'تم تجاوز حد الاستخدام مؤقتاً. حاول بعد دقيقة.' };
    if (e instanceof Anthropic.BadRequestError) throw { userMsg: 'رفض Claude الطلب. تحقق من الصور (JPG أو PNG) وحجم الملاحظات.' };
    if (e instanceof Anthropic.APIConnectionError) throw { userMsg: 'تعذّر الاتصال بـ Claude. تحقق من الإنترنت.' };
    if (e instanceof Anthropic.APIError) throw { userMsg: `خطأ من خدمة Claude (${e.status}). حاول مرة أخرى.` };
    throw e;
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
    throw { userMsg: msg || 'تعذّر الاتصال بـ Claude. حاول مرة أخرى.' };
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
    if (!data || !Array.isArray(data.items) || !data.items.length) throw { userMsg: 'لم يُرجع Claude محضراً صالحاً. حاول مرة أخرى أو وضّح الملاحظات.' };
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
    else { console.error(e); ws.status = 'error'; ws.error = (e && e.userMsg) || 'حدث خطأ غير متوقع. حاول مرة أخرى.'; }
  }
  ws.ctl = null;
  render();
}

/* fill a minutes .docx template (default, or a past minutes file the user uploaded) */
async function loadTemplate(c) {
  const custom = ls.get('aai.tpl.' + c);
  if (custom && custom.b64) return Uint8Array.from(atob(custom.b64), (ch) => ch.charCodeAt(0)).buffer;
  const res = await fetch(`assets/templates/minutes-${c}.docx`);
  if (!res.ok) throw new Error('template');
  return res.arrayBuffer();
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
      <div class="tpl-file">${ICON.doc}<span>${t ? esc(t.name) : 'القالب الافتراضي (بتنسيق محاضر اللجنة الوطنية)'}</span>
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
      <div class="section-t">Claude لمساحة العمل</div>
      <div class="hint">عند فتح اللوحة من رابطها على claude.ai تعمل مساحة العمل بحسابك في Claude مباشرة. في النسخة المحلية (localhost) أضف مفتاح Claude API من console.anthropic.com. يُحفظ المفتاح على هذا الجهاز فقط، والاستخدام يُحتسب على حساب الـ API.</div>
      ${field('مفتاح Claude API', inp('apikey', ls.get(LS_KEY) || '', 'type="password" dir="ltr" autocomplete="off" placeholder="sk-ant-…"'))}
      <div class="section-t">النسخ الاحتياطي</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="exportBtn">تصدير البيانات (JSON)</button>
        <label class="btn sm" for="importFile">استيراد نسخة</label><input type="file" accept="application/json" id="importFile" hidden>
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
  }
});
app.addEventListener('input', (e) => {
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
  if (e.target.id === 'ws-img') { addImages([...e.target.files]); e.target.value = ''; return; }
  if (e.target.id !== 'docxInput') return;
  const files = [...e.target.files];
  e.target.value = '';
  importFiles(files);
});
$('#settingsBtn').addEventListener('click', settingsModal);

/* ---------------- boot ---------------- */
applyTheme();
initCapabilities();
load().then(render).catch((e) => { console.error(e); app.innerHTML = '<div class="empty">تعذّر تحميل البيانات.</div>'; });
})();
