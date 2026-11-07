const $ = selector => document.querySelector(selector);
const state = { csrf: '', settings: null, pending: [], sales: [], importData: null, noticeTimer: null, loginGeneration: 0 };
const money = value => `$${Number(value || 0).toLocaleString('zh-TW')}`;
const twDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const twTime = value => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
const today = () => twDate(new Date());
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const assetUrl = name => window.BANANA_ASSET_BASE ? `${window.BANANA_ASSET_BASE}assets/${name}` : `/assets/${name}`;

function gasCall(path, options = {}) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const token = sessionStorage.getItem('banana_gas_session') || '';
    const key = options.headers?.['Idempotency-Key'] || '';
    google.script.run.withSuccessHandler(result => {
      if (!result.ok) {
        if (result.status === 401) showLogin();
        const error = new Error(typeof result.detail === 'string' ? result.detail : result.detail?.message || '操作失敗，請稍後再試');
        error.status = result.status;
        error.detail = result.detail;
        reject(error);
        return;
      }
      if (path === '/api/auth/session') sessionStorage.setItem('banana_gas_session', result.data.session_token);
      if (path === '/api/auth/logout') sessionStorage.removeItem('banana_gas_session');
      resolve(result.data);
    }).withFailureHandler(error => reject(new Error(error?.message || '連線失敗，請稍後再試')))
      .apiRequest(path, method, body, token, state.csrf, key);
  });
}

function notice(message, error = false) {
  const element = $('#notice');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => element.hidden = true, 6000);
}

async function api(path, options = {}) {
  if (window.GAS_MODE) return gasCall(path, options);
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (options.method && !['GET', 'HEAD'].includes(options.method)) headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/session')) showLogin();
    const error = new Error(typeof data?.detail === 'string' ? data.detail : data?.detail?.message || '操作失敗，請稍後再試');
    error.status = response.status;
    error.detail = data?.detail;
    throw error;
  }
  return data;
}

function showLogin() {
  $('#app-screen').hidden = true;
  $('#login-screen').hidden = false;
  state.csrf = '';
}

async function initialize() {
  const generation = state.loginGeneration;
  try {
    const status = await api('/api/auth/status');
    state.csrf = status.csrf_token;
    $('#login-screen').hidden = true;
    $('#app-screen').hidden = false;
    $('#today-label').textContent = `${today()} · 今天也一起加油！`;
    $('#history-from').value = $('#history-to').value = today();
    $('#stats-from').value = $('#stats-to').value = today();
    await Promise.all([refreshSettings(), refreshToday()]);
    showView('today');
  } catch { if (generation === state.loginGeneration) showLogin(); }
}

async function refreshSettings() {
  state.settings = await api('/api/settings');
  renderQuickButtons();
  const settingsForm = $('#settings-form');
  settingsForm.elements.bunch_price.value = state.settings.bunch_price;
  settingsForm.elements.piece_price.value = state.settings.piece_price;
  const custom = $('#custom-form');
  if (!$('#custom-details').open) {
    custom.elements.bunch_price.value = state.settings.bunch_price;
    custom.elements.piece_price.value = state.settings.piece_price;
  }
  updateTotals();
}

function renderQuickButtons() {
  const options = [[1, 0], [2, 0], [3, 0], [0, 1], [0, 2], [0, 5]];
  $('#quick-buttons').innerHTML = options.map(([bunch, piece]) => `<button type="button" class="quick-button" data-bunch="${bunch}" data-piece="${piece}"><img src="${assetUrl(`${bunch ? 'banana-bunch' : 'banana-piece'}.svg`)}" alt="" aria-hidden="true"><strong>＋${bunch || piece} ${bunch ? '串' : '根'}</strong><span>${money((bunch * state.settings.bunch_price) + (piece * state.settings.piece_price))}</span></button>`).join('');
}

