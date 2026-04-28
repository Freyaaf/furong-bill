const SUPABASE_URL = 'https://otpcdlgwlaifirhfnnat.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90cGNkbGd3bGFpZmlyaGZubmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4ODQ5NzQsImV4cCI6MjA5MTQ2MDk3NH0.nC92brW3QJPbkh9IQ8q3-S6W-Mw8WLtcKXoIJ-8xkHo';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DEFAULT_CATEGORIES = ['全部', '日常', '学习', '工作', '财务', '生活'];
const RECURRENCE_LABELS = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' };
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PRIORITY_LABELS = { 0: '', 1: '低', 5: '中', 9: '高' };

let state = {
  tab: 'todo',
  category: '全部',
  categories: [...DEFAULT_CATEGORIES],
  editingId: null,
  donePeriod: 'month',
};

let allReminders = [];

// ===== Auth =====
async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    unlock();
    return;
  }
  document.getElementById('lock-screen').classList.remove('hidden');
  document.getElementById('lock-btn').onclick = login;
  document.getElementById('lock-pw').onkeydown = e => { if (e.key === 'Enter') login(); };
}

async function login() {
  const email = document.getElementById('lock-email').value.trim();
  const pw = document.getElementById('lock-pw').value;
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) {
    const err = document.getElementById('lock-err');
    err.style.display = 'block';
    return;
  }
  unlock();
}

function unlock() {
  document.getElementById('lock-screen').classList.add('hidden');
  init();
}

// ===== Init =====
async function init() {
  setupNav();
  setupQuickAdd();
  setupModal();
  setupDoneFilter();
  await loadReminders();
  renderCategoryBar();
  render();
}

// ===== Nav =====
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + state.tab).classList.add('active');
      render();
    };
  });
}

// ===== Quick Add =====
function setupQuickAdd() {
  const input = document.getElementById('quick-input');
  const btn = document.getElementById('quick-btn');
  btn.onclick = () => {
    if (input.value.trim()) quickAdd();
    else openAdd();
  };
  input.onkeydown = e => { if (e.key === 'Enter' && input.value.trim()) quickAdd(); };
}

async function quickAdd() {
  const input = document.getElementById('quick-input');
  const title = input.value.trim();
  if (!title) return;
  input.value = '';

  const cat = state.category === '全部' ? '全部' : state.category;
  const { error } = await sb.from('reminders').insert({
    title,
    category: cat,
    source: 'web',
  });
  if (error) { toast('添加失败'); return; }
  toast('已添加');
  await loadReminders();
  render();
}

// ===== Data =====
async function loadReminders() {
  const { data, error } = await sb.from('reminders')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  allReminders = data || [];

  const cats = new Set(DEFAULT_CATEGORIES);
  allReminders.forEach(r => { if (r.category) cats.add(r.category); });
  state.categories = Array.from(cats);
}

function getFiltered(completed) {
  let items = allReminders.filter(r => r.completed === completed);

  if (state.category !== '全部') {
    items = items.filter(r => r.category === state.category);
  }

  if (completed && state.donePeriod !== 'all') {
    const now = new Date();
    let cutoff;
    if (state.donePeriod === 'week') cutoff = new Date(now - 7 * 86400000);
    else if (state.donePeriod === 'month') cutoff = new Date(now - 30 * 86400000);
    else if (state.donePeriod === '3month') cutoff = new Date(now - 90 * 86400000);
    else if (state.donePeriod === 'year') cutoff = new Date(now - 365 * 86400000);
    if (cutoff) {
      items = items.filter(r => {
        const d = r.completion_date || r.updated_at;
        return d && new Date(d) >= cutoff;
      });
    }
  }

  if (!completed) {
    items.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
      return new Date(b.created_at) - new Date(a.created_at);
    });
  } else {
    items.sort((a, b) => {
      const da = a.completion_date || a.updated_at;
      const db = b.completion_date || b.updated_at;
      return new Date(db) - new Date(da);
    });
  }
  return items;
}

// ===== Render =====
function render() {
  if (state.tab === 'todo') renderTodo();
  else renderDone();
}

