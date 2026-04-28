const SUPABASE_URL = 'https://otpcdlgwlaifirhfnnat.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90cGNkbGd3bGFpZmlyaGZubmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4ODQ5NzQsImV4cCI6MjA5MTQ2MDk3NH0.nC92brW3QJPbkh9IQ8q3-S6W-Mw8WLtcKXoIJ-8xkHo';

const ITEMS = [
  { type: 'accounting',  name: '记账',       color: '#8E7AA8', hasDetail: false },
  { type: 'bowel',       name: '排便',       color: '#A896B8', hasDetail: true },
  { type: 'foam_roller', name: '滚泡沫轴',   color: '#C9B8D4', hasDetail: false },
  { type: 'no_carbs',    name: '晚上不吃碳水', color: '#7A6B8E', hasDetail: false },
];

const BOWEL_OPTIONS = {
  quantity: { label: '数量', options: ['少量', '正常', '较多'] },
  odor:     { label: '气味', options: ['无味', '轻微', '正常', '较重'] },
  shape:    { label: '形态', options: ['硬块', '条状偏硬', '香蕉型', '软条', '糊状', '水状'] },
  feeling:  { label: '感受', options: ['轻松', '正常', '费力', '不适'] },
};

const TREND_COLORS = {
  0: '#E8E1EC',
  1: '#D9C9E0',
  2: '#C9B8D4',
  3: '#A896B8',
  4: '#8E7AA8',
};

let sb = null;
let useSupabase = false;
let calendarMonth = new Date();
let monthData = {};
let selectedDate = todayStr();
let dateCheckins = {};

function getDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return getDateStr(new Date());
}

function formatDateLabel(ds) {
  if (ds === todayStr()) return '今日打卡';
  const [y, m, d] = ds.split('-');
  const isPast = new Date(ds) < new Date(todayStr());
  return `${parseInt(m)}月${parseInt(d)}日 ${isPast ? '补卡' : '打卡'}`;
}

// ===== 存储层 =====

function localKey(date) { return `checkin_${date}`; }

function loadLocal(date) {
  try { return JSON.parse(localStorage.getItem(localKey(date))) || {}; }
  catch { return {}; }
}

function saveLocal(date, data) {
  localStorage.setItem(localKey(date), JSON.stringify(data));
}

async function initSupabase() {
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await sb.from('daily_checkins').select('id').limit(1);
    if (!error) { useSupabase = true; }
  } catch {}
}

async function loadCheckins(date) {
  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('*').eq('checkin_date', date);
    const result = {};
    (data || []).forEach(row => {
      result[row.item_type] = { completed: row.completed, details: row.details || {} };
    });
    return result;
  }
  return loadLocal(date);
}

async function saveCheckin(date, itemType, completed, details) {
  if (useSupabase) {
    const payload = { checkin_date: date, item_type: itemType, completed, details: details || {}, updated_at: new Date().toISOString() };
    const { data: existing } = await sb.from('daily_checkins').select('id').eq('checkin_date', date).eq('item_type', itemType).maybeSingle();
    if (existing) await sb.from('daily_checkins').update(payload).eq('id', existing.id);
    else await sb.from('daily_checkins').insert(payload);
  }
  const local = loadLocal(date);
  local[itemType] = { completed, details: details || {} };
  saveLocal(date, local);
}

async function deleteCheckin(date, itemType) {
  if (useSupabase) {
    await sb.from('daily_checkins').delete().eq('checkin_date', date).eq('item_type', itemType);
  }
  const local = loadLocal(date);
  delete local[itemType];
  saveLocal(date, local);
}

async function loadMonthData(year, month) {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('checkin_date, item_type, completed')
      .gte('checkin_date', startDate).lte('checkin_date', endDate).eq('completed', true);
    const result = {};
    (data || []).forEach(row => {
      if (!result[row.checkin_date]) result[row.checkin_date] = 0;
      result[row.checkin_date]++;
    });
    return result;
  }

  const result = {};
  for (let d = 1; d <= endDay; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = Object.values(loadLocal(ds)).filter(v => v.completed).length;
    if (count > 0) result[ds] = count;
  }
  return result;
}