function renderSummary(element, data) {
  element.innerHTML = [["總串數", `${data.bunch_quantity || 0} 串`, 'banana-bunch.svg'], ["總根數", `${data.piece_quantity || 0} 根`, 'banana-piece.svg'], ["總金額", money(data.total_amount), 'coins.svg']].map(([label, value, icon]) => `<div class="summary-card"><img src="${assetUrl(icon)}" alt="" aria-hidden="true"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function saleCard(sale) {
  const units = [sale.bunch_quantity && `${sale.bunch_quantity} 串`, sale.piece_quantity && `${sale.piece_quantity} 根`].filter(Boolean).join(' · ');
  return `<article class="sale-card"><div><strong>${escapeHtml(units)} · ${money(sale.total_amount)}</strong><small>${escapeHtml(twTime(sale.sold_at))} · 串 ${money(sale.bunch_price)}／根 ${money(sale.piece_price)}</small></div><div class="sale-actions"><button type="button" data-edit="${sale.id}">編輯</button><button type="button" class="danger" data-delete="${sale.id}">刪除</button></div></article>`;
}

async function refreshToday() {
  const date = today();
  const [sales, report] = await Promise.all([api(`/api/sales?date_value=${date}`), api(`/api/reports/daily?date_value=${date}`)]);
  state.sales = sales;
  renderSummary($('#today-summary'), report);
  $('#today-sales').innerHTML = sales.length ? sales.map(saleCard).join('') : '<p class="empty">今天還沒有販售紀錄。第一筆，從上方開始 🍌</p>';
}

function showView(name) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `${name}-view`;
  for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === name);
  if (name === 'history') loadHistory().catch(error => notice(error.message, true));
  if (name === 'stats') loadStats().catch(error => notice(error.message, true));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formSale(form) {
  const elements = form.elements;
  const local = elements.sold_at?.value;
  return { bunch_quantity: Number(elements.bunch_quantity.value), piece_quantity: Number(elements.piece_quantity.value), bunch_price: Number(elements.bunch_price.value), piece_price: Number(elements.piece_price.value), ...(local ? { sold_at: new Date(local).toISOString() } : {}) };
}

function updateTotals() {
  for (const [form, output] of [['#custom-form', '#custom-total'], ['#edit-form', '#edit-total']]) {
    const el = $(form);
    const data = formSale(el);
    $(output).textContent = money(data.bunch_quantity * data.bunch_price + data.piece_quantity * data.piece_price);
  }
}

async function submitSale(payload, key = crypto.randomUUID()) {
  try {
    return await api('/api/sales', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  } catch (error) {
    if (error.status !== 409 || error.detail?.code !== 'PRICE_CHANGED') throw error;
    const detail = error.detail;
    const oldTotal = payload.bunch_quantity * detail.old.bunch_price + payload.piece_quantity * detail.old.piece_price;
    const newTotal = payload.bunch_quantity * detail.new.bunch_price + payload.piece_quantity * detail.new.piece_price;
    const choice = window.prompt(`價格已變更。\n1：沿用原價 ${money(oldTotal)}\n2：採用新價 ${money(newTotal)}\n輸入 1 或 2 確認，取消則保留待送出交易。`);
    if (!['1', '2'].includes(choice)) throw new Error('已取消價格確認，交易尚未入帳');
    const updated = { ...payload, bunch_price: choice === '1' ? detail.old.bunch_price : detail.new.bunch_price, piece_price: choice === '1' ? detail.old.piece_price : detail.new.piece_price, conflict_token: choice === '1' ? detail.old_token : detail.new_token };
    if (updated.bunch_quantity * updated.bunch_price + updated.piece_quantity * updated.piece_price === 0 && !updated.zero_amount_confirmed) {
      if (!confirm('選擇的價格使本筆為 $0，確定記錄零元交易嗎？')) throw new Error('已取消零元交易確認');
      updated.zero_amount_confirmed = true;
    }
    const saved = await api('/api/sales', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(updated) });
    await refreshSettings();
    return saved;
  }
}

function renderPending() {
  $('#pending-list').innerHTML = state.pending.map(item => `<div class="pending-card"><div><strong>待送出：${item.quantity} ${item.unit} · ${money(item.quantity * item.price)}</strong><small>${item.sending ? '正在送出…' : item.failed ? '送出失敗，請重試' : `約 ${Math.max(0, Math.ceil((item.deadline - Date.now()) / 1000))} 秒後入帳`}</small></div><div>${item.sending ? '' : `<button type="button" data-undo="${item.id}">撤銷</button>`}${item.failed ? `<button type="button" data-retry="${item.id}">重試</button>` : ''}</div></div>`).join('');
}

function addQuick(bunch, piece) {
  const settings = { ...state.settings };
  const unit = bunch ? '串' : '根';
  const quantity = bunch || piece;
  const price = bunch ? settings.bunch_price : settings.piece_price;
  if (price === 0 && !confirm('這筆金額是 $0，確定要記錄零元交易嗎？')) return;
  const found = state.pending.find(item => !item.failed && item.unit === unit && item.price === price && item.version === settings.version && item.deadline > Date.now());
  if (found) {
    found.quantity += quantity;
    // The first click starts the 10 second window; further taps do not extend it.
  } else {
    const item = { id: crypto.randomUUID(), key: crypto.randomUUID(), unit, quantity, price, settings, version: settings.version, deadline: Date.now() + 10000, failed: false };
    state.pending.push(item);
    item.timer = setTimeout(() => flushQuick(item), 10000);
  }
  renderPending();
}

async function flushQuick(item) {
  if (!state.pending.includes(item) || item.sending) return;
  item.sending = true;
  renderPending();
  const payload = { bunch_quantity: item.unit === '串' ? item.quantity : 0, piece_quantity: item.unit === '根' ? item.quantity : 0, bunch_price: item.settings.bunch_price, piece_price: item.settings.piece_price, mode: 'quick', expected_settings_version: item.version, zero_amount_confirmed: item.price === 0 };
  try {
    await submitSale(payload, item.key);
    state.pending = state.pending.filter(candidate => candidate !== item);
    renderPending();
    await refreshToday();
    notice('販售已記錄');
  } catch (error) {
    item.sending = false;
    item.failed = true;
    renderPending();
    notice(error.message, true);
  }
}

function removePending(id) {
  const item = state.pending.find(candidate => candidate.id === id);
  if (!item) return;
  clearTimeout(item.timer);
  state.pending = state.pending.filter(candidate => candidate !== item);
  renderPending();
  notice('已撤銷待送出交易');
}

async function loadHistory() {
  const from = $('#history-from').value, to = $('#history-to').value;
  const sales = await api(`/api/sales?from_date=${from}&to_date=${to}`);
  const groups = new Map();
  sales.forEach(sale => {
    const day = twDate(new Date(sale.sold_at));
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(sale);
  });
  $('#history-results').innerHTML = groups.size ? [...groups].map(([day, records]) => `<details class="day-group"><summary><span>${day} · ${records.length} 筆</span><span>${money(records.reduce((total, sale) => total + sale.total_amount, 0))}</span></summary><div class="sales-list">${records.map(saleCard).join('')}</div></details>`).join('') : '<p class="empty">這個區間沒有販售紀錄。</p>';
}

async function loadStats() {
  const from = $('#stats-from').value, to = $('#stats-to').value;
  const data = await api(`/api/reports/summary?from_date=${from}&to_date=${to}`);
  renderSummary($('#stats-summary'), data);
  const max = Math.max(1, ...data.days.map(day => day.total_amount));
  $('#stats-chart').innerHTML = `<h3>每日營收</h3>${data.days.map(day => `<div class="bar-row"><span>${day.date.slice(5)}</span><div class="bar-track"><div class="bar" style="width:${(day.total_amount / max) * 100}%"></div></div><strong>${money(day.total_amount)}</strong></div>`).join('')}`;
}

function dateShortcut(value) {
  const current = today();
  const d = new Date(`${current}T12:00:00+08:00`);
  if (value === 'today') return [current, current];
  if (value === 'week') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return [twDate(d), current];
  }
  return [`${current.slice(0, 7)}-01`, current];
}

function fillRange(prefix, value) {
  const [from, to] = dateShortcut(value);
  $(`#${prefix}-from`).value = from;
  $(`#${prefix}-to`).value = to;
  (prefix === 'history' ? loadHistory() : loadStats()).catch(error => notice(error.message, true));
}

async function openEdit(id) {
  const sale = state.sales.find(item => item.id === id) || (await api(`/api/sales?from_date=${$('#history-from').value}&to_date=${$('#history-to').value}`)).find(item => item.id === id);
  if (!sale) return notice('找不到交易，請重新整理', true);
  const form = $('#edit-form');
  form.elements.id.value = sale.id;
  for (const field of ['bunch_quantity', 'piece_quantity', 'bunch_price', 'piece_price']) form.elements[field].value = sale[field];
  const local = new Date(sale.sold_at);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(local);
  form.elements.sold_at.value = parts.replace(' ', 'T');
  form.dataset.originalDate = twDate(local);
  updateTotals();
  $('#edit-dialog').showModal();
}

async function deleteSale(id) {
  const sale = state.sales.find(item => item.id === id) || (await api(`/api/sales?from_date=${$('#history-from').value}&to_date=${$('#history-to').value}`)).find(item => item.id === id);
  if (!sale) return notice('找不到交易，請重新整理', true);
  if (!confirm('確定要刪除這筆販售？這會從一般明細與統計移除。')) return;
  if (twDate(new Date(sale.sold_at)) !== today() && !confirm('這是非今日的歷史交易。請再次確認刪除。')) return;
  await api(`/api/sales/${id}`, { method: 'DELETE' });
  await refreshToday();
  if (!$('#history-view').hidden) await loadHistory();
  notice('已刪除交易');
}

async function download(path, filename) {
  if (window.GAS_MODE) {
    const file = await api(path);
    const binary = atob(file.file_base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('下載失敗，請重新登入或稍後再試');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  initialize();
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const result = await api('/api/auth/session', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
      state.csrf = result.csrf_token;
      state.loginGeneration += 1;
      $('#password').value = '';
      await initialize();
    } catch (error) { $('#login-error').textContent = error.message; }
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  $('#refresh').addEventListener('click', async () => { try { await Promise.all([refreshSettings(), refreshToday()]); if (!$('#history-view').hidden) await loadHistory(); if (!$('#stats-view').hidden) await loadStats(); notice('已更新資料'); } catch (error) { notice(error.message, true); } });
  $('#quick-buttons').addEventListener('click', event => { const button = event.target.closest('[data-bunch]'); if (button) addQuick(Number(button.dataset.bunch), Number(button.dataset.piece)); });
  $('#pending-list').addEventListener('click', event => { const undo = event.target.closest('[data-undo]'); const retry = event.target.closest('[data-retry]'); if (undo) removePending(undo.dataset.undo); if (retry) { const item = state.pending.find(candidate => candidate.id === retry.dataset.retry); if (item) flushQuick(item); } });
  setInterval(renderPending, 1000);
  document.querySelectorAll('#custom-form input,#edit-form input').forEach(input => input.addEventListener('input', updateTotals));
  $('#custom-form').addEventListener('submit', async event => {
    event.preventDefault();
    const payload = formSale(event.target);
    if (!(payload.bunch_quantity || payload.piece_quantity)) return notice('請至少輸入一串或一根', true);
    if (payload.bunch_quantity * payload.bunch_price + payload.piece_quantity * payload.piece_price === 0) {
      if (!confirm('這筆金額是 $0，確定要記錄零元交易嗎？')) return;
      payload.zero_amount_confirmed = true;
    }
    try {
      await submitSale({ ...payload, mode: 'custom' });
      event.target.elements.bunch_quantity.value = event.target.elements.piece_quantity.value = 0;
      event.target.elements.sold_at.value = '';
      $('#custom-details').open = false;
      updateTotals();
      await refreshToday();
      notice('販售已記錄');
    } catch (error) { notice(error.message, true); }
  });
  $('#settings-form').addEventListener('submit', async event => { event.preventDefault(); try { const body = { bunch_price: Number(event.target.elements.bunch_price.value), piece_price: Number(event.target.elements.piece_price.value) }; await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) }); await refreshSettings(); notice('預設價格已更新'); } catch (error) { notice(error.message, true); } });
  $('#history-form').addEventListener('submit', event => { event.preventDefault(); loadHistory().catch(error => notice(error.message, true)); });
  $('#stats-form').addEventListener('submit', event => { event.preventDefault(); loadStats().catch(error => notice(error.message, true)); });
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => fillRange('history', button.dataset.range)));
  document.querySelectorAll('[data-stat]').forEach(button => button.addEventListener('click', () => fillRange('stats', button.dataset.stat)));
  document.body.addEventListener('click', event => { const edit = event.target.closest('[data-edit]'), del = event.target.closest('[data-delete]'); if (edit) openEdit(edit.dataset.edit).catch(error => notice(error.message, true)); if (del) deleteSale(del.dataset.delete).catch(error => notice(error.message, true)); });
  $('#close-edit').addEventListener('click', () => $('#edit-dialog').close());
  $('#edit-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (event.target.dataset.originalDate !== today() && !confirm('這是非今日的歷史交易，確定要修改嗎？')) return;
    try { await api(`/api/sales/${event.target.elements.id.value}`, { method: 'PUT', body: JSON.stringify(formSale(event.target)) }); $('#edit-dialog').close(); await refreshToday(); if (!$('#history-view').hidden) await loadHistory(); notice('交易已更新；同筆交易以最後成功儲存內容為準'); } catch (error) { notice(error.message, true); }
  });
  for (const [id, extension] of [['#export-csv', 'csv'], ['#export-xlsx', 'xlsx']]) $(id).addEventListener('click', () => download(`/api/exports/sales.${extension}?from_date=${$('#history-from').value}&to_date=${$('#history-to').value}`, `banana-sales.${extension}`).catch(error => notice(error.message, true)));
  $('#download-backup').addEventListener('click', () => download('/api/exports/backup.json', 'banana-backup.json').catch(error => notice(error.message, true)));
  $('#import-file').addEventListener('change', async event => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      if (data.format !== 'banana-sales-v1' || !Array.isArray(data.sales)) throw new Error('不是本系統的 JSON 備份檔');
      state.importData = data.sales;
      const report = await api('/api/imports/preview', { method: 'POST', body: JSON.stringify({ sales: data.sales }) });
      $('#import-preview').innerHTML = `<div class="import-result">預覽：新增 ${report.new.length}、跳過 ${report.skipped.length}、衝突 ${report.conflicts.length}、已軟刪除 ${report.soft_deleted.length}、無效 ${report.invalid.length}。<br><button id="merge-import" class="primary" type="button" ${report.invalid.length ? 'disabled' : ''}>確認合併還原</button></div>`;
    } catch (error) { state.importData = null; notice(error.message, true); }
  });
  $('#import-preview').addEventListener('click', async event => {
    if (event.target.id !== 'merge-import' || !state.importData) return;
    if (!confirm('確定要合併備份？只會新增不存在的 UUID，既有資料不會覆寫。')) return;
    try { const report = await api('/api/imports/merge', { method: 'POST', body: JSON.stringify({ sales: state.importData, confirmed: true }) }); const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'banana-import-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('#import-preview').textContent = `已新增 ${report.new.length} 筆，報告已下載。`; await refreshToday(); } catch (error) { notice(error.message, true); }
  });
  $('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); showLogin(); } catch (error) { notice(error.message, true); } });
});
