/* لوحة متابعة مشروع الذكاء الاصطناعي المساعد
 * Static single-page app. Data lives in data/project.json (events, meetings, stages)
 * and data/news.json (refreshed daily by GitHub Actions). Edits are saved in the
 * browser and, if GitHub sync is configured in settings, committed back to the repo.
 */
(() => {
'use strict';

const TZ = 'Asia/Dubai';
const LS_STATE = 'aai.state.v1';
const LS_GH = 'aai.github.v1';
const LS_UI = 'aai.ui.v1';
const DATA_PATH = 'data/project.json';

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DOW = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const CATS = {
  national:  'اجتماع اللجنة الوطنية',
  ministry:  'اجتماع لجنة الوزارة',
  workshop:  'ورشة / تدريب',
  launch:    'إطلاق',
  milestone: 'محطة رئيسية',
  event:     'لقاء / فعالية',
  other:     'أخرى',
};
const COMMITTEES = { national: 'اللجنة الوطنية', ministry: 'لجنة الوزارة' };
const STATUS = { pending: 'معلّق', progress: 'قيد التنفيذ', done: 'منجز' };
const STATUS_NEXT = { pending: 'progress', progress: 'done', done: 'pending' };

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
const ymOf = (s) => s.slice(0, 7);
const uaeMidnight = (s) => new Date(s + 'T00:00:00+04:00');
const dayDiff = (a, b) => Math.round((Date.UTC(...ymdArr(b)) - Date.UTC(...ymdArr(a))) / 864e5);
function ymdArr(s) { const { y, m, d } = parse(s); return [y, m - 1, d]; }
const fmtDate = (s) => { const { y, m, d } = parse(s); return `${d} ${MONTHS[m - 1]} ${y}`; };
const fmtYM = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const dowOf = (s) => DOW[new Date(Date.UTC(...ymdArr(s))).getUTCDay()];
const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; };
const evEnd = (e) => e.endDate || e.date;
function relDays(n) {
  if (n === 0) return 'اليوم';
  if (n === 1) return 'غداً';
  if (n === 2) return 'بعد يومين';
  if (n > 2 && n <= 10) return `بعد ${n} أيام`;
  return `بعد ${n} يوماً`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- state & persistence ---------------- */
let state = null;
let news = null;
let fileSha = null;
const ui = Object.assign({ calYM: null, calView: 'month', calSel: null, calOff: [], committee: 'national', minFilter: 'all', minQ: '' }, ls.get(LS_UI) || {});
const saveUI = () => ls.set(LS_UI, { calView: ui.calView, calOff: ui.calOff, committee: ui.committee, minFilter: ui.minFilter });

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

async function load() {
  let remote = null;
  if (ghOn()) {
    try { remote = await ghLoad(); setSync('ok', 'متصل بـ GitHub'); }
    catch (e) { console.warn(e); setSync('err', 'تعذّر الاتصال بـ GitHub'); }
  }
  if (!remote) { try { remote = await fetchJSON(DATA_PATH); } catch (e) { console.warn(e); } }
  const local = ls.get(LS_STATE);
  if (local && (!remote || (local.updatedAt || '') >= (remote.updatedAt || ''))) state = local;
  else state = remote;
  if (!state) state = { updatedAt: '', project: {}, stages: [], events: [], meetings: [] };
  state.events ||= []; state.meetings ||= []; state.stages ||= []; state.project ||= {};
  try { news = await fetchJSON('data/news.json'); } catch { news = { uae: [], global: [] }; }
}

/* ---------------- derived ---------------- */
const sortedEvents = () => [...state.events].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
const allItems = () => state.meetings.flatMap((m) => (m.items || []).map((it) => ({ ...it, meeting: m })));
const findMeeting = (id) => state.meetings.find((m) => m.id === id);
const findItem = (mid, iid) => (findMeeting(mid)?.items || []).find((i) => i.id === iid);

function currentStage(now = Date.now()) {
  const st = [...state.stages].sort((a, b) => a.start.localeCompare(b.start));
  let cur = st.find((s) => uaeMidnight(s.start) <= now && now < uaeMidnight(s.end));
  if (!cur) cur = st.find((s) => uaeMidnight(s.start) > now) || st[st.length - 1];
  return { list: st, cur };
}

/* ---------------- router ---------------- */
const app = $('#app');
function route() { return (location.hash.replace('#', '') || 'dashboard').split('/')[0]; }
function render() {
  const r = route();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r));
  if (r === 'calendar') app.innerHTML = viewCalendar();
  else if (r === 'minutes') app.innerHTML = viewMinutes();
  else app.innerHTML = viewDashboard();
  tick();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ---------------- dashboard ---------------- */
function viewDashboard() {
  const today = todayStr();
  const { list: stages, cur } = currentStage();
  const items = allItems();
  const open = items.filter((i) => i.status !== 'done')
    .sort((a, b) => (b.meeting.date || '').localeCompare(a.meeting.date || '') || (a.status === 'progress' ? -1 : 1));
  const done = items.length - open.length;
  const evs = sortedEvents();
  const past = evs.filter((e) => e.date <= today);
  const upcoming = evs.filter((e) => evEnd(e) >= today);
  const p = state.project;

  const stageHtml = cur ? `
    <div class="hero-top">
      <div>
        <div class="eyebrow">المرحلة الحالية للمشروع</div>
        <h2>${esc(cur.name)}</h2>
        <div class="range">${fmtDate(cur.start)} — ${fmtDate(cur.end)}</div>
      </div>
      <button class="btn sm edit" data-act="edit-stages">تعديل المراحل</button>
    </div>
    <div class="countdown" id="countdown">
      ${['يوم', 'ساعة', 'دقيقة', 'ثانية'].map((l, i) => `<div class="cd-unit"><b data-cd="${i}">--</b><span>${l}</span></div>`).join('')}
    </div>
    <div class="cd-label" id="cdLabel"></div>
    <div class="bar" style="margin-top:8px"><i id="stageBar" style="width:0"></i></div>
    <div class="bar-meta"><span id="stagePct"></span><span>تنتهي ${fmtDate(cur.end)}</span></div>
    <div class="stages-track">
      ${stages.map((s) => `<span class="stage-pill ${s === cur ? 'now' : (uaeMidnight(s.end) <= Date.now() ? 'done' : '')}">${esc(s.name)}</span>`).join('')}
    </div>
    ${p.target ? `<div class="target">
      <div class="t">${esc(p.targetLabel || 'الهدف العام')} · الموعد المستهدف ${fmtDate(p.target)}</div>
      <div class="bar"><i id="targetBar" style="width:0"></i></div>
      <div class="bar-meta"><span id="targetPct"></span><span id="targetLeft"></span></div>
    </div>` : ''}
  ` : `<div class="hero-top"><div><h2>لم تُحدَّد مراحل المشروع بعد</h2></div><button class="btn sm edit" data-act="edit-stages">إضافة المراحل</button></div>`;

  const openList = open.slice(0, 8).map((i) => `
    <li>
      <input type="checkbox" class="tick" data-act="toggle-item" data-mid="${i.meeting.id}" data-iid="${i.id}" aria-label="تم الإنجاز">
      <div class="li-main">
        <div class="li-title">${esc(i.topic)}</div>
        <div class="li-sub">${esc(i.owners || '')}</div>
        <div class="li-meta">
          <span class="chip"><span class="dot" style="--c:var(--c-${i.meeting.committee})"></span>${esc(COMMITTEES[i.meeting.committee])} · ${esc(meetingShort(i.meeting))}</span>
          <button class="status ${i.status}" data-act="cycle-status" data-mid="${i.meeting.id}" data-iid="${i.id}" title="تغيير الحالة">${STATUS[i.status]}</button>
          ${i.due ? `<span class="chip">الاستحقاق ${fmtDate(i.due)}</span>` : ''}
        </div>
      </div>
    </li>`).join('');

  const upList = upcoming.slice(0, 6).map((e) => {
    const n = dayDiff(today, e.date);
    const { d, m } = parse(e.date);
    return `<li data-act="edit-event" data-eid="${e.id}" style="cursor:pointer">
      <div class="datebox"><b>${d}</b><span>${MONTHS[m - 1]}</span></div>
      <div class="li-main">
        <div class="li-title">${esc(e.title)}</div>
        <div class="li-meta"><span class="chip"><span class="dot" style="--c:var(--c-${e.category})"></span>${esc(CATS[e.category] || CATS.other)}</span></div>
      </div>
      <span class="in-days">${n <= 0 ? 'جارٍ الآن' : relDays(n)}</span>
    </li>`;
  }).join('');

  return `
  <section class="hero">${stageHtml}</section>

  <section class="kpis">
    <div class="card kpi"><div class="l">أحداث منذ الإعلان</div><div class="v">${past.length}</div><div class="s">منذ ${fmtDate(p.announced || (evs[0] && evs[0].date) || today)}</div></div>
    <div class="card kpi"><div class="l">بنود معلّقة</div><div class="v" style="color:var(--warn)">${open.length}</div><div class="s">${open.filter((i) => i.status === 'progress').length} قيد التنفيذ</div></div>
    <div class="card kpi"><div class="l">نسبة إنجاز التوجيهات</div><div class="v" style="color:var(--ok)">${items.length ? Math.round(done / items.length * 100) : 0}%</div><div class="s">${done} من ${items.length} بنداً</div></div>
    <div class="card kpi"><div class="l">أحداث قادمة</div><div class="v" style="color:var(--blue)">${upcoming.length}</div><div class="s">${upcoming[0] ? 'الأقرب: ' + fmtDate(upcoming[0].date) : 'لا يوجد مجدول'}</div></div>
  </section>

  <section class="dash-cols">
    <div class="card">
      <div class="card-h"><h2>البنود المعلّقة من الاجتماعات <span class="count">${open.length}</span></h2><a class="link" href="#minutes">عرض المحاضر ←</a></div>
      <div class="card-b">${open.length ? `<ul class="list">${openList}</ul>${open.length > 8 ? `<div style="text-align:center;padding-top:8px"><a class="link" href="#minutes">+ ${open.length - 8} بنود أخرى</a></div>` : ''}` : '<div class="empty">لا توجد بنود معلّقة — أحسنت 👏</div>'}</div>
    </div>
    <div class="card">
      <div class="card-h"><h2>الأحداث القادمة <span class="count">${upcoming.length}</span></h2><button class="btn sm primary" data-act="add-event">+ حدث</button></div>
      <div class="card-b">${upcoming.length ? `<ul class="list">${upList}</ul>` : `<div class="empty">لا توجد أحداث مجدولة قادمة.<br><button class="link" data-act="add-event" style="margin-top:6px">أضف حدثاً قادماً</button></div>`}
        <div style="text-align:center;padding-top:6px"><a class="link" href="#calendar">فتح تقويم الأحداث ←</a></div>
      </div>
    </div>
  </section>

  <section class="news-cols">
    ${newsCard('أخبار الذكاء الاصطناعي المساعد في الإمارات', 'UAE', news.uae)}
    ${newsCard('أخبار Agentic AI عالمياً', 'Global', news.global)}
  </section>
  <p style="color:var(--muted);font-size:12px;margin:10px 2px 0">تُحدَّث الأخبار تلقائياً يومياً الساعة 7:00 صباحاً بتوقيت الإمارات (أحدث 3 أخبار، وتبقى السابقة إن لم يوجد جديد)${news.updatedAt ? ` · آخر تحديث ${fmtDate(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(news.updatedAt)))}` : ''}.</p>
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
        </a></li>`).join('')}</ul>` : '<div class="empty">لا توجد أخبار بعد — ستظهر بعد أول تحديث تلقائي.</div>'}
    </div></div>`;
}
function newsDate(s) {
  if (/^\d{4}-\d{2}$/.test(s)) return fmtYM(s);
  const d = new Date(s); if (isNaN(d)) return '';
  return fmtDate(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d));
}
const meetingShort = (m) => m.number ? `الاجتماع ${m.number}` : fmtDate(m.date);