async function loadLast30Days() {
  const result = {};
  const d = new Date();
  const endDate = getDateStr(d);
  d.setDate(d.getDate() - 29);
  const startDate = getDateStr(d);

  if (useSupabase) {
    const { data } = await sb.from('daily_checkins').select('checkin_date, item_type')
      .gte('checkin_date', startDate).lte('checkin_date', endDate).eq('completed', true);
    (data || []).forEach(row => {
      if (!result[row.checkin_date]) result[row.checkin_date] = new Set();
      result[row.checkin_date].add(row.item_type);
    });
    const counts = {};
    Object.entries(result).forEach(([date, set]) => { counts[date] = set.size; });
    return counts;
  }

  for (let i = 0; i < 30; i++) {
    const ds = getDateStr(d);
    const count = Object.values(loadLocal(ds)).filter(v => v.completed).length;
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
    const doneCount = Object.values(checkins).filter(v => v.completed).length;
    if (doneCount === ITEMS.length) { streak++; d.setDate(d.getDate() - 1); }
    else if (ds === todayStr() && doneCount > 0) { d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

async function calcItemStreak(itemType) {
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = getDateStr(d);
    const checkins = await loadCheckins(ds);
    if (checkins[itemType]?.completed) { streak++; d.setDate(d.getDate() - 1); }
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
      const checked = data[item.type]?.completed;
      if (checked) doneCount++;
      return `<div class="overview-item">
        <span class="item-left"><span class="item-dot" style="background:${item.color}"></span>${item.name}</span>
        <span class="status ${checked ? 'done' : 'pending'}">${checked ? '✓' : '—'}</span>
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
    const checked = dateCheckins[item.type]?.completed;
    return `<div class="stat-card">
      <div class="stat-dot" style="background:${item.color}"></div>
      <div class="stat-value${checked ? ' done' : ''}">${checked ? '✓' : '—'}</div>
      <div class="stat-label">${item.name}</div>
    </div>`;
  }).join('');
}

function renderCheckinList() {
  const container = document.getElementById('checkinList');
  document.getElementById('checkinTitle').textContent = formatDateLabel(selectedDate);

  container.innerHTML = ITEMS.map(item => {
    const record = dateCheckins[item.type];
    const checked = record?.completed;
    const note = record?.details?.note || '';
    const detailClass = item.hasDetail ? ' has-detail' : '';
    const arrow = item.hasDetail ? '<span class="detail-arrow">›</span>' : '';

    let detailSummary = '';
    if (checked && item.hasDetail && record?.details) {
      const d = record.details;
      const parts = [];
      if (d.quantity) parts.push(d.quantity);
      if (d.shape) parts.push(d.shape);
      if (d.feeling) parts.push(d.feeling);
      if (parts.length) detailSummary = `<div class="checkin-detail-summary">${parts.join(' · ')}</div>`;
    }

    let noteHtml = '';
    if (checked) {
      if (note) {
        noteHtml = `<div class="checkin-note-area">
          <div class="note-preview">${note}</div>
          <button class="note-toggle" onclick="event.stopPropagation(); openNote('${item.type}')">编辑备注</button>
        </div>`;
      } else {
        noteHtml = `<div class="checkin-note-area">
          <button class="note-toggle" onclick="event.stopPropagation(); openNote('${item.type}')">+ 备注</button>
        </div>`;
      }
    }

    return `<div class="checkin-item${checked ? ' checked' : ''}${detailClass}"
         data-type="${item.type}" onclick="toggleCheckin('${item.type}')">
      <div class="checkin-dot" style="background:${item.color}"></div>
      <div class="checkin-info">
        <div class="checkin-name">${item.name}</div>
        ${detailSummary}
        ${noteHtml}
      </div>
      ${arrow}
      <div class="checkin-check">${checked ? '✓' : ''}</div>
    </div>`;
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
    const { data } = await sb.from('daily_checkins').select('item_type')
      .gte('checkin_date', startDate).lte('checkin_date', endDate).eq('completed', true);
    (data || []).forEach(row => { if (counts[row.item_type] !== undefined) counts[row.item_type]++; });
  } else {
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      Object.entries(loadLocal(ds)).forEach(([type, val]) => {
        if (val.completed && counts[type] !== undefined) counts[type]++;
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
  const bowelData = dateCheckins.bowel?.details || {};

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
  html += `<button class="bowel-save" onclick="saveBowelDetail()">保存详情</button>`;
  form.innerHTML = html;
}

function showBowelCard() {
  const card = document.getElementById('bowelCard');
  if (dateCheckins.bowel?.completed) { card.style.display = 'block'; renderBowelForm(); }
  else { card.style.display = 'none'; }
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
    if (local.bowel?.completed && local.bowel.details) results.push(local.bowel.details);
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

async function toggleCheckin(type) {
  const prevDone = Object.values(dateCheckins).filter(v => v.completed).length;
  const current = dateCheckins[type];

  if (type === 'bowel') {
    if (!current?.completed) {
      dateCheckins[type] = { completed: true, details: current?.details || {} };
      await saveCheckin(selectedDate, type, true, dateCheckins[type].details);
    } else {
      delete dateCheckins[type];
      await deleteCheckin(selectedDate, type);
    }
    showBowelCard();
  } else {
    if (!current?.completed) {
      dateCheckins[type] = { completed: true, details: {} };
      await saveCheckin(selectedDate, type, true, {});
    } else {
      delete dateCheckins[type];
      await deleteCheckin(selectedDate, type);
    }
  }

  const nowDone = Object.values(dateCheckins).filter(v => v.completed).length;
  if (nowDone === ITEMS.length && prevDone < ITEMS.length) showCelebration();

  renderCheckinList();
  renderOverview();
  renderQuickStats();
  renderCalendar();
  renderMonthlyStats();
  renderItemStreaks();
  renderTrendChart();
  renderBowelTrend();
  updateStreak();
}

window.selectBowelOpt = function(key, value, el) {
  el.parentElement.querySelectorAll('.bowel-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
};

window.saveBowelDetail = async function() {
  const details = { ...(dateCheckins.bowel?.details || {}) };
  Object.keys(BOWEL_OPTIONS).forEach(key => {
    const group = document.querySelector(`.bowel-group[data-key="${key}"]`);
    const selected = group?.querySelector('.bowel-opt.selected');
    if (selected) details[key] = selected.textContent.trim();
  });

  dateCheckins.bowel = { completed: true, details };
  await saveCheckin(selectedDate, 'bowel', true, details);
  renderCheckinList();

  const btn = document.querySelector('.bowel-save');
  btn.textContent = '已保存 ✓';
  setTimeout(() => { btn.textContent = '保存详情'; }, 1500);
};

window.openNote = function(type) {
  const record = dateCheckins[type];
  if (!record?.completed) return;

  const noteArea = document.querySelector(`.checkin-item[data-type="${type}"] .checkin-note-area`);
  if (!noteArea) return;

  const currentNote = record.details?.note || '';
  noteArea.innerHTML = `<textarea class="note-input" placeholder="写点备注…" onblur="saveNote('${type}', this)">${currentNote}</textarea>`;
  const textarea = noteArea.querySelector('.note-input');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
};

window.saveNote = async function(type, el) {
  const note = el.value.trim();
  const record = dateCheckins[type];
  if (!record) return;

  const details = { ...(record.details || {}), note };
  if (!note) delete details.note;

  dateCheckins[type] = { completed: true, details };
  await saveCheckin(selectedDate, type, true, details);
  renderCheckinList();
};

window.selectDate = async function(ds) {
  selectedDate = ds;
  dateCheckins = await loadCheckins(ds);
  document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.cal-day[data-date="${ds}"]`);
  if (el) el.classList.add('selected');
  renderCheckinList();
  renderQuickStats();
  renderOverview();
  showBowelCard();
};

window.toggleCheckin = toggleCheckin;

async function updateStreak() {
  document.getElementById('streakNumber').textContent = await calcStreak();
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
