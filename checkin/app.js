const SUPABASE_URL = 'https://otpcdlgwlaifirhfnnat.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90cGNkbGd3bGFpZmlyaGZubmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4ODQ5NzQsImV4cCI6MjA5MTQ2MDk3NH0.nC92brW3QJPbkh9IQ8q3-S6W-Mw8WLtcKXoIJ-8xkHo';

const DEFAULT_ITEMS = [
  { type: 'accounting',  name: '记账',       color: '#8E7AA8', hasDetail: false },
  { type: 'bowel',       name: '排便',       color: '#A896B8', hasDetail: true },
  { type: 'foam_roller', name: '滚泡沫轴',   color: '#C9B8D4', hasDetail: false },
  { type: 'no_carbs',    name: '晚上不吃碳水', color: '#7A6B8E', hasDetail: false },
];

let ITEMS = [...DEFAULT_ITEMS];

const BOWEL_OPTIONS = {
  quantity: { label: '数量', options: ['少量', '正常', '较多'] },
  odor:     { label: '气味', options: ['无味', '轻微', '正常', '较重'] },
  shape:    { label: '形态', options: ['硬块', '条状偏硬', '香蕉型', '软条', '糊状', '水状'] },
  feeling:  { label: '感受', options: ['轻松', '正常', '费力', '不适'] },
};

const TREND_COLORS = {
  0: '#E8E1EC', 1: '#D9C9E0', 2: '#C9B8D4', 3: '#A896B8', 4: '#8E7AA8',
};

let sb = null;
let useSupabase = false;
let calendarMonth = new Date();
let monthData = {};
let selectedDate = todayStr();
let dateCheckins = {};
let editingBowelId = null;

function getDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() { return getDateStr(new Date()); }

function formatDateLabel(ds) {
  if (ds === todayStr()) return '今日打卡';
  const [, m, d] = ds.split('-');
  return `${parseInt(m)}月${parseInt(d)}日 ${new Date(ds) < new Date(todayStr()) ? '补卡' : '打卡'}`;
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getRecordTime(rec) {
  return rec.details?.record_time || formatTime(rec.created_at);
}

function nowTimeStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

function countDoneTypes(checkins) {
  return ITEMS.filter(item => (checkins[item.type] || []).length > 0).length;
}

// ===== 存储层 =====

function localKey(date) { return `checkin_${date}`; }

function loadLocal(date) {
  try {
    const raw = JSON.parse(localStorage.getItem(localKey(date))) || {};
    Object.keys(raw).forEach(type => {
      if (raw[type] && !Array.isArray(raw[type])) {
        raw[type] = raw[type].completed
          ? [{ id: Date.now() + Math.random(), details: raw[type].details || {}, created_at: new Date().toISOString() }]
          : [];
      }
    });
    return raw;
  } catch { return {}; }
}

function saveLocal(date, data) {
  localStorage.setItem(localKey(date), JSON.stringify(data));
}

async function initSupabase() {
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await sb.from('daily_checkins').select('id').limit(1);
    if (!error) useSupabase = true;
  } catch {}
}

async function loadItemsFromDB() {
  if (!useSupabase) return;
  try {
    const { data, error } = await sb.from('checkin_items').select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error || !data || data.length === 0) return; // 回退到默认
    ITEMS = data.map(row => ({
      type: row.type,
      name: row.name,
      color: row.color,
      hasDetail: row.has_detail || false,
    }));
  } catch { /* 表不存在时用默认 */ }
}

async function loadAllItemsForSettings() {
  if (!useSupabase) return [];
  try {
    const { data, error } = await sb.from('checkin_items').select('*')
      .order('sort_order', { ascending: true });
    if (error || !data) return [];
    return data;
  } catch { return []; }
}

async function saveNewItem(name, color) {
  if (!useSupabase) return;
  const type = name.replace(/\s+/g, '_').toLowerCase() + '_' + Date.now();
  const { data: maxOrder } = await sb.from('checkin_items').select('sort_order')
    .order('sort_order', { ascending: false }).limit(1);
  const nextOrder = (maxOrder && maxOrder.length > 0) ? maxOrder[0].sort_order + 1 : ITEMS.length + 1;
  await sb.from('checkin_items').insert({
    type,
    name,
    color: color || '#A896B8',
    has_detail: false,
    sort_order: nextOrder,
    active: true,
  });
}

