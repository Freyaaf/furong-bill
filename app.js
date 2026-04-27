const SUPABASE_URL = 'https://otpcdlgwlaifirhfnnat.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90cGNkbGd3bGFpZmlyaGZubmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4ODQ5NzQsImV4cCI6MjA5MTQ2MDk3NH0.nC92brW3QJPbkh9IQ8q3-S6W-Mw8WLtcKXoIJ-8xkHo';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = [
  { name: '食物', emoji: '🍜' },
  { name: '住房日用', emoji: '🏠' },
  { name: '交通通信', emoji: '🚇' },
  { name: '外貌', emoji: '💄' },
  { name: '衣服', emoji: '👗' },
  { name: '文娱运动', emoji: '🎮' },
  { name: '旅行', emoji: '✈️' },
  { name: '社交', emoji: '👥' },
  { name: '医疗', emoji: '💊' },
  { name: '梦想礼物', emoji: '🎁' },
  { name: '学习', emoji: '📚' },
  { name: 'guilty pleasure', emoji: '🍰' },
];

const SATISFACTIONS = [
  { name: '非常满足', emoji: '🥰', color: '#4caf50', short: '非常满足' },
  { name: '比较满足', emoji: '😊', color: '#8bc34a', short: '比较满足' },
  { name: '一般满足', emoji: '🙂', color: '#cddc39', short: '一般满足' },
  { name: '无感', emoji: '😶', color: '#9e9e9e', short: '无感' },
  { name: '比较不满', emoji: '😕', color: '#ff9800', short: '比较不满' },
  { name: '非常不满', emoji: '😤', color: '#f44336', short: '非常不满' },
];

function satEmoji(name) {
  return SATISFACTIONS.find(s => s.name === name)?.emoji || '😶';
}
function satColor(name) {
  return SATISFACTIONS.find(s => s.name === name)?.color || '#9e9e9e';
}
function catEmoji(name) {
  return CATEGORIES.find(c => c.name === name)?.emoji || '📦';
}

let state = {
  tab: 'add',
  billsMonth: todayYM(),
  summaryMonth: todayYM(),
  budgetMonth: todayYM(),
  selectedCategory: null,
  selectedSatisfaction: null,
  editingId: null,
};

let chartInstance = null;
let catChartInstance = null;

function todayYM() { return new Date().toISOString().slice(0, 7); }
function todayDate() { return new Date().toISOString().slice(0, 10); }