function renderCategoryBar() {
  const bar = document.getElementById('category-bar');
  bar.innerHTML = state.categories.map(c =>
    `<button class="cat-chip ${c === state.category ? 'active' : ''}" data-cat="${c}">${c}</button>`
  ).join('') + `<button class="cat-chip chip-add" id="add-cat-btn">+ 新建</button>`;

  bar.querySelectorAll('.cat-chip:not(.chip-add)').forEach(btn => {
    btn.onclick = () => {
      state.category = btn.dataset.cat;
      renderCategoryBar();
      render();
    };
  });

  document.getElementById('add-cat-btn').onclick = () => {
    const name = prompt('新分类名称：');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (!state.categories.includes(trimmed)) {
      state.categories.push(trimmed);
    }
    state.category = trimmed;
    renderCategoryBar();
    render();
  };
}

function renderTodo() {
  const items = getFiltered(false);
  const list = document.getElementById('todo-list');
  const empty = document.getElementById('todo-empty');

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const now = new Date();
  let html = '';
  let lastGroup = '';

  items.forEach(r => {
    let group = '';
    if (r.due_date) {
      const d = new Date(r.due_date);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diff = Math.floor((due - today) / 86400000);
      if (diff < 0) group = '已过期';
      else if (diff === 0) group = '今天';
      else if (diff === 1) group = '明天';
      else if (diff <= 7) group = '本周内';
      else group = '以后';
    } else {
      group = '无日期';
    }

    if (group !== lastGroup) {
      html += `<div class="date-group-label">${group}</div>`;
      lastGroup = group;
    }
    html += renderItem(r, false);
  });

  list.innerHTML = html;
  bindItemEvents(list);
}

function renderDone() {
  const items = getFiltered(true);
  const list = document.getElementById('done-list');
  const empty = document.getElementById('done-empty');
  const count = document.getElementById('done-count');

  count.textContent = `共 ${items.length} 条`;

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = items.map(r => renderItem(r, true)).join('');
  bindItemEvents(list);
}

function renderItem(r, isDone) {
  const isOverdue = !isDone && r.due_date && new Date(r.due_date) < new Date();
  const isHighP = r.priority >= 9;

  let meta = '';
  if (r.due_date) {
    const cls = isOverdue ? 'meta-tag meta-date overdue' : 'meta-tag meta-date';
    meta += `<span class="${cls}">${formatDue(r.due_date)}</span>`;
  }
  if (r.category && r.category !== '全部') {
    meta += `<span class="meta-tag meta-category">${r.category}</span>`;
  }
  if (r.recurrence_rule) {
    let recLabel = RECURRENCE_LABELS[r.recurrence_rule] || r.recurrence_rule;
    if (r.recurrence_rule === 'weekly' && r.recurrence_weekday != null) {
      recLabel += WEEKDAY_NAMES[r.recurrence_weekday];
    }
    meta += `<span class="meta-tag meta-recurrence">${recLabel}</span>`;
  }
  if (r.priority > 0) {
    const pc = r.priority >= 9 ? 'p-high' : r.priority >= 5 ? 'p-mid' : 'p-low';
    meta += `<span class="meta-tag meta-priority ${pc}">${PRIORITY_LABELS[r.priority] || ''}</span>`;
  }

  let notes = '';
  if (r.notes) {
    notes = `<div class="meta-notes">${escHtml(r.notes)}</div>`;
  }

  const itemCls = [
    'reminder-item',
    isDone ? 'done-item' : '',
    isOverdue ? 'overdue' : '',
    isHighP ? 'high-priority' : '',
  ].filter(Boolean).join(' ');

  return `<div class="${itemCls}" data-id="${r.id}">
    <div class="reminder-check ${isDone ? 'checked' : ''}" data-id="${r.id}" data-action="toggle"></div>
    <div class="reminder-body" data-id="${r.id}" data-action="edit">
      <div class="reminder-title">${escHtml(r.title)}</div>
      ${meta ? `<div class="reminder-meta">${meta}</div>` : ''}
      ${notes}
    </div>
  </div>`;
}

function bindItemEvents(container) {
  container.querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.onclick = e => { e.stopPropagation(); toggleComplete(+el.dataset.id); };
  });
  container.querySelectorAll('[data-action="edit"]').forEach(el => {
    el.onclick = () => openEdit(+el.dataset.id);
  });
}