/* countdown */
function tick() {
  const el = $('#countdown'); if (!el) return;
  const { cur } = currentStage(); if (!cur) return;
  const now = Date.now();
  const start = uaeMidnight(cur.start).getTime(), end = uaeMidnight(cur.end).getTime();
  const before = now < start;
  let ms = Math.max(0, (before ? start : end) - now);
  const parts = [Math.floor(ms / 864e5), Math.floor(ms / 36e5) % 24, Math.floor(ms / 6e4) % 60, Math.floor(ms / 1e3) % 60];
  el.querySelectorAll('[data-cd]').forEach((b) => b.textContent = parts[b.dataset.cd]);
  $('#cdLabel').textContent = before ? `متبقٍّ على بدء ${cur.name}` : (ms ? `متبقٍّ على نهاية ${cur.name}` : `انتهت ${cur.name}`);
  const pct = before ? 0 : Math.min(100, (now - start) / (end - start) * 100);
  $('#stageBar').style.width = pct + '%';
  $('#stagePct').textContent = before ? 'لم تبدأ بعد' : `مضى ${pct.toFixed(1)}% · اليوم ${Math.floor((now - start) / 864e5) + 1} من ${Math.round((end - start) / 864e5)}`;
  const p = state.project;
  if (p.target && $('#targetBar')) {
    const s = uaeMidnight(p.announced).getTime(), t = uaeMidnight(p.target).getTime();
    const tp = Math.min(100, Math.max(0, (now - s) / (t - s) * 100));
    $('#targetBar').style.width = tp + '%';
    $('#targetPct').textContent = `مضى ${tp.toFixed(1)}% من المدة`;
    $('#targetLeft').textContent = `متبقٍّ ${Math.max(0, Math.ceil((t - now) / 864e5))} يوماً`;
  }
}
setInterval(tick, 1000);