function formatYM(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${parseInt(m)}月`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}

function lastDayOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function weekday(dateStr) {
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  return days[new Date(dateStr + 'T00:00:00').getDay()];
}

// ===== Toast =====
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('visible');
  setTimeout(() => {
    el.classList.remove('visible');
    el.classList.add('hidden');
  }, 2000);
}

// ===== Modal =====
function openModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ===== Tab Navigation =====
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'bills') loadBills();
  if (tab === 'summary') loadSummary();
  if (tab === 'budget') loadBudgetPage();
}

// ===== Supabase Queries =====
async function fetchBills(ym) {
  const start = `${ym}-01`;
  const end = `${ym}-${lastDayOfMonth(ym)}`;
  const { data, error } = await sb.from('bills').select('*')
    .gte('date', start).lte('date', end)
    .order('date').order('created_at');
  if (error) { toast('加载失败'); console.error(error); return []; }
  return data || [];
}

async function fetchAllBills() {
  let all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from('bills').select('*')
      .order('date', { ascending: true }).order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function insertBill(bill) {
  const { error } = await sb.from('bills').insert(bill);
  if (error) { toast('保存失败'); console.error(error); return false; }
  return true;
}

async function updateBill(id, updates) {
  const { error } = await sb.from('bills').update(updates).eq('id', id);
  if (error) { toast('更新失败'); console.error(error); return false; }
  return true;
}

async function deleteBill(id) {
  const { error } = await sb.from('bills').delete().eq('id', id);
  if (error) { toast('删除失败'); console.error(error); return false; }
  return true;
}

async function fetchBudgets(ym) {
  const { data, error } = await sb.from('bill_budgets').select('*').eq('year_month', ym);
  if (error) { console.error(error); return []; }
  return data || [];
}

async function upsertBudget(ym, category, amount) {
  if (!amount || amount <= 0) {
    await sb.from('bill_budgets').delete()
      .eq('year_month', ym)
      .eq('category', category || '');
    return;
  }
  const catVal = category || '';
  const { data: existing } = await sb.from('bill_budgets').select('id')
    .eq('year_month', ym).eq('category', catVal);
  if (existing && existing.length > 0) {
    await sb.from('bill_budgets').update({ budget_amount: amount }).eq('id', existing[0].id);
  } else {
    await sb.from('bill_budgets').insert({ year_month: ym, category: catVal, budget_amount: amount });
  }
}

async function searchBills(query, category, satisfaction) {
  let q = sb.from('bills').select('*').order('date', { ascending: false });
  if (query) {
    q = q.or(`item.ilike.%${query}%,reason.ilike.%${query}%,follow_up.ilike.%${query}%`);
  }
  if (category) q = q.eq('category', category);
  if (satisfaction) q = q.eq('satisfaction', satisfaction);
  const { data, error } = await q.limit(100);
  if (error) { console.error(error); return []; }
  return data || [];
}

// ===== 傅融的存在感 =====
function getGreeting() {
  const h = new Date().getHours();
  const greetings = {
    morning: [
      '早上好呀，今天想吃什么好吃的？',
      '新的一天，帮你把账记得明明白白。',
      '起床了？早饭记得吃，记得记～',
    ],
    noon: [
      '中午了，吃饱了吗？',
      '午饭时间到，吃了什么好吃的来记一笔。',
    ],
    afternoon: [
      '下午好，今天花了多少让我看看。',
      '下午茶时间？guilty pleasure 适量哦。',
      '今天辛苦了，买点好的犒劳自己也行。',
    ],
    evening: [
      '晚上好～今天的账都记了吗？',
      '一天结束了，来盘点一下今天的战绩。',
      '晚饭吃了什么？快来记一笔。',
    ],
    night: [
      '这么晚了还没睡呀。',
      '夜深了，明天再花钱吧。',
    ],
  };
  let pool;
  if (h >= 6 && h < 11) pool = greetings.morning;
  else if (h >= 11 && h < 14) pool = greetings.noon;
  else if (h >= 14 && h < 18) pool = greetings.afternoon;
  else if (h >= 18 && h < 23) pool = greetings.evening;
  else pool = greetings.night;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getAddResponse(item, amount, category, satisfaction) {
  if (category === 'guilty pleasure' && amount > 50) {
    const r = ['好家伙，这顿guilty pleasure挺豪的', '快乐是值钱的嘛，记下了', '吃开心就好，我帮你记着'];
    return r[Math.floor(Math.random() * r.length)];
  }
  if (category === 'guilty pleasure') {
    const r = ['又嘴馋了嘿嘿，记下了', '快乐食物！记好了', 'guilty pleasure +1'];
    return r[Math.floor(Math.random() * r.length)];
  }
  if (item.includes('玉米')) {
    const r = ['又是玉米！你的最爱', '玉米小姐今天也吃玉米了', '记好了，今日份玉米 ✓'];
    return r[Math.floor(Math.random() * r.length)];
  }
  if (satisfaction === '非常不满') {
    const r = ['这笔花得不开心啊，记住下次避开', '心疼你的钱包，也心疼你', '不值就不值，踩坑记录 +1'];
    return r[Math.floor(Math.random() * r.length)];
  }
  if (satisfaction === '非常满足') {
    const r = ['花得值！开心最重要', '满足感拉满了，好消费', '这钱花得好，记下了'];
    return r[Math.floor(Math.random() * r.length)];
  }
  if (amount > 500) {
    const r = ['大额支出！帮你记好了', '这笔不小哦，记下了', '大手笔，记录在案'];
    return r[Math.floor(Math.random() * r.length)];
  }
  const r = ['记好了～', '记下了 ✨', '好的，记上了', '收到，已记录'];
  return r[Math.floor(Math.random() * r.length)];
}

function generateReview(bills, prevBills, budgets) {
  if (bills.length === 0) return '';
  const total = bills.reduce((s, b) => s + parseFloat(b.amount), 0);
  const prevTotal = prevBills.reduce((s, b) => s + parseFloat(b.amount), 0);
  const gpBills = bills.filter(b => b.category === 'guilty pleasure');
  const gpTotal = gpBills.reduce((s, b) => s + parseFloat(b.amount), 0);
  const happyCount = bills.filter(b => ['非常满足','比较满足','一般满足'].includes(b.satisfaction)).length;
  const happyPct = Math.round(happyCount / bills.length * 100);
  const sadBills = bills.filter(b => ['比较不满','非常不满'].includes(b.satisfaction));
  const totalBudget = budgets.find(b => b.category === '')?.budget_amount;

  let lines = [];

  if (totalBudget) {
    const pct = Math.round(total / totalBudget * 100);
    if (pct > 100) lines.push(`预算超了${pct - 100}%……下个月注意控制一下哦。`);
    else if (pct > 85) lines.push(`预算快到了，还剩一点点余额，悠着点花。`);
    else if (pct < 50) lines.push(`预算才用了不到一半，这个月很节制嘛。`);
  }

  if (prevTotal > 0) {
    const diff = total - prevTotal;
    if (diff > prevTotal * 0.3) lines.push(`比上个月多花了不少，看看有没有可以省的地方？`);
    else if (diff < -prevTotal * 0.2) lines.push(`比上个月省了一些，不错。`);
  }

  if (gpTotal > total * 0.3 && gpTotal > 200) {
    lines.push(`guilty pleasure 占了 ${Math.round(gpTotal/total*100)}%，快乐是快乐，钱包在哭。`);
  }

  if (happyPct >= 75) {
    lines.push(`${happyPct}% 的花销都让你满足，钱花在了对的地方。`);
  } else if (happyPct < 40) {
    lines.push(`满足感偏低，好多钱花得不太开心，想想怎么调整。`);
  }

  if (sadBills.length >= 3) {
    lines.push(`有 ${sadBills.length} 笔花得不满意，下次这些可以考虑少花或者换个选择。`);
  }

  if (lines.length === 0) {
    lines.push('这个月整体还不错，继续保持。');
  }

  return lines.join('');
}

async function updateGreeting() {
  const el = document.getElementById('greeting-card');
  const ym = todayYM();
  const bills = await fetchBills(ym);
  const todayBills = bills.filter(b => b.date === todayDate());
  const todayTotal = todayBills.reduce((s, b) => s + parseFloat(b.amount), 0);
  const monthTotal = bills.reduce((s, b) => s + parseFloat(b.amount), 0);

  let extra = '';
  if (todayBills.length > 0) {
    extra = `<div style="font-size:12px;color:var(--grape);margin-top:6px">今天 ${todayBills.length} 笔 · ¥${todayTotal.toFixed(2)}　本月 ¥${monthTotal.toFixed(2)}</div>`;
  }

  el.innerHTML = `<div class="greeting-label">— 傅融说 —</div>${getGreeting()}${extra}`;
}

// ===== 记账 Tab =====
function initAddForm() {
  document.getElementById('bill-date').value = todayDate();
  updateGreeting();

  const chipsEl = document.getElementById('category-chips');
  chipsEl.innerHTML = CATEGORIES.map(c =>
    `<div class="chip" data-cat="${c.name}">${c.emoji} ${c.name}</div>`
  ).join('');
  chipsEl.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    state.selectedCategory = chip.dataset.cat;
  });

  const satEl = document.getElementById('satisfaction-bar');
  satEl.innerHTML = SATISFACTIONS.map(s =>
    `<div class="sat-option" data-sat="${s.name}">
      <span class="sat-emoji">${s.emoji}</span>
      <span class="sat-label">${s.short}</span>
    </div>`
  ).join('');
  satEl.addEventListener('click', e => {
    const opt = e.target.closest('.sat-option');
    if (!opt) return;
    satEl.querySelectorAll('.sat-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    state.selectedSatisfaction = opt.dataset.sat;
  });

  document.getElementById('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const date = document.getElementById('bill-date').value;
    const item = document.getElementById('bill-item').value.trim();
    const amount = parseFloat(document.getElementById('bill-amount').value);
    const reason = document.getElementById('bill-reason').value.trim();
    if (!state.selectedCategory) { toast('选个类别～'); return; }
    if (!state.selectedSatisfaction) { toast('选个满足感～'); return; }
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    const ok = await insertBill({
      date, item, amount, reason: reason || null,
      category: state.selectedCategory,
      satisfaction: state.selectedSatisfaction,
    });
    btn.disabled = false;
    if (ok) {
      toast(getAddResponse(item, amount, state.selectedCategory, state.selectedSatisfaction));
      updateGreeting();
      document.getElementById('bill-item').value = '';
      document.getElementById('bill-amount').value = '';
      document.getElementById('bill-reason').value = '';
    }
  });
}

// ===== 账单 Tab =====
async function loadBills() {
  const label = document.getElementById('bills-month-label');
  label.textContent = formatYM(state.billsMonth);
  const list = document.getElementById('bills-list');
  list.innerHTML = '<div class="loading">加载中...</div>';
  const bills = await fetchBills(state.billsMonth);

  const budgets = await fetchBudgets(state.billsMonth);
  const totalBudget = budgets.find(b => b.category === '')?.budget_amount;
  const total = bills.reduce((s, b) => s + parseFloat(b.amount), 0);

  let summaryHtml = `<span class="count">${bills.length} 笔</span><span class="total">¥${total.toFixed(2)}</span>`;
  document.getElementById('bills-summary-bar').innerHTML = summaryHtml;

  if (bills.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌿</div><p>这个月还没有记账哦</p></div>`;
    return;
  }

  const grouped = {};
  bills.forEach(b => {
    if (!grouped[b.date]) grouped[b.date] = [];
    grouped[b.date].push(b);
  });

  let html = '';
  for (const [date, items] of Object.entries(grouped)) {
    const dayTotal = items.reduce((s, b) => s + parseFloat(b.amount), 0);
    html += `<div class="date-group">
      <div class="date-header">${formatDate(date)} ${weekday(date)} · ¥${dayTotal.toFixed(2)}</div>`;
    for (const b of items) {
      html += renderBillItem(b);
    }
    html += '</div>';
  }
  list.innerHTML = html;

  list.querySelectorAll('.bill-item').forEach(el => {
    el.addEventListener('click', () => {
      const detail = el.querySelector('.bill-detail');
      detail.classList.toggle('open');
    });
  });

  list.querySelectorAll('.btn-follow-up').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openFollowUpModal(btn.dataset.id, btn.dataset.existing || '');
    });
  });

  list.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (confirm('确定删除这条记录吗？')) {
        await deleteBill(btn.dataset.id);
        toast('已删除');
        loadBills();
      }
    });
  });
}

