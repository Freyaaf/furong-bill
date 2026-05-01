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

async function notifySync(action, id, appleId) {
  const msg = action === 'delete' && appleId
    ? `reminder-sync:delete:${appleId}`
    : `reminder-sync:${action}:${id}`;
  try {
    await fetch('https://ntfy.sh/furong-reminder-sync', { method: 'POST', body: msg });
  } catch (e) { console.warn('ntfy:', e); }
}

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
  const { data, error } = await sb.from('reminders').insert({
    title,
    category: cat,
    source: 'web',
    synced_to_apple: false,
  }).select('id').single();
  if (error) { toast('添加失败'); return; }
  toast('已添加');
  notifySync('insert', data.id);
  await loadReminders();
  render();
}

// ===== Data =====
async function loadReminders() {
  const { data, error } = await sb.from('reminders')
    .select('*')
    .order('sort_order', { ascending: true, nullsFirst: true })
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
    const hasSortOrder = items.some(r => r.sort_order != null);
    if (hasSortOrder) {
      items.sort((a, b) => {
        const sa = a.sort_order ?? 999999;
        const sb2 = b.sort_order ?? 999999;
        if (sa !== sb2) return sa - sb2;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    } else {
      items.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        if (a.due_date && !b.due_date) return -1;
        if (!a.due_date && b.due_date) return 1;
        if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
        return new Date(b.created_at) - new Date(a.created_at);
      });
    }
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

function getMonthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function renderTodo() {
  const items = getFiltered(false);
  const list = document.getElementById('todo-list');
  const empty = document.getElementById('todo-empty');

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    if (window._todoSortable) { window._todoSortable.destroy(); window._todoSortable = null; }
    return;
  }
  empty.classList.add('hidden');

  let html = '';
  items.forEach(r => { html += renderItem(r, false); });

  list.innerHTML = html;
  bindItemEvents(list);

  if (window._todoSortable) window._todoSortable.destroy();
  window._todoSortable = new Sortable(list, {
    handle: '.drag-handle',
    delay: 300,
    delayOnTouchOnly: true,
    animation: 150,
    draggable: '.reminder-item',
    onEnd: async function() {
      const ids = Array.from(list.querySelectorAll('.reminder-item')).map(el => +el.dataset.id);
      await Promise.all(ids.map((id, i) => sb.from('reminders').update({ sort_order: i + 1 }).eq('id', id)));
      allReminders.forEach(r => {
        const idx = ids.indexOf(r.id);
        if (idx >= 0) r.sort_order = idx + 1;
      });
    }
  });
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

  let html = '';
  let lastGroup = '';

  items.forEach(r => {
    const dateRef = r.completion_date || r.due_date || r.updated_at;
    const group = dateRef ? getMonthKey(dateRef) : '更早';
    if (group !== lastGroup) {
      html += `<div class="date-group-label">${group}</div>`;
      lastGroup = group;
    }
    html += renderItem(r, true);
  });

  list.innerHTML = html;
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
  // 子任务进度
  const subtasks = r.subtasks || [];
  if (subtasks.length > 0) {
    const doneCount = subtasks.filter(s => s.completed).length;
    meta += `<span class="meta-tag meta-subtasks">${doneCount}/${subtasks.length}</span>`;
  }

  let notes = '';
  if (r.notes) {
    notes = `<div class="meta-notes">${escHtml(r.notes)}</div>`;
  }

  // 子任务列表（可直接勾选）
  let subtasksHtml = '';
  if (subtasks.length > 0) {
    subtasksHtml = `<div class="subtask-list" data-reminder-id="${r.id}">`;
    subtasks.forEach(st => {
      subtasksHtml += `<div class="subtask-item ${st.completed ? 'completed' : ''}" data-subtask-id="${st.id}">
        <div class="subtask-check ${st.completed ? 'checked' : ''}" data-action="toggle-subtask" data-reminder-id="${r.id}" data-subtask-id="${st.id}"></div>
        <span class="subtask-title">${escHtml(st.title)}</span>
      </div>`;
    });
    subtasksHtml += '</div>';
  }

  const itemCls = [
    'reminder-item',
    isDone ? 'done-item' : '',
    isOverdue ? 'overdue' : '',
    isHighP ? 'high-priority' : '',
  ].filter(Boolean).join(' ');

  return `<div class="${itemCls}" data-id="${r.id}">
    ${!isDone ? '<span class="drag-handle">⋮⋮</span>' : ''}
    <div class="reminder-check ${isDone ? 'checked' : ''}" data-id="${r.id}" data-action="toggle"></div>
    <div class="reminder-body" data-id="${r.id}" data-action="edit">
      <div class="reminder-title">${escHtml(r.title)}</div>
      ${meta ? `<div class="reminder-meta">${meta}</div>` : ''}
      ${notes}
      ${subtasksHtml}
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
  container.querySelectorAll('[data-action="toggle-subtask"]').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      toggleSubtask(+el.dataset.reminderId, el.dataset.subtaskId);
    };
  });
}

async function toggleSubtask(reminderId, subtaskId) {
  const r = allReminders.find(x => x.id === reminderId);
  if (!r || !r.subtasks) return;
  const subtasks = r.subtasks.map(st =>
    st.id === subtaskId ? { ...st, completed: !st.completed } : st
  );
  r.subtasks = subtasks;
  await sb.from('reminders').update({ subtasks, synced_to_apple: false }).eq('id', reminderId);
  render();
}

// ===== Toggle Complete =====
async function toggleComplete(id) {
  const r = allReminders.find(x => x.id === id);
  if (!r) return;

  const newCompleted = !r.completed;
  const update = {
    completed: newCompleted,
    completion_date: newCompleted ? new Date().toISOString() : null,
    synced_to_apple: false,
  };

  if (newCompleted && r.recurrence_rule) {
    const nextDue = calcNextDue(r);
    if (nextDue) {
      const { data: newR } = await sb.from('reminders').insert({
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
        synced_to_apple: false,
      }).select('id').single();
      if (newR) notifySync('insert', newR.id);
    }
  }

  await sb.from('reminders').update(update).eq('id', id);
  notifySync('update', id);
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

  document.getElementById('form-recurrence-select').onchange = () => {
    const val = document.getElementById('form-recurrence-select').value;
    document.getElementById('weekday-row').classList.toggle('hidden', val !== 'weekly');
  };

}

function openAdd() {
  state.editingId = null;
  document.getElementById('modal-title').textContent = '添加待办';
  document.getElementById('form-title').value = '';
  document.getElementById('form-notes').value = '';
  document.getElementById('form-remind-date').value = '';
  document.getElementById('form-remind-time').value = '';
  document.getElementById('form-recurrence-select').value = '';
  document.getElementById('form-weekday-select').value = '1';
  document.getElementById('form-priority-select').value = '0';
  document.getElementById('form-delete').classList.add('hidden');
  document.getElementById('weekday-row').classList.add('hidden');

  populateCategorySelect(state.category === '全部' ? '全部' : state.category);
  renderSubtasksEditor([]);
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

  if (r.remind_at) {
    const d = new Date(r.remind_at);
    document.getElementById('form-remind-date').value = dateStr(d);
    document.getElementById('form-remind-time').value = timeStr(d);
  } else if (r.due_date) {
    const d = new Date(r.due_date);
    document.getElementById('form-remind-date').value = dateStr(d);
    document.getElementById('form-remind-time').value = timeStr(d);
  } else {
    document.getElementById('form-remind-date').value = '';
    document.getElementById('form-remind-time').value = '';
  }

  document.getElementById('form-recurrence-select').value = r.recurrence_rule || '';
  document.getElementById('form-weekday-select').value = String(r.recurrence_weekday ?? 1);
  document.getElementById('form-priority-select').value = String(r.priority || 0);
  document.getElementById('weekday-row').classList.toggle('hidden', r.recurrence_rule !== 'weekly');

  populateCategorySelect(r.category || '全部');
  renderSubtasksEditor(r.subtasks || []);
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ===== Subtasks Editor =====
let editingSubtasks = [];

function renderSubtasksEditor(subtasks) {
  editingSubtasks = subtasks ? subtasks.map(s => ({ ...s })) : [];
  const container = document.getElementById('subtasks-editor');
  if (!container) return;
  updateSubtasksEditorUI();
}

function updateSubtasksEditorUI() {
  const container = document.getElementById('subtasks-editor');
  let html = '';
  editingSubtasks.forEach(st => {
    html += `<div class="subtask-edit-item" data-id="${st.id}">
      <div class="subtask-edit-check ${st.completed ? 'checked' : ''}" onclick="toggleEditSubtask('${st.id}')"></div>
      <input type="text" class="subtask-edit-input" value="${escHtml(st.title)}" onchange="updateSubtaskTitle('${st.id}', this.value)">
      <button class="subtask-edit-del" onclick="removeSubtask('${st.id}')">&times;</button>
    </div>`;
  });
  html += `<div class="subtask-add-row">
    <input type="text" id="subtask-new-input" class="subtask-add-input" placeholder="添加子任务…" onkeydown="if(event.key==='Enter'){event.preventDefault();addSubtaskFromInput();}">
    <button class="subtask-add-btn" onclick="addSubtaskFromInput()">+</button>
  </div>`;
  container.innerHTML = html;
}

window.toggleEditSubtask = function(id) {
  const st = editingSubtasks.find(s => s.id === id);
  if (st) st.completed = !st.completed;
  updateSubtasksEditorUI();
};

window.updateSubtaskTitle = function(id, title) {
  const st = editingSubtasks.find(s => s.id === id);
  if (st) st.title = title;
};

window.removeSubtask = function(id) {
  editingSubtasks = editingSubtasks.filter(s => s.id !== id);
  updateSubtasksEditorUI();
};

window.addSubtaskFromInput = function() {
  const input = document.getElementById('subtask-new-input');
  const title = input.value.trim();
  if (!title) return;
  editingSubtasks.push({
    id: 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title,
    completed: false,
  });
  input.value = '';
  updateSubtasksEditorUI();
};

function populateCategorySelect(selected) {
  const sel = document.getElementById('form-category-select');
  sel.innerHTML = state.categories.map(c =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`
  ).join('');
}

