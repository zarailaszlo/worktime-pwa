import { TZ, todayKey, dateKeyFromMs, nowMs, deviceTimeZone, formatTimeHMFromMs, formatMinutesHHMM, floorMinutesBetween, isValidHHMM, zonedDateTimeToEpochMs, addDaysDateKey, startMinuteTicker } from './time.js';
import { DEFAULT_RULES, normalizeRules, summarizeWork, deductionMinutes, netMinutesFromGross, targetTimeMsForNet } from './rules.js';
import { getSettings, putSettings, getWorkDay, putWorkDay, deleteWorkDay, listWorkDays, findOpenWorkDay } from './db.js';
import { recordsToCsv, buildExportJson, shareOrDownload, readFileAsText, validateImportJson } from './exportImport.js';

const VIEW = document.getElementById('viewRoot');
const TOPSUB = document.getElementById('topbarSub');
const TABS = Array.from(document.querySelectorAll('.tab'));
const MODAL = document.getElementById('modal');
const MODAL_TITLE = document.getElementById('modalTitle');
const MODAL_BODY = document.getElementById('modalBody');
const MODAL_FOOTER = document.getElementById('modalFooter');
const TOAST = document.getElementById('toast');
const TOAST_TEXT = document.getElementById('toastText');
const TOAST_ACTION = document.getElementById('toastAction');
const TOAST_CLOSE = document.getElementById('toastClose');
const APP_VERSION = resolveAppVersion();

function resolveAppVersion(){
  const fromHtml = document.documentElement.dataset.appVersion?.trim();
  if(fromHtml && !fromHtml.includes('${')) return fromHtml;
  return '0.4';
}

let state = {
  tab: 'today',
  settings: null,
  todayKey: null,
  activeDateKey: null,
  activeRecord: null,
  logRecords: [],
  tickerStop: null,
};

function defaultSettings(){
  return {
    schemaVersion: 1,
    timezone: TZ,
    rules: DEFAULT_RULES,
    openRecordDate: null,
    allowFutureCheckout: false,
    dayKeyMode: 'checkin'
  };
}

function html(strings, ...values){
  return strings.map((s,i)=> s + (values[i] ?? '')).join('');
}

function setTab(tab){
  state.tab = tab;
  for(const b of TABS){
    b.classList.toggle('tab--active', b.dataset.tab === tab);
  }
  render();
}

function setTopSub(){
  const parts = [];
  const tzDev = deviceTimeZone();
  if(tzDev && tzDev !== TZ){
    parts.push(`Figyelem: a készülék időzónája <b>${escapeHtml(tzDev)}</b>, az app <b>${TZ}</b>-t használ.`);
  }else{
    parts.push(`Időzóna: <b>${TZ}</b>`);
  }
  if(!navigator.onLine) parts.push('<b class="badge badge--warn">Offline</b>');
  if(state.activeRecord && state.activeRecord.checkOutMs == null && state.activeDateKey !== state.todayKey){
    parts.push(`<b class="badge">Folyamatban:</b> ${escapeHtml(state.activeDateKey)}`);
  }
  TOPSUB.innerHTML = parts.join(' · ');
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showToast(text, actionText = null, actionFn = null, durationMs = 8000){
  TOAST_TEXT.textContent = text;
  if(actionText && actionFn){
    TOAST_ACTION.hidden = false;
    TOAST_ACTION.textContent = actionText;
    const handler = async () => {
      try{ await actionFn(); } finally { hideToast(); }
    };
    TOAST_ACTION.onclick = handler;
  }else{
    TOAST_ACTION.hidden = true;
    TOAST_ACTION.onclick = null;
  }
  TOAST.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(hideToast, durationMs);
}
function hideToast(){
  TOAST.hidden = true;
  TOAST_ACTION.onclick = null;
}

TOAST_CLOSE.addEventListener('click', hideToast);

function openModal({title, bodyHtml, footerHtml}){
  MODAL_TITLE.textContent = title;
  MODAL_BODY.innerHTML = bodyHtml;
  MODAL_FOOTER.innerHTML = footerHtml || '';
  MODAL.hidden = false;
}
function closeModal(){
  MODAL.hidden = true;
  MODAL_TITLE.textContent = '';
  MODAL_BODY.innerHTML = '';
  MODAL_FOOTER.innerHTML = '';
}

MODAL.addEventListener('click', (e) => {
  const t = e.target;
  if(t && t.dataset && ('close' in t.dataset)) closeModal();
});

TABS.forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

window.addEventListener('online', () => setTopSub());
window.addEventListener('offline', () => setTopSub());

async function init(){
  // register SW
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); }catch(e){ /* ignore */ }
  }

  state.todayKey = todayKey();

  let settings = await getSettings();
  if(!settings){
    settings = defaultSettings();
    await putSettings(settings);
  }else{
    // backfill new props
    settings = { ...defaultSettings(), ...settings };
    settings.rules = normalizeRules(settings.rules);
    await putSettings(settings);
  }
  state.settings = settings;

  await refreshActiveRecord();
  await refreshLog();
  setTab('today');
  setTopSub();
}