/* ---------------- calendar ---------------- */
function calMonths() {
  const evs = sortedEvents();
  const today = todayStr();
  let first = ymOf(state.project.announced || (evs[0] ? evs[0].date : today));
  let last = [evs.length ? ymOf(evEnd(evs[evs.length - 1])) : first, addMonths(ymOf(today), 1)].sort().pop();
  if (evs[0] && ymOf(evs[0].date) < first) first = ymOf(evs[0].date);
  const out = []; for (let ym = first; ym <= last; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

function viewCalendar() {
  const today = todayStr();
  if (!ui.calYM) ui.calYM = ymOf(today);
  const ym = ui.calYM;
  const visible = sortedEvents().filter((e) => !ui.calOff.includes(e.category));
  const months = calMonths();
  const countIn = (m) => state.events.filter((e) => ymOf(e.date) === m).length;

  const head = `
  <div class="page-head">
    <div><h1>تقويم الأحداث</h1><p>أحداث مشروع الذكاء الاصطناعي المساعد منذ الإعلان، شهراً بشهر · ${state.events.length} حدثاً</p></div>
    <button class="btn primary" data-act="add-event">+ إضافة حدث</button>
  </div>
  <div class="cal-toolbar">
    ${ui.calView === 'month' ? `<div class="cal-nav">
      <button class="icon-btn" data-act="cal-step" data-n="-1" aria-label="الشهر السابق">›</button>
      <h2>${fmtYM(ym)}</h2>
      <button class="icon-btn" data-act="cal-step" data-n="1" aria-label="الشهر التالي">‹</button>
      <button class="btn sm" data-act="cal-today">اليوم</button>
    </div>` : '<h2 style="margin:0;font-size:20px">كل الأحداث</h2>'}
    <span class="spacer"></span>
    <div class="seg"><button class="${ui.calView === 'month' ? 'on' : ''}" data-act="cal-view" data-v="month">شهري</button><button class="${ui.calView === 'list' ? 'on' : ''}" data-act="cal-view" data-v="list">قائمة زمنية</button></div>
  </div>
  ${ui.calView === 'month' ? `<div class="month-strip">${months.map((m) => `<button class="${m === ym ? 'on' : ''}" data-act="cal-month" data-ym="${m}">${fmtYM(m)}<span class="num">${countIn(m)}</span></button>`).join('')}</div>` : ''}
  <div class="filters">${Object.entries(CATS).map(([k, v]) => `<span class="chip ${ui.calOff.includes(k) ? 'off' : ''}" data-act="cal-filter" data-cat="${k}" role="button" tabindex="0"><span class="dot" style="--c:var(--c-${k})"></span>${v}</span>`).join('')}</div>`;

  if (ui.calView === 'list') {
    const byMonth = {};
    visible.forEach((e) => (byMonth[ymOf(e.date)] ||= []).push(e));
    const body = Object.keys(byMonth).sort().map((m) => `
      <div class="timeline-month">
        <h3><span>${fmtYM(m)}</span><span class="num">${byMonth[m].length}</span></h3>
        <div class="card">${byMonth[m].map((e) => `
          <div class="tl-row ${e.date > today ? 'future' : ''}" data-act="edit-event" data-eid="${e.id}">
            <div class="tl-day">${parse(e.date).d}${e.endDate ? '–' + parse(e.endDate).d : ''}</div>
            <div class="li-main">
              <div class="li-title">${esc(e.title)}</div>
              ${e.description ? `<div class="li-sub">${esc(e.description)}</div>` : ''}
              <div class="li-meta"><span class="chip"><span class="dot" style="--c:var(--c-${e.category})"></span>${esc(CATS[e.category] || CATS.other)}</span><span class="chip">${dowOf(e.date)}</span>${e.date > today ? '<span class="chip" style="color:var(--blue)">قادم</span>' : ''}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>`).join('');
    return head + (body || '<div class="card empty">لا توجد أحداث.</div>');
  }

  // month grid, weeks start Monday
  const [y, m] = ym.split('-').map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= nDays; d++) cells.push(`${ym}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const onDay = (ds) => visible.filter((e) => e.date <= ds && evEnd(e) >= ds);
  const sel = ui.calSel && ymOf(ui.calSel) === ym ? ui.calSel : null;

  const grid = `<div class="card" style="overflow:hidden"><div class="cal-grid">
    ${['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
    ${cells.map((ds) => {
      if (!ds) return '<div class="cal-cell out"></div>';
      const evs = onDay(ds);
      return `<div class="cal-cell ${ds === today ? 'today' : ''} ${ds === sel ? 'sel' : ''}" data-act="cal-day" data-date="${ds}">
        <span class="d">${parse(ds).d}</span>
        ${evs.slice(0, 3).map((e) => `<span class="cal-ev" style="--c:var(--c-${e.category})" title="${esc(e.title)}">${esc(e.title)}</span>`).join('')}
        ${evs.length > 3 ? `<div class="cal-more">+${evs.length - 3} أخرى</div>` : ''}
        <div class="cal-dots">${evs.map((e) => `<span class="dot" style="--c:var(--c-${e.category})"></span>`).join('')}</div>
      </div>`;
    }).join('')}
  </div></div>`;

  const sideEvents = sel ? onDay(sel) : visible.filter((e) => ymOf(e.date) === ym || (e.date < ym + '-01' && ymOf(evEnd(e)) >= ym));
  const side = `<div class="card">
    <div class="card-h"><h2>${sel ? `${dowOf(sel)} ${fmtDate(sel)}` : `أحداث ${fmtYM(ym)}`} <span class="count">${sideEvents.length}</span></h2>
      ${sel ? `<button class="link" data-act="cal-day" data-date="${sel}">عرض الشهر</button>` : ''}</div>
    <div class="card-b side-list">
      ${sideEvents.length ? sideEvents.map((e) => `
        <div class="ev" data-act="edit-event" data-eid="${e.id}" style="--c:var(--c-${e.category})">
          <span class="ev-bar"></span>
          <div class="li-main">
            <div class="li-title">${esc(e.title)}</div>
            <div class="li-sub">${fmtDate(e.date)}${e.endDate ? ' – ' + fmtDate(e.endDate) : ''} · ${esc(CATS[e.category] || CATS.other)}</div>
            ${e.description ? `<div class="li-sub">${esc(e.description)}</div>` : ''}
          </div>
        </div>`).join('') : '<div class="empty">لا توجد أحداث.</div>'}
      <button class="btn sm" style="margin-top:10px;width:100%;justify-content:center" data-act="add-event" data-date="${sel || ''}">+ إضافة حدث${sel ? ' في هذا اليوم' : ''}</button>
    </div>
  </div>`;

  return head + `<div class="cal-layout">${grid}${side}</div>`;
}

/* ---------------- minutes ---------------- */
function viewMinutes() {
  const c = ui.committee;
  const q = ui.minQ.trim();
  const meetings = state.meetings.filter((m) => m.committee === c).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const cnt = (k) => state.meetings.filter((m) => m.committee === k).reduce((n, m) => n + (m.items || []).filter((i) => i.status !== 'done').length, 0);

  const head = `
  <div class="page-head">
    <div><h1>متابعة محاضر الاجتماعات</h1><p>توجيهات اللجنة الوطنية ولجنة الوزارة — حدّد ما تم إنجازه وما زال معلّقاً</p></div>
    <button class="btn primary" data-act="add-meeting">+ إضافة اجتماع</button>
  </div>
  <div class="subtabs">${Object.entries(COMMITTEES).map(([k, v]) => `<button class="${k === c ? 'on' : ''}" data-act="committee" data-c="${k}"><span class="dot" style="--c:var(--c-${k})"></span>${v}<span class="count" title="بنود معلّقة">${cnt(k)}</span></button>`).join('')}</div>
  <div class="min-toolbar">
    <div class="seg">${[['all', 'الكل'], ['open', 'غير منجز'], ['progress', 'قيد التنفيذ'], ['done', 'منجز']].map(([k, v]) => `<button class="${ui.minFilter === k ? 'on' : ''}" data-act="min-filter" data-f="${k}">${v}</button>`).join('')}</div>
    <input class="search" type="search" id="minQ" placeholder="بحث في البنود أو أصحاب العلاقة…" value="${esc(ui.minQ)}">
  </div>`;

  if (!meetings.length) {
    return head + `<div class="card empty" style="padding:50px 20px">لا توجد محاضر مسجّلة لـ${COMMITTEES[c]} بعد.<br><button class="btn primary" style="margin-top:12px" data-act="add-meeting">+ إضافة أول اجتماع</button></div>`;
  }

  const match = (i) => {
    if (ui.minFilter === 'open' && i.status === 'done') return false;
    if (ui.minFilter === 'progress' && i.status !== 'progress') return false;
    if (ui.minFilter === 'done' && i.status !== 'done') return false;
    if (q && !`${i.topic} ${i.directive} ${i.owners} ${i.note || ''}`.includes(q)) return false;
    return true;
  };

  return head + meetings.map((m) => {
    const items = m.items || [];
    const done = items.filter((i) => i.status === 'done').length;
    const prog = items.filter((i) => i.status === 'progress').length;
    const pct = items.length ? Math.round(done / items.length * 100) : 0;
    const shown = items.map((it, idx) => ({ it, idx })).filter(({ it }) => match(it));
    return `<article class="card meeting">
      <div class="meeting-h">
        <div style="flex:1 1 300px;min-width:0">
          <h3>${esc(m.title)}</h3>
          <div class="meta">${m.date ? `${dowOf(m.date)} ${fmtDate(m.date)}` : ''}${m.time ? ` · الساعة ${esc(m.time)}` : ''} · ${items.length} بنداً</div>
          ${m.attendees ? `<details class="att"><summary>الحضور</summary>${esc(m.attendees)}</details>` : ''}
        </div>
        <div class="prog">
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="bar-meta"><span>${done} منجز · ${prog} قيد التنفيذ · ${items.length - done - prog} معلّق</span><b class="num">${pct}%</b></div>
        </div>
      </div>
      <ul class="items">
        ${shown.length ? shown.map(({ it, idx }) => `
        <li class="item ${it.status === 'done' ? 'is-done' : ''}">
          <input type="checkbox" class="tick" ${it.status === 'done' ? 'checked' : ''} data-act="toggle-item" data-mid="${m.id}" data-iid="${it.id}" aria-label="تم الإنجاز">
          <span class="n">${idx + 1}</span>
          <div style="min-width:0">
            <div class="topic">${esc(it.topic)}</div>
            <div class="dir">${esc(it.directive)}</div>
            <div class="owners">${it.owners ? `<span>👤 ${esc(it.owners)}</span>` : ''}${it.due ? `<span class="chip">الاستحقاق ${fmtDate(it.due)}</span>` : ''}${it.doneDate && it.status === 'done' ? `<span class="chip" style="color:var(--ok)">أُنجز ${fmtDate(it.doneDate)}</span>` : ''}</div>
            ${it.note ? `<div class="note">📝 ${esc(it.note)}</div>` : ''}
          </div>
          <div class="item-actions">
            <button class="status ${it.status}" data-act="cycle-status" data-mid="${m.id}" data-iid="${it.id}" title="اضغط لتغيير الحالة">${STATUS[it.status]}</button>
            <div class="row"><button class="btn ghost sm" data-act="edit-item" data-mid="${m.id}" data-iid="${it.id}">تعديل</button></div>
          </div>
        </li>`).join('') : '<li class="empty">لا توجد بنود مطابقة.</li>'}
      </ul>
      <div class="meeting-f">
        <button class="btn sm" data-act="add-item" data-mid="${m.id}">+ إضافة بند</button>
        <button class="btn sm" data-act="edit-meeting" data-mid="${m.id}">تعديل بيانات الاجتماع</button>
      </div>
    </article>`;
  }).join('');
}

/* ---------------- modal ---------------- */
const dlg = $('#modal');
const form = $('#modalForm');
let onSubmit = null;
function openModal({ title, body, submit = 'حفظ', del, extra = '', onSave }) {
  form.innerHTML = `
    <div class="m-h"><h3>${title}</h3><button type="button" class="icon-btn" data-close aria-label="إغلاق">✕</button></div>
    <div class="m-b">${body}</div>
    <div class="m-f">${del ? `<button type="button" class="btn danger" data-del>حذف</button>` : ''}${extra}<span class="spacer"></span>
      <button type="button" class="btn" data-close>إلغاء</button>${submit ? `<button type="submit" class="btn primary">${submit}</button>` : ''}</div>`;
  onSubmit = onSave;
  form.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => dlg.close());
  const d = form.querySelector('[data-del]');
  if (d) d.onclick = () => { if (confirm('هل أنت متأكد من الحذف؟')) { dlg.close(); del(); } };
  dlg.showModal();
  const f = form.querySelector('input:not([type=hidden]),textarea,select'); if (f) f.focus();
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!onSubmit) return dlg.close();
  const data = Object.fromEntries(new FormData(form).entries());
  for (const k in data) if (typeof data[k] === 'string') data[k] = data[k].trim();
  if (onSubmit(data, form) !== false) dlg.close();
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

const field = (label, input, hint = '') => `<div class="field"><label>${label}</label>${input}${hint ? `<small>${hint}</small>` : ''}</div>`;
const inp = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
const area = (name, val = '', attrs = '') => `<textarea name="${name}" ${attrs}>${esc(val)}</textarea>`;
const sel = (name, opts, val) => `<select name="${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${v}</option>`).join('')}</select>`;

function eventModal(ev, presetDate) {
  const isNew = !ev;
  ev ||= { date: presetDate || todayStr(), title: '', category: 'event' };
  openModal({
    title: isNew ? 'إضافة حدث' : 'تعديل الحدث',
    body:
      field('عنوان الحدث', inp('title', ev.title, 'required')) +
      `<div class="row2">${field('التاريخ', inp('date', ev.date, 'type="date" required'))}${field('تاريخ الانتهاء', inp('endDate', ev.endDate || '', 'type="date"'), 'اختياري — للأحداث الممتدة لأكثر من يوم')}</div>` +
      field('التصنيف', sel('category', CATS, ev.category)) +
      field('الوصف / ملاحظات', area('description', ev.description || '')),
    del: isNew ? null : () => { state.events = state.events.filter((e) => e.id !== ev.id); commit('تم حذف الحدث'); },
    onSave(d) {
      if (d.endDate && d.endDate < d.date) { alert('تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء'); return false; }
      const rec = { id: ev.id || uid('e'), date: d.date, title: d.title, category: d.category };
      if (d.endDate && d.endDate !== d.date) rec.endDate = d.endDate;
      if (d.description) rec.description = d.description;
      if (isNew) state.events.push(rec); else Object.assign(ev, rec, { endDate: rec.endDate, description: rec.description });
      if (!rec.endDate) delete ev.endDate; if (!rec.description) delete ev.description;
      ui.calYM = ymOf(rec.date);
      commit(isNew ? 'تمت إضافة الحدث' : 'تم حفظ التعديلات');
    },
  });
}

function itemModal(m, it) {
  const isNew = !it;
  it ||= { topic: '', directive: '', owners: '', status: 'pending' };
  openModal({
    title: isNew ? 'إضافة بند' : 'تعديل البند',
    body:
      field('الموضوع', inp('topic', it.topic, 'required')) +
      field('التوجيه', area('directive', it.directive, 'required')) +
      field('أصحاب العلاقة', inp('owners', it.owners)) +
      `<div class="row2">${field('الحالة', sel('status', STATUS, it.status))}${field('تاريخ الاستحقاق', inp('due', it.due || '', 'type="date"'), 'اختياري')}</div>` +
      field('ملاحظات المتابعة', area('note', it.note || '', 'placeholder="مثال: تم التواصل مع الفريق، بانتظار العرض…"')),
    del: isNew ? null : () => { m.items = m.items.filter((i) => i.id !== it.id); commit('تم حذف البند'); },
    onSave(d) {
      const wasDone = it.status === 'done';
      Object.assign(it, { topic: d.topic, directive: d.directive, owners: d.owners, status: d.status });
      d.due ? it.due = d.due : delete it.due;
      d.note ? it.note = d.note : delete it.note;
      if (it.status === 'done' && !wasDone) it.doneDate = todayStr();
      if (it.status !== 'done') delete it.doneDate;
      if (isNew) { it.id = uid('i'); (m.items ||= []).push(it); }
      commit(isNew ? 'تمت إضافة البند' : 'تم حفظ التعديلات');
    },
  });
}

function meetingModal(m) {
  const isNew = !m;
  m ||= { committee: ui.committee, title: '', date: todayStr(), time: '', attendees: '', items: [] };
  const nextNum = state.meetings.filter((x) => x.committee === m.committee).reduce((n, x) => Math.max(n, x.number || 0), 0) + 1;
  openModal({
    title: isNew ? 'إضافة اجتماع' : 'تعديل بيانات الاجتماع',
    body:
      `<div class="row2">${field('اللجنة', sel('committee', COMMITTEES, m.committee))}${field('رقم الاجتماع', inp('number', m.number || (isNew ? nextNum : ''), 'type="number" min="1"'))}</div>` +
      field('عنوان الاجتماع', inp('title', m.title, 'placeholder="يُولَّد تلقائياً إن تُرك فارغاً"')) +
      `<div class="row2">${field('التاريخ', inp('date', m.date, 'type="date" required'))}${field('الوقت', inp('time', m.time || '', 'type="time"'))}</div>` +
      field('الحضور', area('attendees', m.attendees || '')) +
      (isNew ? `<label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="addEvent" checked> إضافة الاجتماع إلى تقويم الأحداث</label>` : ''),
    del: isNew ? null : () => { state.meetings = state.meetings.filter((x) => x.id !== m.id); commit('تم حذف الاجتماع'); },
    onSave(d) {
      const num = d.number ? Number(d.number) : null;
      const ORD = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر'];
      const title = d.title || `الاجتماع ${ORD[num] || num || ''} ${d.committee === 'national' ? 'للجنة الوطنية للذكاء الاصطناعي المساعد' : 'للجنة الوزارة'}`.replace(/\s+/g, ' ');
      Object.assign(m, { committee: d.committee, title, date: d.date, time: d.time, attendees: d.attendees });
      num ? m.number = num : delete m.number;
      if (isNew) {
        m.id = uid('m'); state.meetings.push(m);
        if (d.addEvent) state.events.push({ id: uid('e'), date: d.date, title: title.replace(/^الاجتماع/, 'اجتماع'), category: d.committee });
      }
      ui.committee = m.committee; saveUI();
      commit(isNew ? 'تمت إضافة الاجتماع — أضف بنوده الآن' : 'تم حفظ التعديلات');
    },
  });
}

function stagesModal() {
  const p = state.project;
  const row = (s, i) => `<div class="stage-row" data-row>
    ${field(i === 0 ? 'اسم المرحلة' : '', inp('name', s.name, 'required'))}
    ${field(i === 0 ? 'البداية' : '', inp('start', s.start, 'type="date" required'))}
    ${field(i === 0 ? 'النهاية' : '', inp('end', s.end, 'type="date" required'))}
    <button type="button" class="btn sm danger" data-rm title="حذف">✕</button></div>`;
  openModal({
    title: 'مراحل المشروع والعد التنازلي',
    body: `<div class="hint">يعرض العد التنازلي في الرئيسية الوقت المتبقي على نهاية المرحلة الجارية حسب التواريخ أدناه (بتوقيت الإمارات).</div>
      <div id="stageRows">${state.stages.map(row).join('')}</div>
      <button type="button" class="btn sm" id="addStage">+ إضافة مرحلة</button>
      <div class="section-t">الهدف العام</div>
      <div class="row2">${field('تاريخ الإعلان', inp('announced', p.announced || '', 'type="date"'))}${field('الموعد المستهدف', inp('target', p.target || '', 'type="date"'))}</div>
      ${field('وصف الهدف', inp('targetLabel', p.targetLabel || ''))}`,
    onSave(d, f) {
      const rows = [...f.querySelectorAll('[data-row]')].map((r) => ({
        name: r.querySelector('[name=name]').value.trim(), start: r.querySelector('[name=start]').value, end: r.querySelector('[name=end]').value,
      })).filter((s) => s.name && s.start && s.end);
      if (rows.some((s) => s.end <= s.start)) { alert('تاريخ نهاية كل مرحلة يجب أن يكون بعد بدايتها'); return false; }
      state.stages = rows.map((s, i) => ({ id: state.stages[i]?.id || uid('s'), ...s }));
      Object.assign(state.project, { announced: d.announced, target: d.target, targetLabel: d.targetLabel });
      commit('تم حفظ المراحل');
    },
  });
  const wire = () => form.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => b.closest('[data-row]').remove());
  wire();
  $('#addStage').onclick = () => {
    const last = [...form.querySelectorAll('[data-row] [name=end]')].pop();
    $('#stageRows').insertAdjacentHTML('beforeend', row({ name: `المرحلة ${form.querySelectorAll('[data-row]').length + 1}`, start: last ? last.value : todayStr(), end: '' }, 1));
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
      <div class="hint">بدون مزامنة تُحفظ تعديلاتك (الأحداث، البنود، المراحل) في هذا المتصفح فقط. لحفظها في المستودع وعرضها على كل الأجهزة، أدخل <b>Fine-grained token</b> بصلاحية <b>Contents: Read and write</b> على هذا المستودع فقط. يُحفظ الرمز على هذا الجهاز فقط.</div>
      <div class="row2">${field('المالك (Owner)', inp('owner', g.owner, 'dir="ltr"'))}${field('المستودع', inp('repo', g.repo, 'dir="ltr"'))}</div>
      <div class="row2">${field('الفرع (Branch)', inp('branch', g.branch, 'dir="ltr"'), 'اتركه فارغاً لاستخدام الفرع الافتراضي')}${field('الرمز (Token)', inp('token', g.token, 'type="password" dir="ltr" autocomplete="off" placeholder="github_pat_…"'))}</div>
      <div class="section-t">النسخ الاحتياطي</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="exportBtn">⬇ تصدير البيانات (JSON)</button>
        <label class="btn sm" style="cursor:pointer">⬆ استيراد<input type="file" accept="application/json" id="importFile" hidden></label>
        <button type="button" class="btn sm danger" id="resetBtn">استعادة بيانات المستودع</button>
      </div>
      <small style="color:var(--muted)">آخر تعديل: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString('ar-AE', { timeZone: TZ }) : '—'}</small>`,
    async onSave(d) {
      ls.set('aai.theme', d.theme); applyTheme();
      if (d.token) {
        ls.set(LS_GH, { owner: d.owner, repo: d.repo, branch: d.branch, token: d.token });
        setSync('', 'جارٍ الاتصال…');
        try {
          const remote = await ghLoad();
          if ((remote.updatedAt || '') > (state.updatedAt || '')) { state = remote; ls.set(LS_STATE, state); render(); setSync('ok', 'تم التحميل من GitHub'); }
          else commit('تم تفعيل المزامنة');
        } catch (e) { setSync('err', 'تعذّر الاتصال — تحقق من الرمز'); }
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
      if (!Array.isArray(d.events) || !Array.isArray(d.meetings)) throw 0;
      state = d; dlg.close(); commit('تم استيراد البيانات');
    } catch { alert('ملف غير صالح'); }
  };
  $('#resetBtn').onclick = async () => {
    if (!confirm('سيتم استبدال التعديلات المحلية ببيانات المستودع المنشورة. متابعة؟')) return;
    try { state = await fetchJSON(DATA_PATH); ls.del(LS_STATE); dlg.close(); render(); toast('تمت الاستعادة'); }
    catch { alert('تعذّر تحميل بيانات المستودع'); }
  };
}