function renderBillItem(b) {
  const hasFollowUp = b.follow_up && b.follow_up.trim();
  return `<div class="bill-item" data-id="${b.id}">
    <div class="bill-row">
      <div class="bill-left">
        <div class="bill-name">${esc(b.item)}</div>
        <div class="bill-meta">
          <span class="bill-category-tag">${catEmoji(b.category)} ${b.category}</span>
          <span class="bill-sat">${satEmoji(b.satisfaction)}</span>
        </div>
      </div>
      <div class="bill-amount">¥${parseFloat(b.amount).toFixed(2)}</div>
    </div>
    <div class="bill-detail">
      ${b.reason ? `<div class="reason">💬 ${esc(b.reason)}</div>` : ''}
      ${hasFollowUp ? `<div class="follow-up">
        <div class="follow-up-label">追评 · ${b.follow_up_date ? formatDate(b.follow_up_date) : ''}</div>
        <div>${esc(b.follow_up)}</div>
      </div>` : ''}
      <div class="bill-actions">
        <button class="btn-secondary btn-follow-up" data-id="${b.id}" data-existing="${esc(b.follow_up || '')}">${hasFollowUp ? '修改追评' : '写追评'}</button>
        <button class="btn-secondary btn-edit" data-id="${b.id}">编辑</button>
        <button class="btn-danger btn-delete" data-id="${b.id}">删除</button>
      </div>
    </div>
  </div>`;
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ===== Follow Up Modal =====
function openFollowUpModal(id, existing) {
  openModal(`
    <h3>写追评</h3>
    <div class="form-group">
      <textarea id="follow-up-text" rows="3" placeholder="用了之后觉得怎么样？">${existing}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" onclick="saveFollowUp('${id}')">保存</button>
    </div>
  `);
}

window.saveFollowUp = async function(id) {
  const text = document.getElementById('follow-up-text').value.trim();
  const ok = await updateBill(id, {
    follow_up: text || null,
    follow_up_date: text ? todayDate() : null,
  });
  if (ok) {
    toast('追评已保存 ✨');
    closeModal();
    loadBills();
  }
};

// ===== Edit Modal =====
async function openEditModal(id) {
  const { data: bill } = await sb.from('bills').select('*').eq('id', id).single();
  if (!bill) { toast('找不到记录'); return; }

  const catOptions = CATEGORIES.map(c =>
    `<div class="chip ${bill.category === c.name ? 'selected' : ''}" data-cat="${c.name}">${c.emoji} ${c.name}</div>`
  ).join('');

  const satOptions = SATISFACTIONS.map(s =>
    `<div class="sat-option ${bill.satisfaction === s.name ? 'selected' : ''}" data-sat="${s.name}">
      <span class="sat-emoji">${s.emoji}</span><span class="sat-label">${s.short}</span>
    </div>`
  ).join('');

  openModal(`
    <h3>编辑记录</h3>
    <div class="form-group"><label>日期</label>
      <input type="date" id="edit-date" value="${bill.date}">
    </div>
    <div class="form-group"><label>物品/服务</label>
      <input type="text" id="edit-item" value="${esc(bill.item)}">
    </div>
    <div class="form-group"><label>金额</label>
      <input type="number" id="edit-amount" step="0.01" value="${bill.amount}">
    </div>
    <div class="form-group"><label>类别</label>
      <div class="chips" id="edit-cats">${catOptions}</div>
    </div>
    <div class="form-group"><label>满足感</label>
      <div class="satisfaction-bar" id="edit-sats">${satOptions}</div>
    </div>
    <div class="form-group"><label>原因说明</label>
      <textarea id="edit-reason" rows="2">${esc(bill.reason || '')}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" onclick="saveEdit('${id}')">保存</button>
    </div>
  `);

  document.getElementById('edit-cats').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#edit-cats .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
  });

  document.getElementById('edit-sats').addEventListener('click', e => {
    const opt = e.target.closest('.sat-option');
    if (!opt) return;
    document.querySelectorAll('#edit-sats .sat-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
  });
}