async function toggleItemActive(id, active) {
  if (!useSupabase) return;
  await sb.from('checkin_items').update({ active }).eq('id', id);
}

async function reorderItem(id, direction) {
  if (!useSupabase) return;
  const items = await loadAllItemsForSettings();
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return;
  // 交换 sort_order
  const orderA = items[idx].sort_order;
  const orderB = items[swapIdx].sort_order;
  await sb.from('checkin_items').update({ sort_order: orderB }).eq('id', items[idx].id);
  await sb.from('checkin_items').update({ sort_order: orderA }).eq('id', items[swapIdx].id);
}

async function initItemsTable() {
  // 如果表为空，用默认值初始化
  if (!useSupabase) return;
  try {
    const { data } = await sb.from('checkin_items').select('id').limit(1);
    if (data && data.length > 0) return; // 已有数据
    // 插入默认项目
    const inserts = DEFAULT_ITEMS.map((item, i) => ({
      type: item.type,
      name: item.name,
      color: item.color,
      has_detail: item.hasDetail,
      sort_order: i + 1,
      active: true,
    }));
    await sb.from('checkin_items').insert(inserts);
  } catch { /* 表可能不存在 */ }
}

// ===== 设置面板 =====

async function openSettings() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');

  const panel = document.getElementById('settingsPanel');
  panel.style.display = 'block';
  await renderSettingsItems();
}

function closeSettings() {
  document.getElementById('settingsPanel').style.display = 'none';
}

async function renderSettingsItems() {
  const items = await loadAllItemsForSettings();
  const container = document.getElementById('settingsItemList');

  if (items.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">数据库中暂无自定义项目（使用默认项目）</div>';
    return;
  }

  container.innerHTML = items.map((item, idx) => `
    <div class="settings-item ${item.active ? '' : 'inactive'}">
      <div class="settings-item-dot" style="background:${item.color}"></div>
      <span class="settings-item-name">${item.name}</span>
      <div class="settings-item-actions">
        <button class="settings-btn" onclick="moveItem(${item.id}, 'up')" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="settings-btn" onclick="moveItem(${item.id}, 'down')" ${idx === items.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="settings-btn toggle-btn" onclick="toggleItem(${item.id}, ${item.active ? 'false' : 'true'})">${item.active ? '停用' : '启用'}</button>
      </div>
    </div>
  `).join('');
}

window.openSettings = openSettings;
window.closeSettings = closeSettings;

window.moveItem = async function(id, direction) {
  await reorderItem(id, direction);
  await renderSettingsItems();
};

window.toggleItem = async function(id, active) {
  await toggleItemActive(id, active);
  await renderSettingsItems();
  await loadItemsFromDB();
  dateCheckins = await loadCheckins(selectedDate);
  renderCheckinList();
};

window.addNewItem = async function() {
  const nameInput = document.getElementById('newItemName');
  const colorInput = document.getElementById('newItemColor');
  const name = nameInput.value.trim();
  if (!name) return;
  await saveNewItem(name, colorInput.value);
  nameInput.value = '';
  await renderSettingsItems();
  // 立刻刷新主页面
  await loadItemsFromDB();
  dateCheckins = await loadCheckins(selectedDate);
  renderCheckinList();
};

window.applySettings = async function() {
  await loadItemsFromDB();
  closeSettings();
  // 重新渲染所有内容
  dateCheckins = await loadCheckins(selectedDate);
  renderOverview();
  renderQuickStats();
  renderCheckinList();
  renderCalendar();
  renderMonthlyStats();
  renderItemStreaks();
  renderTrendChart();
  updateStreak();
};