async function refreshActiveRecord(){
  const openKey = state.settings.openRecordDate;
  let active = null;
  let key = null;
  if(openKey){
    active = await findOpenWorkDay(openKey);
    if(active && active.checkOutMs == null){
      key = openKey;
    }else{
      // stale open key
      state.settings.openRecordDate = null;
      await putSettings(state.settings);
      active = null;
      key = null;
    }
  }
  if(!active){
    key = state.todayKey;
    active = await getWorkDay(key);
  }
  state.activeDateKey = key;
  state.activeRecord = active;
  setTopSub();
}

async function refreshLog(){
  state.logRecords = await listWorkDays();
}

function stopTicker(){
  if(state.tickerStop){
    state.tickerStop();
    state.tickerStop = null;
  }
}

function ensureTicker(){
  stopTicker();
  if(state.tab !== 'today') return;
  if(state.activeRecord && state.activeRecord.checkInMs && state.activeRecord.checkOutMs == null){
    state.tickerStop = startMinuteTicker(() => {
      // Only update the "Today" view
      if(state.tab === 'today') renderToday();
    });
  }
}

function render(){
  setTopSub();
  if(state.tab === 'today') return renderToday();
  if(state.tab === 'log') return renderLog();
  if(state.tab === 'test') return renderTest();
  if(state.tab === 'settings') return renderSettings();
}