window.saveEdit = async function(id) {
  const catEl = document.querySelector('#edit-cats .chip.selected');
  const satEl = document.querySelector('#edit-sats .sat-option.selected');
  if (!catEl || !satEl) { toast('类别和满足感都要选哦'); return; }
  const ok = await updateBill(id, {
    date: document.getElementById('edit-date').value,
    item: document.getElementById('edit-item').value.trim(),
    amount: parseFloat(document.getElementById('edit-amount').value),
    category: catEl.dataset.cat,
    satisfaction: satEl.dataset.sat,
    reason: document.getElementById('edit-reason').value.trim() || null,
  });
  if (ok) {
    toast('已更新 ✨');
    closeModal();
    loadBills();
  }
};

// ===== 总结 Tab =====
async function loadSummary() {
  const ym = state.summaryMonth;
  document.getElementById('summary-month-label').textContent = formatYM(ym);
  const container = document.getElementById('summary-content');
  container.innerHTML = '<div class="loading">生成总结中...</div>';

  const bills = await fetchBills(ym);
  const prevYM = shiftMonth(ym, -1);
  const prevBills = await fetchBills(prevYM);
  const budgets = await fetchBudgets(ym);

  if (bills.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>这个月还没有数据</p></div>`;
    return;
  }

  const total = bills.reduce((s, b) => s + parseFloat(b.amount), 0);
  const prevTotal = prevBills.reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalBudget = budgets.find(b => b.category === '')?.budget_amount;

  let compareHtml = '';
  if (prevBills.length > 0) {
    const diff = total - prevTotal;
    const pct = prevTotal > 0 ? ((diff / prevTotal) * 100).toFixed(1) : 0;
    const cls = diff > 0 ? 'up' : 'down';
    const arrow = diff > 0 ? '↑' : '↓';
    compareHtml = `<div class="summary-compare">比上月 <span class="${cls}">${arrow} ¥${Math.abs(diff).toFixed(2)} (${Math.abs(pct)}%)</span></div>`;
  }

  let budgetHtml = '';
  if (totalBudget) {
    const pct = Math.min((total / totalBudget) * 100, 100);
    const barColor = pct > 90 ? '#A64B4B' : pct > 70 ? '#B8698A' : 'var(--indigo)';
    const remaining = totalBudget - total;
    budgetHtml = `<div class="summary-card">
      <h3>💰 预算</h3>
      <div class="budget-progress">
        <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="budget-info">
          <span>已花 ¥${total.toFixed(2)}</span>
          <span>${remaining >= 0 ? `剩余 ¥${remaining.toFixed(2)}` : `超支 ¥${Math.abs(remaining).toFixed(2)}`}</span>
        </div>
      </div>
    </div>`;
  }

  // 类别分布
  const catMap = {};
  bills.forEach(b => {
    catMap[b.category] = (catMap[b.category] || 0) + parseFloat(b.amount);
  });
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  // 满足感分布
  const satMap = {};
  SATISFACTIONS.forEach(s => satMap[s.name] = 0);
  bills.forEach(b => satMap[b.satisfaction] = (satMap[b.satisfaction] || 0) + 1);

  const satDistHtml = SATISFACTIONS.map(s => {
    const count = satMap[s.name] || 0;
    const pct = bills.length > 0 ? (count / bills.length * 100) : 0;
    if (count === 0) return '';
    return `<div class="sat-dist-row">
      <span>${s.emoji}</span>
      <div class="sat-bar-bg"><div class="sat-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
      <span class="sat-pct">${count}笔</span>
    </div>`;
  }).join('');

  // 满足感得分
  const satScore = { '非常满足': 3, '比较满足': 2, '一般满足': 1, '一般': 0, '无感': 0, '比较不满': -1, '非常不满': -2 };
  const happyCount = bills.filter(b => ['非常满足','比较满足','一般满足'].includes(b.satisfaction)).length;
  const happyPct = (happyCount / bills.length * 100).toFixed(0);

  // 最值得 & 最不值得
  const sorted = [...bills].sort((a, b) => {
    const sa = satScore[a.satisfaction] ?? 0;
    const sb2 = satScore[b.satisfaction] ?? 0;
    return sb2 - sa || parseFloat(b.amount) - parseFloat(a.amount);
  });
  const bestBills = sorted.slice(0, 3);
  const worstBills = sorted.filter(b => (satScore[b.satisfaction] ?? 0) < 0).slice(-3).reverse();

  // 最贵的
  const expensive = [...bills].sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)).slice(0, 5);

  container.innerHTML = `
    <div class="summary-card">
      <div class="summary-total">¥${total.toFixed(2)} <span class="unit">元</span></div>
      <div style="text-align:center;color:var(--text-muted);font-size:13px">${bills.length} 笔消费</div>
      ${compareHtml}
    </div>

    <div class="review-card">
      <div class="review-label">— 傅融点评 —</div>
      <div class="review-text">${generateReview(bills, prevBills, budgets)}</div>
    </div>

    ${budgetHtml}

    <div class="summary-card">
      <h3>📂 类别分布</h3>
      <div class="chart-container"><canvas id="cat-chart"></canvas></div>
      <div style="margin-top:12px">
        ${catEntries.map(([cat, amt]) =>
          `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px">
            <span>${catEmoji(cat)} ${cat}</span>
            <span style="font-weight:600;color:var(--primary)">¥${amt.toFixed(2)}</span>
          </div>`
        ).join('')}
      </div>
    </div>

    <div class="summary-card">
      <h3>😊 满足感分布</h3>
      <p style="font-size:14px;color:var(--indigo);margin-bottom:10px;font-weight:600">${happyPct}% 的消费让你感到满足</p>
      <div class="sat-dist">${satDistHtml}</div>
    </div>

    <div class="summary-card">
      <h3>💸 花费最多</h3>
      <ul class="top-list">
        ${expensive.map(b => `<li>
          <span class="item-sat">${satEmoji(b.satisfaction)}</span>
          <span class="item-name">${esc(b.item)}</span>
          <span class="item-amount">¥${parseFloat(b.amount).toFixed(2)}</span>
        </li>`).join('')}
      </ul>
    </div>

    ${bestBills.length ? `<div class="summary-card">
      <h3>🌟 最值得的消费</h3>
      <ul class="top-list">
        ${bestBills.map(b => `<li>
          <span class="item-sat">${satEmoji(b.satisfaction)}</span>
          <span class="item-name">${esc(b.item)}</span>
          <span class="item-amount">¥${parseFloat(b.amount).toFixed(2)}</span>
        </li>`).join('')}
      </ul>
    </div>` : ''}

    ${worstBills.length ? `<div class="summary-card">
      <h3>💔 最不值得的消费</h3>
      <ul class="top-list">
        ${worstBills.map(b => `<li>
          <span class="item-sat">${satEmoji(b.satisfaction)}</span>
          <span class="item-name">${esc(b.item)}</span>
          <span class="item-amount">¥${parseFloat(b.amount).toFixed(2)}</span>
        </li>`).join('')}
      </ul>
    </div>` : ''}
  `;

  // 画饼图
  if (catChartInstance) catChartInstance.destroy();
  const ctx = document.getElementById('cat-chart');
  if (ctx) {
    const colors = ['#8E7AA8','#B8698A','#A896B8','#7A6B8E','#C9B8D4',
      '#D9C9E0','#5C4E6E','#E8E1EC','#6e5e88','#9b8ab5','#c4a8d0','#7c6bc4'];
    catChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: catEntries.map(([c]) => c),
        datasets: [{ data: catEntries.map(([,v]) => v), backgroundColor: colors.slice(0, catEntries.length), borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } },
        cutout: '55%',
      },
    });
  }
}

// ===== 搜索 Tab =====
function initSearch() {
  const catSelect = document.getElementById('search-category');
  CATEGORIES.forEach(c => {
    catSelect.innerHTML += `<option value="${c.name}">${c.emoji} ${c.name}</option>`;
  });

  const satSelect = document.getElementById('search-satisfaction');
  SATISFACTIONS.forEach(s => {
    satSelect.innerHTML += `<option value="${s.name}">${s.emoji} ${s.name}</option>`;
  });

  let timer;
  const doSearch = async () => {
    const query = document.getElementById('search-input').value.trim();
    const cat = catSelect.value;
    const sat = satSelect.value;
    if (!query && !cat && !sat) {
      document.getElementById('search-results').innerHTML = '<div class="search-hint">输入关键词，或选择类别/满足感筛选</div>';
      return;
    }
    document.getElementById('search-results').innerHTML = '<div class="loading">搜索中...</div>';
    const results = await searchBills(query, cat, sat);
    if (results.length === 0) {
      document.getElementById('search-results').innerHTML = '<div class="search-hint">没找到 😶</div>';
      return;
    }
    const totalAmt = results.reduce((s, b) => s + parseFloat(b.amount), 0);
    let html = `<div style="padding:8px 0;font-size:13px;color:var(--text-muted)">${results.length} 条结果 · 共 ¥${totalAmt.toFixed(2)}</div>`;
    results.forEach(b => {
      html += `<div class="bill-item" style="cursor:default">
        <div class="bill-row">
          <div class="bill-left">
            <div class="bill-name">${esc(b.item)}</div>
            <div class="bill-meta">
              <span class="bill-category-tag">${catEmoji(b.category)} ${b.category}</span>
              <span class="bill-sat">${satEmoji(b.satisfaction)}</span>
              <span style="font-size:11px;color:var(--text-muted)">${formatDate(b.date)}</span>
            </div>
          </div>
          <div class="bill-amount">¥${parseFloat(b.amount).toFixed(2)}</div>
        </div>
        ${b.reason ? `<div style="font-size:13px;color:#666;margin-top:6px">💬 ${esc(b.reason)}</div>` : ''}
        ${b.follow_up ? `<div class="follow-up" style="margin-top:6px">
          <div class="follow-up-label">追评</div><div>${esc(b.follow_up)}</div>
        </div>` : ''}
      </div>`;
    });
    document.getElementById('search-results').innerHTML = html;
  };

  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(doSearch, 400);
  });
  catSelect.addEventListener('change', doSearch);
  satSelect.addEventListener('change', doSearch);
}

// ===== 预算 Tab =====
async function loadBudgetPage() {
  const monthInput = document.getElementById('budget-month');
  monthInput.value = state.budgetMonth;

  const catBudgets = document.getElementById('category-budgets');
  catBudgets.innerHTML = '<h4 style="font-size:14px;margin:12px 0 8px;color:var(--text-muted)">分类预算（选填）</h4>' +
    CATEGORIES.map(c =>
      `<div class="budget-cat-row">
        <span class="cat-label">${c.emoji} ${c.name}</span>
        <input type="number" step="1" min="0" placeholder="不限" data-cat="${c.name}" class="budget-cat-input">
      </div>`
    ).join('');

  const budgets = await fetchBudgets(state.budgetMonth);
  const totalBudget = budgets.find(b => b.category === '');
  if (totalBudget) document.getElementById('budget-total').value = totalBudget.budget_amount;
  budgets.forEach(b => {
    if (b.category) {
      const input = catBudgets.querySelector(`[data-cat="${b.category}"]`);
      if (input) input.value = b.budget_amount;
    }
  });

  monthInput.addEventListener('change', () => {
    state.budgetMonth = monthInput.value;
    loadBudgetPage();
  });

  // 当月预算状态
  const bills = await fetchBills(state.budgetMonth);
  const total = bills.reduce((s, b) => s + parseFloat(b.amount), 0);
  const statusEl = document.getElementById('budget-status');
  if (budgets.length > 0) {
    let statusHtml = '<h3 style="font-size:14px;color:var(--text-muted);margin-bottom:10px">当月预算状态</h3>';
    if (totalBudget) {
      const pct = Math.min((total / totalBudget.budget_amount) * 100, 100);
      const barColor = pct > 90 ? '#A64B4B' : pct > 70 ? '#B8698A' : 'var(--indigo)';
      const remaining = totalBudget.budget_amount - total;
      statusHtml += `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span>总预算 ¥${totalBudget.budget_amount}</span>
          <span>${remaining >= 0 ? '剩余 ¥' + remaining.toFixed(2) : '超支 ¥' + Math.abs(remaining).toFixed(2)}</span>
        </div>
        <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      </div>`;
    }

    const catBudgetEntries = budgets.filter(b => b.category);
    if (catBudgetEntries.length > 0) {
      const catSpent = {};
      bills.forEach(b => { catSpent[b.category] = (catSpent[b.category] || 0) + parseFloat(b.amount); });
      catBudgetEntries.forEach(b => {
        const spent = catSpent[b.category] || 0;
        const pct = Math.min((spent / b.budget_amount) * 100, 100);
        const barColor = pct > 90 ? '#A64B4B' : pct > 70 ? '#B8698A' : 'var(--indigo)';
        statusHtml += `<div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span>${catEmoji(b.category)} ${b.category}</span>
            <span>¥${spent.toFixed(2)} / ¥${b.budget_amount}</span>
          </div>
          <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        </div>`;
      });
    }
    statusEl.innerHTML = statusHtml;
  } else {
    statusEl.innerHTML = '';
  }
}

document.getElementById('save-budget-btn').addEventListener('click', async () => {
  const ym = state.budgetMonth;
  const totalVal = parseFloat(document.getElementById('budget-total').value) || 0;
  await upsertBudget(ym, '', totalVal);

  const catInputs = document.querySelectorAll('.budget-cat-input');
  for (const input of catInputs) {
    const val = parseFloat(input.value) || 0;
    await upsertBudget(ym, input.dataset.cat, val);
  }
  toast('预算已保存 ✨');
  loadBudgetPage();
});

// ===== 导出Excel =====
document.getElementById('export-btn').addEventListener('click', async () => {
  toast('正在导出...');
  const bills = await fetchAllBills();
  if (bills.length === 0) { toast('没有数据可导出'); return; }

  const rows = bills.map(b => ({
    '日期': b.date,
    '物品/服务': b.item,
    '满足感': b.satisfaction,
    '原因说明': b.reason || '',
    '金额': parseFloat(b.amount),
    '类别': b.category,
    '追评': b.follow_up || '',
    '追评日期': b.follow_up_date || '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 35 }, { wch: 10 },
    { wch: 40 }, { wch: 10 }, { wch: 12 },
    { wch: 30 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '账单');
  XLSX.writeFile(wb, `傅副官的账本_${todayDate()}.xlsx`);
  toast('导出成功 ✨');
});

// ===== Event Bindings =====
function init() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('bills-prev').addEventListener('click', () => {
    state.billsMonth = shiftMonth(state.billsMonth, -1);
    loadBills();
  });
  document.getElementById('bills-next').addEventListener('click', () => {
    state.billsMonth = shiftMonth(state.billsMonth, 1);
    loadBills();
  });
  document.getElementById('summary-prev').addEventListener('click', () => {
    state.summaryMonth = shiftMonth(state.summaryMonth, -1);
    loadSummary();
  });
  document.getElementById('summary-next').addEventListener('click', () => {
    state.summaryMonth = shiftMonth(state.summaryMonth, 1);
    loadSummary();
  });

  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  initAddForm();
  initSearch();
}

init();