async function loadCheckins(date) {
  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('*')
      .eq('checkin_date', date).eq('completed', true)
      .order('created_at', { ascending: true });
    const result = {};
    (data || []).forEach(row => {
      if (!result[row.item_type]) result[row.item_type] = [];
      result[row.item_type].push({ id: row.id, details: row.details || {}, created_at: row.created_at });
    });
    return result;
  }
  return loadLocal(date);
}

async function addCheckin(date, itemType, details) {
  let record = { id: Date.now(), details: details || {}, created_at: new Date().toISOString() };
  if (useSupabase) {
    const { data } = await sb.from('daily_checkins')
      .insert({ checkin_date: date, item_type: itemType, completed: true, details: details || {} })
      .select('id, created_at').single();
    if (data) { record.id = data.id; record.created_at = data.created_at; }
  }
  const local = loadLocal(date);
  if (!local[itemType]) local[itemType] = [];
  local[itemType].push(record);
  saveLocal(date, local);
  return record;
}

async function deleteCheckinById(id, date, itemType) {
  if (useSupabase) {
    await sb.from('daily_checkins').delete().eq('id', id);
  }
  const local = loadLocal(date);
  if (local[itemType]) {
    local[itemType] = local[itemType].filter(r => r.id !== id);
    if (local[itemType].length === 0) delete local[itemType];
  }
  saveLocal(date, local);
}

async function updateCheckinDetails(id, date, itemType, details) {
  if (useSupabase) {
    await sb.from('daily_checkins').update({ details, updated_at: new Date().toISOString() }).eq('id', id);
  }
  const local = loadLocal(date);
  if (local[itemType]) {
    const rec = local[itemType].find(r => r.id === id);
    if (rec) rec.details = details;
  }
  saveLocal(date, local);
}

async function loadMonthData(year, month) {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('checkin_date, item_type')
      .gte('checkin_date', startDate).lte('checkin_date', endDate).eq('completed', true);
    const sets = {};
    (data || []).forEach(row => {
      if (!sets[row.checkin_date]) sets[row.checkin_date] = new Set();
      sets[row.checkin_date].add(row.item_type);
    });
    const result = {};
    Object.entries(sets).forEach(([d, s]) => { result[d] = s.size; });
    return result;
  }

  const result = {};
  for (let d = 1; d <= endDay; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const local = loadLocal(ds);
    const count = Object.keys(local).filter(t => Array.isArray(local[t]) && local[t].length > 0).length;
    if (count > 0) result[ds] = count;
  }
  return result;
}

async function loadLast30Days() {
  const d = new Date();
  const endDate = getDateStr(d);
  d.setDate(d.getDate() - 29);
  const startDate = getDateStr(d);

  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('checkin_date, item_type')
      .gte('checkin_date', startDate).lte('checkin_date', endDate).eq('completed', true);
    const sets = {};
    (data || []).forEach(row => {
      if (!sets[row.checkin_date]) sets[row.checkin_date] = new Set();
      sets[row.checkin_date].add(row.item_type);
    });
    const counts = {};
    Object.entries(sets).forEach(([date, set]) => { counts[date] = set.size; });
    return counts;
  }

  const result = {};
  for (let i = 0; i < 30; i++) {
    const ds = getDateStr(d);
    const local = loadLocal(ds);
    const count = Object.keys(local).filter(t => Array.isArray(local[t]) && local[t].length > 0).length;
    if (count > 0) result[ds] = count;
    d.setDate(d.getDate() + 1);
  }
  return result;
}