function applyTheme() {
  const t = ls.get('aai.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/* ---------------- actions ---------------- */
function setItemStatus(it, status) {
  it.status = status;
  if (status === 'done') it.doneDate = todayStr(); else delete it.doneDate;
}
app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  const ds = t.dataset;
  switch (a) {
    case 'toggle-item': {
      const it = findItem(ds.mid, ds.iid); if (!it) return;
      setItemStatus(it, it.status === 'done' ? 'pending' : 'done');
      commit(it.status === 'done' ? 'تم تحديد البند كمنجز ✓' : 'أُعيد البند إلى معلّق');
      break;
    }
    case 'cycle-status': {
      const it = findItem(ds.mid, ds.iid); if (!it) return;
      setItemStatus(it, STATUS_NEXT[it.status] || 'pending');
      commit(`الحالة: ${STATUS[it.status]}`);
      break;
    }
    case 'edit-item': itemModal(findMeeting(ds.mid), findItem(ds.mid, ds.iid)); break;
    case 'add-item': itemModal(findMeeting(ds.mid)); break;
    case 'add-meeting': meetingModal(); break;
    case 'edit-meeting': meetingModal(findMeeting(ds.mid)); break;
    case 'add-event': eventModal(null, ds.date); break;
    case 'edit-event': eventModal(state.events.find((x) => x.id === ds.eid)); break;
    case 'edit-stages': stagesModal(); break;
    case 'cal-step': ui.calYM = addMonths(ui.calYM, Number(ds.n)); ui.calSel = null; render(); break;
    case 'cal-today': ui.calYM = ymOf(todayStr()); ui.calSel = todayStr(); render(); break;
    case 'cal-month': ui.calYM = ds.ym; ui.calSel = null; render(); break;
    case 'cal-view': ui.calView = ds.v; saveUI(); render(); break;
    case 'cal-day': ui.calSel = ui.calSel === ds.date ? null : ds.date; render(); break;
    case 'cal-filter': {
      const k = ds.cat;
      ui.calOff = ui.calOff.includes(k) ? ui.calOff.filter((x) => x !== k) : [...ui.calOff, k];
      saveUI(); render(); break;
    }
    case 'committee': ui.committee = ds.c; saveUI(); render(); break;
    case 'min-filter': ui.minFilter = ds.f; saveUI(); render(); break;
  }
});
app.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.chip[data-act]')) { e.preventDefault(); e.target.click(); }
});
app.addEventListener('input', (e) => {
  if (e.target.id !== 'minQ') return;
  ui.minQ = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const q = $('#minQ'); q.focus(); q.setSelectionRange(pos, pos);
});
$('#settingsBtn').addEventListener('click', settingsModal);

/* ---------------- boot ---------------- */
applyTheme();
load().then(render).catch((e) => { console.error(e); app.innerHTML = '<div class="empty">تعذّر تحميل البيانات.</div>'; });
})();