// ===== Toggle Complete =====
async function toggleComplete(id) {
  const r = allReminders.find(x => x.id === id);
  if (!r) return;

  const newCompleted = !r.completed;
  const update = {
    completed: newCompleted,
    completion_date: newCompleted ? new Date().toISOString() : null,
  };

  if (newCompleted && r.recurrence_rule) {
    const nextDue = calcNextDue(r);
    if (nextDue) {
      await sb.from('reminders').insert({
        title: r.title,
        notes: r.notes,
        category: r.category,
        priority: r.priority,
        due_date: nextDue.toISOString(),
        remind_at: r.remind_at ? calcNextRemind(r, nextDue).toISOString() : null,
        recurrence_rule: r.recurrence_rule,
        recurrence_interval: r.recurrence_interval,
        recurrence_weekday: r.recurrence_weekday,
        source: 'web',
      });
    }
  }

  await sb.from('reminders').update(update).eq('id', id);
  toast(newCompleted ? '完成' : '已恢复');
  await loadReminders();
  render();
}

function calcNextDue(r) {
  if (!r.due_date) return null;
  const d = new Date(r.due_date);
  const interval = r.recurrence_interval || 1;
  switch (r.recurrence_rule) {
    case 'daily': d.setDate(d.getDate() + interval); break;
    case 'weekly': d.setDate(d.getDate() + 7 * interval); break;
    case 'monthly': d.setMonth(d.getMonth() + interval); break;
    case 'yearly': d.setFullYear(d.getFullYear() + interval); break;
    default: return null;
  }
  return d;
}

function calcNextRemind(r, nextDue) {
  if (!r.remind_at || !r.due_date) return nextDue;
  const diff = new Date(r.due_date) - new Date(r.remind_at);
  return new Date(nextDue - diff);
}

// ===== Modal =====
function setupModal() {
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal-overlay').onclick = e => {
    if (e.target === e.currentTarget) closeModal();
  };
  document.getElementById('form-save').onclick = saveForm;
  document.getElementById('form-delete').onclick = deleteReminder;

  document.querySelectorAll('#form-recurrence .chip').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#form-recurrence .chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      toggleWeekdayPicker();
    };
  });
  document.querySelectorAll('#form-weekday .chip').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#form-weekday .chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
  document.querySelectorAll('#form-priority .chip').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#form-priority .chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
}

function toggleWeekdayPicker() {
  const rec = getActiveChip('#form-recurrence');
  const wd = document.getElementById('form-weekday');
  if (rec === 'weekly') {
    wd.classList.remove('hidden');
  } else {
    wd.classList.add('hidden');
  }
}