async function calcStreak() {
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = getDateStr(d);
    const checkins = await loadCheckins(ds);
    const doneCount = countDoneTypes(checkins);
    if (doneCount === ITEMS.length) { streak++; d.setDate(d.getDate() - 1); }
    else if (ds === todayStr() && doneCount > 0) { d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

async function calcLongestStreak() {
  if (!useSupabase) return 0;
  // 查询所有完成的打卡记录，按日期分组统计各天完成的项目类型数
  const { data } = await sb.from('daily_checkins')
    .select('checkin_date, item_type')
    .eq('completed', true)
    .order('checkin_date', { ascending: true });
  if (!data || data.length === 0) return 0;

  // 统计每天完成了多少种不同类型
  const dateTypes = {};
  data.forEach(row => {
    if (!dateTypes[row.checkin_date]) dateTypes[row.checkin_date] = new Set();
    dateTypes[row.checkin_date].add(row.item_type);
  });

  // 找出所有全勤的日期
  const fullDates = Object.entries(dateTypes)
    .filter(([, types]) => types.size >= ITEMS.length)
    .map(([date]) => date)
    .sort();

  if (fullDates.length === 0) return 0;

  // 找最长连续天数
  let longest = 1;
  let current = 1;
  for (let i = 1; i < fullDates.length; i++) {
    const prev = new Date(fullDates[i - 1] + 'T00:00:00');
    const curr = new Date(fullDates[i] + 'T00:00:00');
    const diff = (curr - prev) / 86400000;
    if (diff === 1) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

async function calcItemStreak(itemType) {
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = getDateStr(d);
    const checkins = await loadCheckins(ds);
    if ((checkins[itemType] || []).length > 0) { streak++; d.setDate(d.getDate() - 1); }
    else if (ds === todayStr()) { d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

// ===== 渲染 =====

function renderClock() {
  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  document.getElementById('dateText').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]}`;
  document.getElementById('timeText').textContent = now.toTimeString().slice(0, 8);
}

function renderOverview() {
  const container = document.getElementById('overviewItems');
  const renderData = (data) => {
    let doneCount = 0;
    container.innerHTML = ITEMS.map(item => {
      const count = (data[item.type] || []).length;
      if (count > 0) doneCount++;
      return `<div class="overview-item">
        <span class="item-left"><span class="item-dot" style="background:${item.color}"></span>${item.name}</span>
        <span class="status ${count > 0 ? 'done' : 'pending'}">${count > 0 ? (count > 1 ? '×' + count : '✓') : '—'}</span>
      </div>`;
    }).join('');
    const pct = Math.round(doneCount / ITEMS.length * 100);
    document.getElementById('progressPercent').textContent = pct + '%';
    document.getElementById('progressFill').style.width = pct + '%';
  };

  if (selectedDate !== todayStr()) {
    loadCheckins(todayStr()).then(renderData);
  } else {
    renderData(dateCheckins);
  }
}

function renderQuickStats() {
  document.getElementById('quickStats').innerHTML = ITEMS.map(item => {
    const count = (dateCheckins[item.type] || []).length;
    return `<div class="stat-card">
      <div class="stat-dot" style="background:${item.color}"></div>
      <div class="stat-value${count > 0 ? ' done' : ''}">${count > 0 ? count : '—'}</div>
      <div class="stat-label">${item.name}</div>
    </div>`;
  }).join('');
}

function renderCheckinList() {
  const container = document.getElementById('checkinList');
  document.getElementById('checkinTitle').textContent = formatDateLabel(selectedDate);

  container.innerHTML = ITEMS.map(item => {
    const records = dateCheckins[item.type] || [];
    const count = records.length;
    const checked = count > 0;

    let html = `<div class="checkin-group">
      <div class="checkin-item${checked ? ' checked' : ''}" onclick="addRecord('${item.type}')">
        <div class="checkin-dot" style="background:${item.color}"></div>
        <div class="checkin-info"><div class="checkin-name">${item.name}</div></div>
        <div class="checkin-count${checked ? ' active' : ''}">${checked ? count : ''}</div>
      </div>`;

    if (count > 0) {
      html += `<div class="record-list">`;
      records.forEach(rec => {
        const time = getRecordTime(rec);
        const timeHtml = `<span class="record-time editable" onclick="event.stopPropagation(); editRecordTime('${item.type}', ${rec.id})">${time}</span>`;
        if (item.hasDetail) {
          const d = rec.details || {};
          const parts = [];
          if (d.quantity) parts.push(d.quantity);
          if (d.shape) parts.push(d.shape);
          if (d.feeling) parts.push(d.feeling);
          const summary = parts.length ? parts.join(' · ') : '点击填写详情';
          const note = d.note ? `<span class="record-note-text">${d.note}</span>` : '';
          html += `<div class="record-row clickable" data-id="${rec.id}" onclick="editBowelRecord(${rec.id})">
            ${timeHtml}
            <span class="record-summary">${summary}</span>
            ${note}
            <button class="record-del" onclick="event.stopPropagation(); deleteRecord('${item.type}', ${rec.id})">×</button>
          </div>`;
        } else {
          const note = rec.details?.note || '';
          html += `<div class="record-row" data-id="${rec.id}">
            ${timeHtml}`;
          if (note) {
            html += `<span class="record-note-text">${note}</span>
              <button class="record-note-btn" onclick="openRecordNote('${item.type}', ${rec.id})">编辑</button>`;
          } else {
            html += `<span class="record-spacer"></span>
              <button class="record-note-btn" onclick="openRecordNote('${item.type}', ${rec.id})">备注</button>`;
          }
          html += `<button class="record-del" onclick="deleteRecord('${item.type}', ${rec.id})">×</button>
          </div>`;
        }
      });
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }).join('');
}

async function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  document.getElementById('calendarTitle').textContent = `${year}年${month + 1}月`;
  monthData = await loadMonthData(year, month);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const today = todayStr();
  const headers = ['日', '一', '二', '三', '四', '五', '六'];
  let html = headers.map(h => `<div class="cal-header">${h}</div>`).join('');

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day other-month">${daysInPrev - firstDay + 1 + i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = monthData[ds] || 0;
    let cls = 'cal-day';
    if (ds === today) cls += ' today';
    if (ds === selectedDate) cls += ' selected';
    if (count > 0) cls += ` checked-${Math.min(count, 4)}`;
    html += `<div class="${cls}" data-date="${ds}" onclick="selectDate('${ds}')">${d}</div>`;
  }
  const remaining = (7 - (firstDay + daysInMonth) % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-day other-month">${i}</div>`;
  }
  document.getElementById('calendar').innerHTML = html;
}

async function renderMonthlyStats() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const counts = {};
  ITEMS.forEach(item => { counts[item.type] = 0; });

  if (useSupabase) {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const { data } = await sb.from('daily_checkins').select('item_type, checkin_date')
      .gte('checkin_date', startDate).lte('checkin_date', endDate).eq('completed', true);
    const dateSets = {};
    ITEMS.forEach(item => { dateSets[item.type] = new Set(); });
    (data || []).forEach(row => { if (dateSets[row.item_type]) dateSets[row.item_type].add(row.checkin_date); });
    ITEMS.forEach(item => { counts[item.type] = dateSets[item.type].size; });
  } else {
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const local = loadLocal(ds);
      Object.entries(local).forEach(([type, arr]) => {
        if (Array.isArray(arr) && arr.length > 0 && counts[type] !== undefined) counts[type]++;
      });
    }
  }

  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const maxDays = isCurrentMonth ? today.getDate() : daysInMonth;

  document.getElementById('monthlyStats').innerHTML = ITEMS.map(item => `
    <div class="month-stat">
      <div class="month-stat-dot" style="background:${item.color}"></div>
      <div class="month-stat-value">${counts[item.type]}</div>
      <div class="month-stat-total">/ ${maxDays} 天</div>
      <div class="month-stat-label">${item.name}</div>
    </div>
  `).join('');
}

async function renderItemStreaks() {
  const container = document.getElementById('itemStreaks');
  const streaks = await Promise.all(ITEMS.map(item => calcItemStreak(item.type)));
  container.innerHTML = ITEMS.map((item, i) => `
    <div class="item-streak">
      <div class="item-streak-dot" style="background:${item.color}"></div>
      <div class="item-streak-value">${streaks[i]}</div>
      <div class="item-streak-unit">天</div>
      <div class="item-streak-label">${item.name}</div>
    </div>
  `).join('');
}

async function renderTrendChart() {
  const data = await loadLast30Days();
  const d = new Date();
  d.setDate(d.getDate() - 29);

  let html = '';
  for (let i = 0; i < 30; i++) {
    const ds = getDateStr(d);
    const count = data[ds] || 0;
    const height = count === 0 ? 4 : (count / ITEMS.length) * 100;
    const color = TREND_COLORS[count] || TREND_COLORS[4];
    const label = `${parseInt(ds.split('-')[1])}/${parseInt(ds.split('-')[2])}`;
    html += `<div class="trend-bar" style="height:${height}%;background:${color}" data-tip="${label}: ${count}/${ITEMS.length}"></div>`;
    d.setDate(d.getDate() + 1);
  }

  document.getElementById('trendChart').innerHTML = html;
  document.getElementById('trendLegend').innerHTML = [
    { label: '0项', color: TREND_COLORS[0] },
    { label: '1项', color: TREND_COLORS[1] },
    { label: '2项', color: TREND_COLORS[2] },
    { label: '3项', color: TREND_COLORS[3] },
    { label: '全部', color: TREND_COLORS[4] },
  ].map(l => `<span class="trend-legend-item"><span class="trend-legend-dot" style="background:${l.color}"></span>${l.label}</span>`).join('');
}

function renderBowelForm() {
  const form = document.getElementById('bowelForm');
  const records = dateCheckins.bowel || [];
  const record = records.find(r => r.id === editingBowelId);
  const bowelData = record?.details || {};

  let html = '';
  Object.entries(BOWEL_OPTIONS).forEach(([key, config]) => {
    html += `<div class="bowel-group" data-key="${key}">
      <label>${config.label}</label>
      <div class="bowel-options">
        ${config.options.map(opt => `<div class="bowel-opt${bowelData[key] === opt ? ' selected' : ''}"
          onclick="selectBowelOpt('${key}', '${opt}', this)">${opt}</div>`).join('')}
      </div>
    </div>`;
  });

  const note = bowelData.note || '';
  html += `<div class="bowel-note-group">
    <label>备注</label>
    <textarea class="bowel-note-input" placeholder="写点备注…">${note}</textarea>
  </div>`;
  html += `<button class="bowel-save" onclick="saveBowelDetail()">保存详情</button>`;
  form.innerHTML = html;
}

function showBowelCard() {
  const card = document.getElementById('bowelCard');
  if (editingBowelId !== null) {
    card.style.display = 'block';
    renderBowelForm();
  } else {
    card.style.display = 'none';
  }
}

// ===== 排便趋势 =====

async function loadBowelTrend() {
  const d = new Date();
  const endDate = getDateStr(d);
  d.setDate(d.getDate() - 29);
  const startDate = getDateStr(d);

  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('details')
      .eq('item_type', 'bowel').eq('completed', true)
      .gte('checkin_date', startDate).lte('checkin_date', endDate);
    return (data || []).map(r => r.details).filter(d => d && Object.keys(d).length > 0);
  }

  const results = [];
  for (let i = 0; i < 30; i++) {
    const ds = getDateStr(d);
    const local = loadLocal(ds);
    (local.bowel || []).forEach(rec => {
      if (rec.details && Object.keys(rec.details).length > 0) results.push(rec.details);
    });
    d.setDate(d.getDate() + 1);
  }
  return results;
}