async function saveForm() {
  const title = document.getElementById('form-title').value.trim();
  if (!title) { toast('标题不能为空'); return; }

  const category = document.getElementById('form-category-select').value || '全部';
  const recurrence = document.getElementById('form-recurrence-select').value || null;
  const priority = parseInt(document.getElementById('form-priority-select').value || '0');
  const notes = document.getElementById('form-notes').value.trim() || null;

  const remindDate = document.getElementById('form-remind-date').value;
  const remindTime = document.getElementById('form-remind-time').value;

  let remind_at = null;
  let due_date = null;
  if (remindDate) {
    remind_at = new Date(remindDate + 'T' + (remindTime || '09:00') + ':00+08:00').toISOString();
    due_date = remind_at;
  }

  const weekday = recurrence === 'weekly'
    ? parseInt(document.getElementById('form-weekday-select').value || '1')
    : null;

  // 收集子任务（过滤掉空标题的）
  const subtasks = editingSubtasks.filter(s => s.title && s.title.trim());

  const row = {
    title, category, priority, notes,
    due_date, remind_at,
    recurrence_rule: recurrence || null,
    recurrence_weekday: weekday,
    subtasks: subtasks.length > 0 ? subtasks : null,
    notified: false,
    synced_to_apple: false,
  };

  let error, savedId;
  if (state.editingId) {
    ({ error } = await sb.from('reminders').update(row).eq('id', state.editingId));
    savedId = state.editingId;
  } else {
    row.source = 'web';
    const { data, error: e } = await sb.from('reminders').insert(row).select('id').single();
    error = e;
    if (data) savedId = data.id;
  }

  if (error) { toast('保存失败'); console.error(error); return; }
  notifySync(state.editingId ? 'update' : 'insert', savedId);
  toast(state.editingId ? '已更新' : '已添加');
  closeModal();
  await loadReminders();
  render();
}

async function deleteReminder() {
  if (!state.editingId) return;
  if (!confirm('确定删除这条待办？')) return;
  const r = allReminders.find(x => x.id === state.editingId);
  const appleId = r?.apple_reminder_id || '';
  await sb.from('reminders').delete().eq('id', state.editingId);
  notifySync('delete', state.editingId, appleId);
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