function renderToday(){
  const r = state.activeRecord;
  const rules = normalizeRules(state.settings.rules);

  let body = '';
  if(!r){
    // State A
    body = html`
      <div class="card">
        <div class="row row--between">
          <div>
            <div class="h2">Ma</div>
            <div class="small">${escapeHtml(state.todayKey)}</div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="field">
          <label>Check-in idő</label>
          <div class="seg" role="tablist" aria-label="Check-in mód">
            <button class="seg__btn seg__btn--active" data-action="mode" data-target="in" data-mode="now">Most</button>
            <button class="seg__btn" data-action="mode" data-target="in" data-mode="manual">Kézzel</button>
          </div>
          <div class="modeManual" id="inManual" hidden>
            <input class="input" type="time" id="inTime" step="60" />
          </div>
          <div class="small" id="inHelp"></div>
        </div>

        <button class="btn" data-action="checkin">Check-in</button>
      </div>

      <div class="card">
        <div class="h2">Tippek</div>
        <div class="small">iPhone-on telepítés: Safari → Megosztás → <b>Főképernyőhöz</b>. Offline is működni fog.</div>
      </div>
    `;
  } else if(r.checkInMs && r.checkOutMs == null){
    // State B
    const now = nowMs();
    const grossMin = Math.max(0, floorMinutesBetween(r.checkInMs, now));
    const dedMin = deductionMinutes(grossMin, rules);
    const netMin = Math.max(0, grossMin - dedMin);

    const targets = [360, 420, 480].map(t => {
      const tMs = targetTimeMsForNet({ checkInMs: r.checkInMs, targetNetMinutes: t, rules });
      const achieved = now >= tMs;
      return { targetMin: t, tMs, achieved };
    });

    body = html`
      <div class="card">
        <div class="h2">Eddig dolgoztál (nettó)</div>
        <div class="kpi" id="netKpi">${escapeHtml(formatMinutesHHMM(netMin))}</div>
        <div class="kpiSub">
          Bruttó: <b>${escapeHtml(formatMinutesHHMM(grossMin))}</b> · Levonás: <b>${dedMin} perc</b> · Nettó: <b>${escapeHtml(formatMinutesHHMM(netMin))}</b>
        </div>
        <div class="small">Check-in: <b>${escapeHtml(formatTimeHMFromMs(r.checkInMs))}</b> (${escapeHtml(r.date)})</div>
      </div>

      <div class="card">
        <div class="field">
          <label>Check-out idő</label>
          <div class="seg" role="tablist" aria-label="Check-out mód">
            <button class="seg__btn seg__btn--active" data-action="mode" data-target="out" data-mode="now">Most</button>
            <button class="seg__btn" data-action="mode" data-target="out" data-mode="manual">Kézzel</button>
          </div>
          <div class="modeManual" id="outManual" hidden>
            <input class="input" type="time" id="outTime" step="60" />
          </div>
          <div class="small" id="outHelp"></div>
        </div>
        <button class="btn" data-action="checkout">Check-out</button>
      </div>

      <div class="card">
        <div class="h2">Mikor lesz meg nettóban…</div>
        <div class="list">
          ${targets.map(x => {
            const label = (x.targetMin/60).toFixed(0) + ':00';
            const time = formatTimeHMFromMs(x.tMs);
            if(x.achieved) return `<div class="list__row"><div><b>${label}</b></div><div class="right"><span class="ok">✅ Megvan (${escapeHtml(time)})</span></div></div>`;
            return `<div class="list__row"><div><b>${label}</b></div><div class="right">${escapeHtml(time)}</div></div>`;
          }).join('')}
        </div>
        <div class="small">A nettó idő küszöb után fokozatosan épül tovább (pl. 6:00–6:30 bruttó között nettó 6:00).</div>
      </div>
    `;
  } else {
    // State C
    const sum = summarizeWork(r.checkInMs, r.checkOutMs, rules);
    const targets = [360, 420, 480].map(t => {
      const tMs = targetTimeMsForNet({ checkInMs: r.checkInMs, targetNetMinutes: t, rules });
      const achieved = r.checkOutMs >= tMs;
      return { targetMin: t, tMs, achieved };
    });

    body = html`
      <div class="card">
        <div class="h2">Mai nap összegzés</div>
        <div class="divider"></div>
        <div class="kv">
          <div class="kv__row"><div class="small">Dátum</div><div><b>${escapeHtml(r.date)}</b></div></div>
          <div class="kv__row"><div class="small">Check-in</div><div><b>${escapeHtml(formatTimeHMFromMs(r.checkInMs))}</b></div></div>
          <div class="kv__row"><div class="small">Check-out</div><div><b>${escapeHtml(formatTimeHMFromMs(r.checkOutMs))}</b></div></div>
          <div class="kv__row"><div class="small">Bruttó</div><div><b>${escapeHtml(formatMinutesHHMM(sum.grossMinutes))}</b></div></div>
          <div class="kv__row"><div class="small">Levonás</div><div><b>${sum.deductionMin} perc</b></div></div>
          <div class="kv__row"><div class="small">Nettó</div><div><b>${escapeHtml(formatMinutesHHMM(sum.netMinutes))}</b></div></div>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <button class="btn btn--secondary" data-action="editDay" data-date="${escapeHtml(r.date)}">Szerkesztés</button>
          <button class="btn btn--danger" data-action="deleteDay" data-date="${escapeHtml(r.date)}">Törlés (mai nap)</button>
        </div>
      </div>

      <div class="card">
        <div class="h2">Mikor lett meg nettóban…</div>
        <div class="list">
          ${targets.map(x => {
            const label = (x.targetMin/60).toFixed(0) + ':00';
            const time = formatTimeHMFromMs(x.tMs);
            if(x.achieved) return `<div class="list__row"><div><b>${label}</b></div><div class="right"><span class="ok">✅ Megvan (${escapeHtml(time)})</span></div></div>`;
            return `<div class="list__row"><div><b>${label}</b></div><div class="right"><span class="small">Nem lett meg</span></div></div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  VIEW.innerHTML = body;

  if(currentMode('in') === 'now') fillNow('in');
  if(currentMode('out') === 'now') fillNow('out');

  ensureTicker();
}

function renderLog(){
  stopTicker();
  const rows = state.logRecords;
  const rules = normalizeRules(state.settings.rules);

  const items = rows.map(r => {
    let net = '';
    let gross = '';
    let ded = '';
    if(r.checkInMs && r.checkOutMs){
      const sum = summarizeWork(r.checkInMs, r.checkOutMs, rules);
      net = formatMinutesHHMM(sum.netMinutes);
      gross = formatMinutesHHMM(sum.grossMinutes);
      ded = sum.deductionMin + ' perc';
    } else if(r.checkInMs && !r.checkOutMs){
      net = 'Folyamatban';
      gross = '';
      ded = '';
    }
    return `<button class="listItem" data-action="openDay" data-date="${escapeHtml(r.date)}">
      <div class="listItem__main">
        <div class="listItem__title">${escapeHtml(r.date)}</div>
        <div class="listItem__sub">${gross ? `Bruttó: ${escapeHtml(gross)} · Levonás: ${escapeHtml(ded)}` : '<span class="small">nincs lezárva</span>'}</div>
      </div>
      <div class="listItem__right">${escapeHtml(net)}</div>
    </button>`;
  }).join('');

  VIEW.innerHTML = html`
    <div class="card">
      <div class="h2">Napló</div>
      <div class="small">Kattints egy napra a részletekhez. Offline is elérhető.</div>
    </div>

    <div class="card">
      ${rows.length ? `<div class="listStack">${items}</div>` : '<div class="small">Még nincs mentett nap.</div>'}
    </div>
  `;
}

function renderTest(){
  stopTicker();
  VIEW.innerHTML = html`
    <div class="card card--test">
      <div class="h2">Teszt (nem ment)</div>
      <div class="small">Két dátum+idő alapján ugyanazzal a szabálymotorral számol.</div>
      <div class="divider"></div>

      <div class="grid2">
        <div class="field">
          <label>Kezdés dátum</label>
          <input class="input" type="date" id="tStartDate" />
        </div>
        <div class="field">
          <label>Kezdés idő</label>
          <input class="input" type="time" id="tStartTime" step="60" />
        </div>
        <div class="field">
          <label>Befejezés dátum</label>
          <input class="input" type="date" id="tEndDate" />
        </div>
        <div class="field">
          <label>Befejezés idő</label>
          <input class="input" type="time" id="tEndTime" step="60" />
        </div>
      </div>
      <button class="btn" data-action="runTest">Számol</button>
    </div>

    <div class="card" id="testResult" hidden></div>
  `;

  // defaults
  const t = state.todayKey;
  const startDate = document.getElementById('tStartDate');
  const endDate = document.getElementById('tEndDate');
  startDate.value = t;
  endDate.value = t;
}

function renderSettings(){
  stopTicker();
  const rules = normalizeRules(state.settings.rules);
  VIEW.innerHTML = html`
    <div class="card">
      <div class="h2">Beállítások</div>
      <div class="small">Szünetlevonási szabályok, export/import.</div>
    </div>

    <div class="card">
      <div class="h2">Szünetlevonás szabályai</div>
      <div class="small">Érvényesül: küszöbönként levonás, de a nettó nem eshet a küszöb nettó értéke alá (pl. 6:00–6:30 között nettó 6:00).</div>
      <div class="divider"></div>
      <div class="rules" id="rules">
        ${rules.map((r, i) => {
          const thrH = Math.floor(r.thresholdMin/60);
          const thrM = r.thresholdMin % 60;
          return `<div class="ruleRow" data-idx="${i}">
            <div class="ruleRow__col">
              <div class="small">Küszöb (óra:perc)</div>
              <div class="timePair">
                <input class="input input--sm timePair__input" inputmode="numeric" pattern="\d*" data-field="thrH" value="${thrH}" />
                <span class="small timePair__sep">:</span>
                <input class="input input--sm timePair__input" inputmode="numeric" pattern="\d*" data-field="thrM" value="${String(thrM).padStart(2,'0')}" />
              </div>
            </div>
            <div class="ruleRow__col">
              <div class="small">Levonás (perc)</div>
              <input class="input input--sm" inputmode="numeric" pattern="\d*" data-field="ded" value="${r.deductionMin}" />
            </div>
            <div class="ruleRow__col ruleRow__col--btn">
              <button class="btn btn--secondary" data-action="removeRule" data-idx="${i}">Törlés</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="row">
        <button class="btn btn--secondary" data-action="addRule">+ Szabály hozzáadása</button>
        <button class="btn" data-action="saveRules">Mentés</button>
      </div>
      <button class="btn btn--secondary" data-action="resetRules">Alapértelmezett visszaállítás</button>
      <div class="small" id="rulesMsg"></div>
    </div>

    <div class="card">
      <div class="h2">Haladó</div>
      <div class="divider"></div>
      <label class="switch">
        <input type="checkbox" id="allowFutureCheckout" ${state.settings.allowFutureCheckout ? 'checked' : ''} />
        <span class="switch__ui"></span>
        <span class="switch__label">Check-out engedélyezése a jövőbe (admin mód)</span>
      </label>
      <div class="small">Alapból tiltva. Ha bekapcsolod, kézi check-out lehet későbbi, mint a "most".</div>
    </div>

    <div class="card">
      <div class="h2">Export / Import</div>
      <div class="divider"></div>
      <div class="row">
        <button class="btn" data-action="exportCsv">Export CSV</button>
        <button class="btn btn--secondary" data-action="exportJson">Export JSON</button>
      </div>
      <div class="divider"></div>
      <div class="field">
        <label>Import JSON</label>
        <input class="input" type="file" id="importFile" accept="application/json" />
        <div class="small">Duplikált dátum esetén felülír (figyelmeztetéssel).</div>
      </div>
      <div class="small" id="exMsg"></div>
    </div>

    <div class="small settingsVersion">Verzió: ${APP_VERSION}</div>
  `;
}

// ----------------- actions -----------------

VIEW.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if(!btn) return;
  const action = btn.dataset.action;
  try{
    if(action === 'mode') return toggleMode(btn.dataset.target, btn.dataset.mode);
    if(action === 'fillNow') return fillNow(btn.dataset.target);
    if(action === 'checkin') return doCheckIn();
    if(action === 'checkout') return doCheckOut();
    if(action === 'editDay') return openEditDay(btn.dataset.date);
    if(action === 'deleteDay') return confirmDeleteDay(btn.dataset.date);
    if(action === 'openDay') return openDayDetails(btn.dataset.date);
    if(action === 'runTest') return runTest();
    if(action === 'addRule') return addRule();
    if(action === 'removeRule') return removeRule(Number(btn.dataset.idx));
    if(action === 'saveRules') return saveRules();
    if(action === 'resetRules') return resetRules();
    if(action === 'exportCsv') return exportCsv();
    if(action === 'exportJson') return exportJson();
  }catch(err){
    const msg = humanError(err);
    showToast(msg);
  }
});

VIEW.addEventListener('change', async (e) => {
  const el = e.target;
  if(el && el.id === 'allowFutureCheckout'){
    state.settings.allowFutureCheckout = el.checked;
    await putSettings(state.settings);
    showToast('Mentve.');
  }
  if(el && el.id === 'importFile'){
    const file = el.files && el.files[0];
    if(file) await importJson(file);
    el.value = '';
  }
});

function toggleMode(target, mode){
  const segBtns = Array.from(document.querySelectorAll(`.seg__btn[data-target="${target}"]`));
  segBtns.forEach(b => b.classList.toggle("seg__btn--active", b.dataset.mode === mode));
  const row = document.getElementById(target === "in" ? "inManual" : "outManual");
  if(row) row.hidden = (mode !== "manual");

  if(mode === "now" && target === "in"){
    fillNow('in');
    return;
  }

  if(mode === "manual"){
    const input = document.getElementById(target === "in" ? "inTime" : "outTime");
    if(input && !input.value) input.value = formatTimeHMFromMs(nowMs());
  }
}

function fillNow(target){
  const input = document.getElementById(target === 'in' ? 'inTime' : 'outTime');
  if(!input) return;
  const now = nowMs();
  input.value = formatTimeHMFromMs(now);
}

function currentMode(target){
  const btn = document.querySelector(`.seg__btn--active[data-target="${target}"]`);
  return btn ? btn.dataset.mode : 'now';
}

async function doCheckIn(){
  if(state.settings.openRecordDate){
    throw new Error('ALREADY_OPEN');
  }
  const dateKey = state.todayKey;
  const existing = await getWorkDay(dateKey);
  if(existing){
    throw new Error('ALREADY_CHECKED_IN');
  }

  const mode = currentMode('in');
  let ms;
  if(mode === 'now'){
    ms = nowMs();
  }else{
    const val = document.getElementById('inTime').value;
    if(!isValidHHMM(val)) throw new Error('INVALID_TIME');
    ms = zonedDateTimeToEpochMs({ dateKey, timeHM: val, notAfterMs: nowMs() });
  }

  if(ms > nowMs()) throw new Error('FUTURE_CHECKIN');

  const rec = {
    version: 1,
    date: dateKey,
    checkInMs: ms,
    checkOutMs: null,
    createdAtMs: nowMs(),
    updatedAtMs: nowMs(),
  };
  await putWorkDay(rec);
  state.settings.openRecordDate = dateKey;
  await putSettings(state.settings);

  showToast('Check-in mentve.', 'Undo', async () => {
    await deleteWorkDay(dateKey);
    state.settings.openRecordDate = null;
    await putSettings(state.settings);
    await refreshActiveRecord();
    await refreshLog();
    render();
  });

  await refreshActiveRecord();
  await refreshLog();
  render();
}

async function doCheckOut(){
  const r = state.activeRecord;
  if(!r || !r.checkInMs || r.checkOutMs != null) throw new Error('NO_OPEN_DAY');

  const mode = currentMode('out');
  let endMs;
  if(mode === 'now'){
    endMs = nowMs();
  }else{
    const val = document.getElementById('outTime').value;
    if(!isValidHHMM(val)) throw new Error('INVALID_TIME');

    const maxMs = state.settings.allowFutureCheckout ? null : nowMs();
    // candidate on same day
    let cand = zonedDateTimeToEpochMs({ dateKey: r.date, timeHM: val, notAfterMs: maxMs });
    if(cand < r.checkInMs){
      // interpret as next day (overnight)
      const nextKey = addDaysDateKey(r.date, 1);
      cand = zonedDateTimeToEpochMs({ dateKey: nextKey, timeHM: val, notAfterMs: maxMs });
    }
    endMs = cand;
  }

  if(endMs < r.checkInMs) throw new Error('CHECKOUT_BEFORE_CHECKIN');
  if(!state.settings.allowFutureCheckout && endMs > nowMs()) throw new Error('FUTURE_CHECKOUT');

  const updated = { ...r, checkOutMs: endMs, updatedAtMs: nowMs() };
  await putWorkDay(updated);
  state.settings.openRecordDate = null;
  await putSettings(state.settings);

  const endKey = dateKeyFromMs(endMs);
  const note = (endKey !== r.date) ? " (A check-out másnapra esik, a nap a check-in dátumán kerül mentésre.)" : "";

  showToast("Check-out mentve." + note, "Undo", async () => {
    const back = { ...updated, checkOutMs: null, updatedAtMs: nowMs() };
    await putWorkDay(back);
    state.settings.openRecordDate = updated.date;
    await putSettings(state.settings);
    await refreshActiveRecord();
    await refreshLog();
    render();
  });

  await refreshActiveRecord();
  await refreshLog();
  render();
}

async function openDayDetails(dateKey){
  const r = await getWorkDay(dateKey);
  if(!r) return;
  const rules = normalizeRules(state.settings.rules);
  let content = '';
  if(r.checkInMs && r.checkOutMs){
    const sum = summarizeWork(r.checkInMs, r.checkOutMs, rules);
    content = html`
      <div class="kv">
        <div class="kv__row"><div class="small">Dátum</div><div><b>${escapeHtml(r.date)}</b></div></div>
        <div class="kv__row"><div class="small">Check-in</div><div><b>${escapeHtml(formatTimeHMFromMs(r.checkInMs))}</b></div></div>
        <div class="kv__row"><div class="small">Check-out</div><div><b>${escapeHtml(formatTimeHMFromMs(r.checkOutMs))}</b></div></div>
        <div class="kv__row"><div class="small">Bruttó</div><div><b>${escapeHtml(formatMinutesHHMM(sum.grossMinutes))}</b></div></div>
        <div class="kv__row"><div class="small">Levonás</div><div><b>${sum.deductionMin} perc</b></div></div>
        <div class="kv__row"><div class="small">Nettó</div><div><b>${escapeHtml(formatMinutesHHMM(sum.netMinutes))}</b></div></div>
      </div>
    `;
  }else{
    content = `<div class="small">Folyamatban lévő nap. Check-in: <b>${escapeHtml(formatTimeHMFromMs(r.checkInMs))}</b></div>`;
  }

  openModal({
    title: `Nap: ${dateKey}`,
    bodyHtml: content,
    footerHtml: `
      <div class="row">
        <button class="btn btn--secondary" data-action="modalEdit" data-date="${escapeHtml(dateKey)}">Szerkesztés</button>
        <button class="btn btn--danger" data-action="modalDelete" data-date="${escapeHtml(dateKey)}">Törlés</button>
      </div>
    `
  });

  // attach modal footer handlers (simple, since modal recreated each time)
  MODAL_FOOTER.querySelector('[data-action="modalEdit"]').onclick = () => { closeModal(); openEditDay(dateKey); };
  MODAL_FOOTER.querySelector('[data-action="modalDelete"]').onclick = () => { closeModal(); confirmDeleteDay(dateKey); };
}

async function openEditDay(dateKey){
  const r = await getWorkDay(dateKey);
  if(!r) return;
  const inVal = r.checkInMs ? formatTimeHMFromMs(r.checkInMs) : '';
  const outVal = r.checkOutMs ? formatTimeHMFromMs(r.checkOutMs) : '';

  openModal({
    title: `Szerkesztés – ${dateKey}`,
    bodyHtml: html`
      <div class="field">
        <label>Check-in (HH:MM)</label>
        <input class="input" type="time" id="editIn" step="60" value="${escapeHtml(inVal)}" />
      </div>
      <div class="field">
        <label>Check-out (HH:MM) – üresen hagyható</label>
        <input class="input" type="time" id="editOut" step="60" value="${escapeHtml(outVal)}" />
        <div class="small">Ha a check-out idő kisebb, mint a check-in, másnapként értelmezzük (éjszakázás).</div>
      </div>
      <div class="small" id="editMsg"></div>
    `,
    footerHtml: `
      <div class="row">
        <button class="btn btn--secondary" data-action="cancelEdit">Mégse</button>
        <button class="btn" data-action="saveEdit" data-date="${escapeHtml(dateKey)}">Mentés</button>
      </div>
    `
  });

  MODAL_FOOTER.querySelector('[data-action="cancelEdit"]').onclick = closeModal;
  MODAL_FOOTER.querySelector('[data-action="saveEdit"]').onclick = async () => {
    const inT = document.getElementById('editIn').value;
    const outT = document.getElementById('editOut').value;
    const msg = document.getElementById('editMsg');
    try{
      if(!isValidHHMM(inT)) throw new Error('INVALID_TIME');
      const inMs = zonedDateTimeToEpochMs({ dateKey, timeHM: inT });
      let outMs = null;
      if(outT){
        if(!isValidHHMM(outT)) throw new Error('INVALID_TIME');
        // same day candidate
        let cand = zonedDateTimeToEpochMs({ dateKey, timeHM: outT });
        if(cand < inMs){
          const nextKey = addDaysDateKey(dateKey, 1);
          cand = zonedDateTimeToEpochMs({ dateKey: nextKey, timeHM: outT });
        }
        if(cand < inMs) throw new Error('CHECKOUT_BEFORE_CHECKIN');
        outMs = cand;
      }

      const updated = { ...r, checkInMs: inMs, checkOutMs: outMs, updatedAtMs: nowMs() };
      await putWorkDay(updated);

      // open record pointer maintenance
      if(updated.checkOutMs == null){
        state.settings.openRecordDate = updated.date;
      }else if(state.settings.openRecordDate === updated.date){
        state.settings.openRecordDate = null;
      }
      await putSettings(state.settings);

      await refreshActiveRecord();
      await refreshLog();
      closeModal();
      render();
      showToast('Mentve.');
    }catch(e){
      msg.textContent = humanError(e);
    }
  };
}

async function confirmDeleteDay(dateKey){
  openModal({
    title: 'Törlés megerősítése',
    bodyHtml: `<div class="small">Biztosan törlöd ezt a napot? <b>${escapeHtml(dateKey)}</b> (Visszaállítás csak importból lehetséges.)</div>`,
    footerHtml: `
      <div class="row">
        <button class="btn btn--secondary" data-action="noDel">Mégse</button>
        <button class="btn btn--danger" data-action="yesDel" data-date="${escapeHtml(dateKey)}">Törlés</button>
      </div>
    `
  });
  MODAL_FOOTER.querySelector('[data-action="noDel"]').onclick = closeModal;
  MODAL_FOOTER.querySelector('[data-action="yesDel"]').onclick = async () => {
    await deleteWorkDay(dateKey);
    if(state.settings.openRecordDate === dateKey){
      state.settings.openRecordDate = null;
      await putSettings(state.settings);
    }
    closeModal();
    await refreshActiveRecord();
    await refreshLog();
    render();
    showToast('Törölve.');
  };
}

async function runTest(){
  const sd = document.getElementById('tStartDate').value;
  const st = document.getElementById('tStartTime').value;
  const ed = document.getElementById('tEndDate').value;
  const et = document.getElementById('tEndTime').value;
  if(!sd || !ed || !isValidHHMM(st) || !isValidHHMM(et)) throw new Error('INVALID_INPUT');

  const startMs = zonedDateTimeToEpochMs({ dateKey: sd, timeHM: st });
  const endMs = zonedDateTimeToEpochMs({ dateKey: ed, timeHM: et });
  if(endMs < startMs) throw new Error('NEGATIVE_DURATION');

  const rules = normalizeRules(state.settings.rules);
  const sum = summarizeWork(startMs, endMs, rules);

  const panel = document.getElementById('testResult');
  panel.hidden = false;
  panel.innerHTML = html`
    <div class="h2">Eredmény</div>
    <div class="divider"></div>
    <div class="kv">
      <div class="kv__row"><div class="small">Bruttó</div><div><b>${escapeHtml(formatMinutesHHMM(sum.grossMinutes))}</b></div></div>
      <div class="kv__row"><div class="small">Levonás</div><div><b>${sum.deductionMin} perc</b></div></div>
      <div class="kv__row"><div class="small">Nettó</div><div><b>${escapeHtml(formatMinutesHHMM(sum.netMinutes))}</b></div></div>
    </div>
  `;
}

function addRule(){
  const rules = normalizeRules(state.settings.rules);
  const last = rules[rules.length-1] || { thresholdMin: 0, deductionMin: 0 };
  rules.push({ thresholdMin: last.thresholdMin + 60, deductionMin: last.deductionMin });
  state.settings.rules = rules;
  renderSettings();
}

function removeRule(idx){
  const rules = normalizeRules(state.settings.rules);
  rules.splice(idx, 1);
  state.settings.rules = rules;
  renderSettings();
}

async function saveRules(){
  const wrap = document.getElementById('rules');
  const rows = Array.from(wrap.querySelectorAll('.ruleRow'));
  const next = [];
  for(const row of rows){
    const thrH = Number(row.querySelector('[data-field="thrH"]').value || 0);
    const thrM = Number(row.querySelector('[data-field="thrM"]').value || 0);
    const ded = Number(row.querySelector('[data-field="ded"]').value || 0);
    const thresholdMin = Math.max(0, Math.floor(thrH*60 + thrM));
    const deductionMin = Math.max(0, Math.floor(ded));
    next.push({ thresholdMin, deductionMin });
  }
  const norm = normalizeRules(next);

  // validate increasing thresholds
  for(let i=1;i<norm.length;i++){
    if(norm[i].thresholdMin <= norm[i-1].thresholdMin) throw new Error('RULE_ORDER');
  }

  state.settings.rules = norm;
  await putSettings(state.settings);
  const msg = document.getElementById('rulesMsg');
  if(msg) msg.textContent = 'Mentve.';
  showToast('Szabályok mentve.');

  await refreshActiveRecord();
  await refreshLog();
  if(state.tab === 'settings') renderSettings();
}

async function resetRules(){
  state.settings.rules = DEFAULT_RULES;
  await putSettings(state.settings);
  renderSettings();
  showToast('Visszaállítva.');
}

async function exportCsv(){
  const rules = normalizeRules(state.settings.rules);
  const csv = recordsToCsv(state.logRecords, rules);
  await shareOrDownload({ filename: `worktime_${state.todayKey}.csv`, mime: 'text/csv;charset=utf-8', data: csv });
  const msg = document.getElementById('exMsg');
  if(msg) msg.textContent = 'CSV export kész.';
}

async function exportJson(){
  const json = buildExportJson(state.logRecords, state.settings);
  const data = JSON.stringify(json, null, 2);
  await shareOrDownload({ filename: `worktime_${state.todayKey}.json`, mime: 'application/json', data });
  const msg = document.getElementById('exMsg');
  if(msg) msg.textContent = 'JSON export kész.';
}

async function importJson(file){
  const text = await readFileAsText(file);
  let json;
  try{ json = JSON.parse(text); }catch(e){ throw new Error('INVALID_JSON'); }
  validateImportJson(json);

  const overwriteDates = new Set();
  for(const r of json.records){
    if(!r || typeof r !== 'object' || !r.date) continue;
    overwriteDates.add(r.date);
    const rec = {
      version: 1,
      date: String(r.date),
      checkInMs: Number(r.checkInMs) || null,
      checkOutMs: (r.checkOutMs == null ? null : Number(r.checkOutMs)),
      createdAtMs: Number(r.createdAtMs) || nowMs(),
      updatedAtMs: Number(r.updatedAtMs) || nowMs(),
    };
    // basic sanity
    if(!rec.checkInMs) continue;
    await putWorkDay(rec);
  }

  // settings: keep current openRecordDate if import doesn't include
  const importedSettings = { ...defaultSettings(), ...json.settings };
  importedSettings.rules = normalizeRules(importedSettings.rules);

  // After import, recompute openRecordDate from any open day (latest). Prefer existing ongoing.
  let open = null;
  for(const r of await listWorkDays()){
    if(r.checkInMs && r.checkOutMs == null){ open = r; break; }
  }
  importedSettings.openRecordDate = open ? open.date : null;

  state.settings = importedSettings;
  await putSettings(state.settings);

  await refreshActiveRecord();
  await refreshLog();
  render();

  const msg = document.getElementById('exMsg');
  if(msg) msg.textContent = `Import kész. Érintett napok: ${overwriteDates.size}.`;
  showToast(`Import kész. (${overwriteDates.size} nap)`);
}

function humanError(err){
  const code = (err && (err.code || err.message)) ? String(err.code || err.message) : 'HIBA';
  switch(code){
    case 'ALREADY_OPEN':
      return 'Van folyamatban lévő nap. Előbb check-out vagy törlés/szerkesztés.';
    case 'ALREADY_CHECKED_IN':
      return 'Ma már van check-in. Szerkesztéshez nyisd meg az összegzést.';
    case 'INVALID_TIME':
    case 'INVALID_INPUT':
      return 'Érvénytelen idő/dátum. Használd a HH:MM formátumot.';
    case 'FUTURE_TIME':
    case 'FUTURE_CHECKIN':
      return 'A check-in nem lehet a jövőben.';
    case 'FUTURE_CHECKOUT':
      return 'A check-out alapból nem lehet a jövőben.';
    case 'CHECKOUT_BEFORE_CHECKIN':
      return 'A check-out nem lehet a check-in előtt.';
    case 'NEGATIVE_DURATION':
      return 'A befejezés nem lehet a kezdés előtt.';
    case 'NO_OPEN_DAY':
      return 'Nincs folyamatban lévő nap.';
    case 'RULE_ORDER':
      return 'A szabályok küszöbei legyenek növekvő sorrendben.';
    case 'INVALID_JSON':
      return 'Érvénytelen JSON fájl.';
    case 'MISSING_RECORDS':
    case 'MISSING_SETTINGS':
      return 'A JSON export nem tartalmazza a szükséges mezőket.';
    default:
      return 'Hiba: ' + code;
  }
}

// Start
init();