async function renderBowelTrend() {
  const container = document.getElementById('bowelTrend');
  if (!container) return;
  const data = await loadBowelTrend();
  if (data.length === 0) {
    container.innerHTML = '<p class="bowel-trend-empty">暂无排便数据</p>';
    return;
  }

  function countField(field) {
    const counts = {};
    data.forEach(d => { if (d[field]) counts[d[field]] = (counts[d[field]] || 0) + 1; });
    return counts;
  }

  function renderDist(title, counts, options) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) return '';
    return `<div class="bowel-dist">
      <div class="bowel-dist-title">${title}</div>
      ${options.map(opt => {
        const count = counts[opt] || 0;
        const pct = Math.round(count / total * 100);
        return `<div class="bowel-dist-row">
          <span class="bowel-dist-label">${opt}</span>
          <div class="bowel-dist-bar-bg"><div class="bowel-dist-bar-fill" style="width:${pct}%"></div></div>
          <span class="bowel-dist-pct">${count}次</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  container.innerHTML =
    renderDist('形态分布', countField('shape'), BOWEL_OPTIONS.shape.options) +
    renderDist('感受分布', countField('feeling'), BOWEL_OPTIONS.feeling.options);
}

// ===== 庆祝动效 =====

function showCelebration() {
  if (document.querySelector('.celebration-toast')) return;
  const toast = document.createElement('div');
  toast.className = 'celebration-toast';
  toast.textContent = '全部完成';
  document.body.appendChild(toast);
  requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('show')); });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  }, 1800);
}