function openAdd() {
  state.editingId = null;
  document.getElementById('modal-title').textContent = '添加待办';
  document.getElementById('form-title').value = '';
  document.getElementById('form-due-date').value = '';
  document.getElementById('form-due-time').value = '';
  document.getElementById('form-remind-date').value = '';
  document.getElementById('form-remind-time').value = '';
  document.getElementById('form-notes').value = '';
  document.getElementById('form-delete').classList.add('hidden');

  renderFormCategories(state.category === '全部' ? '全部' : state.category);
  setChipActive('#form-recurrence', '');
  setChipActive('#form-priority', '0');
  setChipActive('#form-weekday', '1');
  toggleWeekdayPicker();

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEdit(id) {
  const r = allReminders.find(x => x.id === id);
  if (!r) return;
  state.editingId = id;

  document.getElementById('modal-title').textContent = '编辑待办';
  document.getElementById('form-title').value = r.title || '';
  document.getElementById('form-notes').value = r.notes || '';
  document.getElementById('form-delete').classList.remove('hidden');

  if (r.due_date) {
    const d = new Date(r.due_date);
    document.getElementById('form-due-date').value = dateStr(d);
    document.getElementById('form-due-time').value = timeStr(d);
  } else {
    document.getElementById('form-due-date').value = '';
    document.getElementById('form-due-time').value = '';
  }

  if (r.remind_at) {
    const d = new Date(r.remind_at);
    document.getElementById('form-remind-date').value = dateStr(d);
    document.getElementById('form-remind-time').value = timeStr(d);
  } else {
    document.getElementById('form-remind-date').value = '';
    document.getElementById('form-remind-time').value = '';
  }

  renderFormCategories(r.category || '全部');
  setChipActive('#form-recurrence', r.recurrence_rule || '');
  setChipActive('#form-priority', String(r.priority || 0));
  setChipActive('#form-weekday', String(r.recurrence_weekday ?? 1));
  toggleWeekdayPicker();

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function renderFormCategories(selected) {
  const container = document.getElementById('form-categories');
  container.innerHTML = state.categories.map(c =>
    `<button class="chip ${c === selected ? 'active' : ''}" data-val="${c}">${c}</button>`
  ).join('') + `<button class="chip chip-add" id="form-add-cat">+</button>`;

  container.querySelectorAll('.chip:not(.chip-add)').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
  document.getElementById('form-add-cat').onclick = () => {
    const name = prompt('新分类名称：');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (!state.categories.includes(trimmed)) state.categories.push(trimmed);
    renderFormCategories(trimmed);
    renderCategoryBar();
  };
}

function setChipActive(selector, val) {
  document.querySelectorAll(`${selector} .chip`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function getActiveChip(selector) {
  const active = document.querySelector(`${selector} .chip.active`);
  return active ? active.dataset.val : '';
}

async function saveForm() {
  const title = document.getElementById('form-title').value.trim();
  if (!title) { toast('标题不能为空'); return; }

  const category = getActiveChip('#form-categories') || '全部';
  const recurrence = getActiveChip('#form-recurrence') || null;
  const priority = parseInt(getActiveChip('#form-priority') || '0');
  const notes = document.getElementById('form-notes').value.trim() || null;

  const dueDate = document.getElementById('form-due-date').value;
  const dueTime = document.getElementById('form-due-time').value;
  const remindDate = document.getElementById('form-remind-date').value;
  const remindTime = document.getElementById('form-remind-time').value;

  let due_date = null;
  if (dueDate) {
    due_date = new Date(dueDate + 'T' + (dueTime || '23:59') + ':00+08:00').toISOString();
  }
  let remind_at = null;
  if (remindDate) {
    remind_at = new Date(remindDate + 'T' + (remindTime || '09:00') + ':00+08:00').toISOString();
  }

  const weekday = recurrence === 'weekly' ? parseInt(getActiveChip('#form-weekday') || '1') : null;

  const row = {
    title, category, priority, notes,
    due_date, remind_at,
    recurrence_rule: recurrence || null,
    recurrence_weekday: weekday,
    notified: false,
  };

  let error;
  if (state.editingId) {
    ({ error } = await sb.from('reminders').update(row).eq('id', state.editingId));
  } else {
    row.source = 'web';
    ({ error } = await sb.from('reminders').insert(row));
  }

  if (error) { toast('保存失败'); console.error(error); return; }
  toast(state.editingId ? '已更新' : '已添加');
  closeModal();
  await loadReminders();
  render();
}

async function deleteReminder() {
  if (!state.editingId) return;
  if (!confirm('确定删除这条待办？')) return;
  await sb.from('reminders').delete().eq('id', state.editingId);
  toast('已删除');
  closeModal();
  await loadReminders();
  render();
}

// ===== Done Filter =====
function setupDoneFilter() {
  document.getElementById('done-filter-period').onchange = e => {
    state.donePeriod = e.target.value;
    render();
  };
}

// ===== Helpers =====
function formatDue(iso) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((due - today) / 86400000);

  let dateLabel;
  if (diff === 0) dateLabel = '今天';
  else if (diff === 1) dateLabel = '明天';
  else if (diff === -1) dateLabel = '昨天';
  else if (diff > 1 && diff <= 7) dateLabel = `${diff}天后`;
  else dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;

  const h = d.getHours(), m = d.getMinutes();
  if (h === 23 && m === 59) return dateLabel;
  return `${dateLabel} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function timeStr(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('visible');
  setTimeout(() => { el.classList.remove('visible'); el.classList.add('hidden'); }, 1800);
}

// ===== Start =====
initAuth();