// ===== 交互 =====

async function addRecord(type) {
  const prevDoneTypes = countDoneTypes(dateCheckins);
  const record = await addCheckin(selectedDate, type, { record_time: nowTimeStr() });
  if (!dateCheckins[type]) dateCheckins[type] = [];
  dateCheckins[type].push(record);

  if (type === 'bowel') {
    editingBowelId = record.id;
  }

  const nowDoneTypes = countDoneTypes(dateCheckins);
  if (nowDoneTypes === ITEMS.length && prevDoneTypes < ITEMS.length) showCelebration();

  renderCheckinList();
  renderOverview();
  renderQuickStats();
  renderCalendar();
  renderMonthlyStats();
  renderItemStreaks();
  renderTrendChart();
  renderBowelTrend();
  updateStreak();
  showBowelCard();
}

async function deleteRecord(type, id) {
  await deleteCheckinById(id, selectedDate, type);
  if (dateCheckins[type]) {
    dateCheckins[type] = dateCheckins[type].filter(r => r.id !== id);
    if (dateCheckins[type].length === 0) delete dateCheckins[type];
  }
  if (editingBowelId === id) editingBowelId = null;

  renderCheckinList();
  renderOverview();
  renderQuickStats();
  renderCalendar();
  renderMonthlyStats();
  renderItemStreaks();
  renderTrendChart();
  renderBowelTrend();
  updateStreak();
  showBowelCard();
}

window.addRecord = addRecord;
window.deleteRecord = deleteRecord;

window.editBowelRecord = function(id) {
  editingBowelId = id;
  showBowelCard();
  document.getElementById('bowelCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.editRecordTime = function(type, id) {
  const records = dateCheckins[type] || [];
  const record = records.find(r => r.id === id);
  if (!record) return;

  const row = document.querySelector(`.record-row[data-id="${id}"]`);
  if (!row) return;
  const timeEl = row.querySelector('.record-time');
  if (!timeEl || timeEl.querySelector('input')) return;

  const current = getRecordTime(record);
  timeEl.innerHTML = `<input type="time" class="time-picker" value="${current}" onchange="saveRecordTime('${type}', ${id}, this)" onblur="saveRecordTime('${type}', ${id}, this)">`;
  const input = timeEl.querySelector('input');
  input.focus();
};

window.saveRecordTime = async function(type, id, el) {
  const newTime = el.value;
  if (!newTime) { renderCheckinList(); return; }

  const records = dateCheckins[type] || [];
  const record = records.find(r => r.id === id);
  if (!record) return;

  const details = { ...(record.details || {}), record_time: newTime };
  record.details = details;
  await updateCheckinDetails(id, selectedDate, type, details);
  renderCheckinList();
};

window.selectBowelOpt = function(key, value, el) {
  el.parentElement.querySelectorAll('.bowel-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
};

window.saveBowelDetail = async function() {
  if (editingBowelId === null) return;
  const records = dateCheckins.bowel || [];
  const record = records.find(r => r.id === editingBowelId);
  if (!record) return;

  const details = { ...(record.details || {}) };
  Object.keys(BOWEL_OPTIONS).forEach(key => {
    const group = document.querySelector(`.bowel-group[data-key="${key}"]`);
    const selected = group?.querySelector('.bowel-opt.selected');
    if (selected) details[key] = selected.textContent.trim();
  });

  const noteInput = document.querySelector('.bowel-note-input');
  if (noteInput) {
    const note = noteInput.value.trim();
    if (note) details.note = note;
    else delete details.note;
  }

  record.details = details;
  await updateCheckinDetails(editingBowelId, selectedDate, 'bowel', details);
  renderCheckinList();

  const btn = document.querySelector('.bowel-save');
  btn.textContent = '已保存 ✓';
  setTimeout(() => { btn.textContent = '保存详情'; }, 1500);
};

window.openRecordNote = function(type, id) {
  const records = dateCheckins[type] || [];
  const record = records.find(r => r.id === id);
  if (!record) return;

  const row = document.querySelector(`.record-row[data-id="${id}"]`);
  if (!row) return;

  const currentNote = record.details?.note || '';
  const time = row.querySelector('.record-time')?.textContent || '';

  row.innerHTML = `<span class="record-time">${time}</span>
    <textarea class="record-note-input" placeholder="写点备注…" onblur="saveRecordNote('${type}', ${id}, this)">${currentNote}</textarea>
    <button class="record-del" onclick="deleteRecord('${type}', ${id})">×</button>`;

  const textarea = row.querySelector('.record-note-input');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
};

window.saveRecordNote = async function(type, id, el) {
  const note = el.value.trim();
  const records = dateCheckins[type] || [];
  const record = records.find(r => r.id === id);
  if (!record) return;

  const details = { ...(record.details || {}), note };
  if (!note) delete details.note;

  record.details = details;
  await updateCheckinDetails(id, selectedDate, type, details);
  renderCheckinList();
};

window.selectDate = async function(ds) {
  selectedDate = ds;
  editingBowelId = null;
  dateCheckins = await loadCheckins(ds);
  document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.cal-day[data-date="${ds}"]`);
  if (el) el.classList.add('selected');
  renderCheckinList();
  renderQuickStats();
  renderOverview();
  showBowelCard();
};

async function updateStreak() {
  document.getElementById('streakNumber').textContent = await calcStreak();
  const longest = await calcLongestStreak();
  const longestEl = document.getElementById('longestStreakNumber');
  if (longestEl) longestEl.textContent = longest;
}

// ===== 导出 =====

window.exportData = async function() {
  const btn = document.getElementById('exportBtn');
  btn.textContent = '导出中…';
  btn.disabled = true;

  let rows = [];
  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('*').eq('completed', true).order('checkin_date', { ascending: true });
    rows = data || [];
  }

  const itemNames = {};
  ITEMS.forEach(i => { itemNames[i.type] = i.name; });

  let csv = '﻿日期,项目,数量,气味,形态,感受,备注\n';
  rows.forEach(r => {
    const d = r.details || {};
    const name = itemNames[r.item_type] || r.item_type;
    const fields = [
      r.checkin_date,
      name,
      d.quantity || '',
      d.odor || '',
      d.shape || '',
      d.feeling || '',
      (d.note || '').replace(/"/g, '""'),
    ];
    csv += fields.map(f => f.includes(',') || f.includes('"') || f.includes('\n') ? `"${f}"` : f).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `打卡记录_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  btn.textContent = '导出数据';
  btn.disabled = false;
};

// ===== 导航 =====

document.getElementById('prevMonth').onclick = () => {
  calendarMonth.setMonth(calendarMonth.getMonth() - 1);
  renderCalendar();
  renderMonthlyStats();
};

document.getElementById('nextMonth').onclick = () => {
  calendarMonth.setMonth(calendarMonth.getMonth() + 1);
  renderCalendar();
  renderMonthlyStats();
};

// ===== 移动端菜单 =====

document.getElementById('menuBtn').onclick = () => {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
};

document.getElementById('sidebarOverlay').onclick = () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
};

// ===== 初始化 =====

async function init() {
  renderClock();
  setInterval(renderClock, 1000);
  await initSupabase();
  await initItemsTable();
  await loadItemsFromDB();
  dateCheckins = await loadCheckins(todayStr());
  renderOverview();
  renderQuickStats();
  renderCheckinList();
  renderCalendar();
  renderMonthlyStats();
  renderItemStreaks();
  renderTrendChart();
  renderBowelTrend();
  updateStreak();
  showBowelCard();
}

init();
