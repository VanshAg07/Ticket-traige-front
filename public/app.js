'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   TicketAI — Frontend Application
   ═══════════════════════════════════════════════════════════════════════════ */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : `http://${window.location.hostname}:3001`;

/* ── Sample ticket messages ─────────────────────────────────────────────────── */
const SAMPLES = {
    billing: `I've been charged twice on my latest invoice — two charges of $99.00 appeared on my credit card on February 25th. I have a receipt showing I only made one payment. I need an urgent refund for the duplicate charge. My account number is #AC-29811. Please look into this immediately.`,

    technical: `Our production environment is completely down — the API server keeps returning 500 errors on every request. It started about 2 hours ago. The error logs show: "DatabaseConnectionError: timeout after 30000ms". All users are affected and we're losing revenue. This is a critical outage, please escalate immediately!`,

    security: `I believe my account has been hacked. I received a login notification from an IP address in Russia that I don't recognize, and someone changed my email address without my authorization. There may be a security breach — I can see several unauthorized transactions in the billing history. My data may be compromised. Please lock my account and initiate an investigation right away.`,

    feature: `I'd love to see a bulk export feature added to the dashboard. Currently, I have to download each report individually, which is very tedious. It would be great if we could select multiple reports and export them as a ZIP file. This would be a massive improvement for teams managing large amounts of data. Could this be added to the roadmap?`
};

/* ── State ──────────────────────────────────────────────────────────────────── */
let state = {
    currentPage: 0,
    pageSize: 10,
    totalTickets: 0,
    lastAnalysis: null,
    isAnalyzing: false,
    categoryFilter: '',
    priorityFilter: ''
};

/* ── DOM References ─────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const ticketForm = $('ticketForm');
const ticketMessage = $('ticketMessage');
const charCount = $('charCount');
const analyzeBtn = $('analyzeBtn');
const messageError = $('messageError');

// Result states
const emptyState = $('emptyState');
const loadingState = $('loadingState');
const errorState = $('errorState');
const errorMessage = $('errorMessage');
const resultContent = $('resultContent');
const retryBtn = $('retryBtn');

// Result elements
const categoryBadge = $('categoryBadge');
const categoryValue = $('categoryValue');
const priorityBadge = $('priorityBadge');
const priorityCode = $('priorityCode');
const priorityLabelVal = $('priorityLabelVal');
const urgencyBadge = $('urgencyBadge');
const urgencyValue = $('urgencyValue');
const confidencePercent = $('confidencePercent');
const confidenceFill = $('confidenceFill');
const confidenceBar = $('confidenceBar');
const keywordsList = $('keywordsList');
const signalsList = $('signalsList');
const flagsSection = $('flagsSection');
const flagsList = $('flagsList');

// History
const categoryFilter = $('categoryFilter');
const priorityFilter = $('priorityFilter');
const refreshBtn = $('refreshBtn');
const ticketsTableBody = $('ticketsTableBody');
const ticketsLoading = $('ticketsLoading');
const historyEmpty = $('historyEmpty');
const tableWrap = $('tableWrap');
const pagination = $('pagination');
const totalCountValue = $('totalCountValue');

// Status
const statusDot = $('statusDot');
const statusText = $('statusText');

/* ── API Client ─────────────────────────────────────────────────────────────── */
async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
        const msg = data.details
            ? data.details.map(d => d.msg).join('; ')
            : data.error || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

/* ── Health check ───────────────────────────────────────────────────────────── */
async function checkHealth() {
    try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data.status === 'ok') {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'API Online';
        } else {
            throw new Error();
        }
    } catch {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'API Offline';
    }
}

/* ── Char counter ───────────────────────────────────────────────────────────── */
ticketMessage.addEventListener('input', () => {
    const len = ticketMessage.value.length;
    charCount.textContent = `${len} / 5000`;
    charCount.style.color = len > 4500 ? '#ef4444' : len > 4000 ? '#eab308' : '';
    if (messageError.textContent) clearError();
    if (ticketMessage.classList.contains('invalid') && len >= 5) {
        ticketMessage.classList.remove('invalid');
        messageError.textContent = '';
    }
});

function clearError() {
    messageError.textContent = '';
    ticketMessage.classList.remove('invalid');
}

/* ── Sample buttons ─────────────────────────────────────────────────────────── */
document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const sample = btn.dataset.sample;
        ticketMessage.value = SAMPLES[sample] || '';
        ticketMessage.dispatchEvent(new Event('input'));
        ticketMessage.focus();
        clearError();
    });
});

/* ── Form submit ────────────────────────────────────────────────────────────── */
ticketForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isAnalyzing) return;

    const msg = ticketMessage.value.trim();

    // Validate
    if (!msg) {
        messageError.textContent = 'Please describe your issue before analyzing.';
        ticketMessage.classList.add('invalid');
        ticketMessage.focus();
        return;
    }

    if (msg.length < 5) {
        messageError.textContent = 'Message must be at least 5 characters long.';
        ticketMessage.classList.add('invalid');
        return;
    }

    await submitTicket(msg);
});

async function submitTicket(message) {
    state.isAnalyzing = true;
    setResultState('loading');
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('loading');

    // Simulate sequential loading steps for UX
    const steps = ['step1', 'step2', 'step3', 'step4'];
    let stepIdx = 0;

    const stepTimer = setInterval(() => {
        if (stepIdx > 0) {
            const prevStep = $(steps[stepIdx - 1]);
            if (prevStep) prevStep.className = 'step done';
        }
        if (stepIdx < steps.length) {
            const curStep = $(steps[stepIdx]);
            if (curStep) curStep.className = 'step active';
            stepIdx++;
        }
    }, 250);

    try {
        const data = await apiPost('/tickets/analyze', { message });
        clearInterval(stepTimer);

        // Mark all steps done
        steps.forEach(id => { const el = $(id); if (el) el.className = 'step done'; });

        await new Promise(r => setTimeout(r, 300)); // Let user see completed steps

        state.lastAnalysis = data.data;
        renderResult(data.data);
        setResultState('result');

        // Refresh ticket list
        state.currentPage = 0;
        await loadTickets();

    } catch (err) {
        clearInterval(stepTimer);
        errorMessage.textContent = err.message || 'Failed to analyze ticket. Please try again.';
        setResultState('error');
    } finally {
        state.isAnalyzing = false;
        analyzeBtn.disabled = false;
        analyzeBtn.classList.remove('loading');

        // Reset step states
        steps.forEach(id => { const el = $(id); if (el) el.className = 'step'; });
    }
}

/* ── Result state manager ───────────────────────────────────────────────────── */
function setResultState(state) {
    emptyState.classList.add('hidden');
    loadingState.classList.add('hidden');
    errorState.classList.add('hidden');
    resultContent.classList.add('hidden');

    if (state === 'empty') emptyState.classList.remove('hidden');
    else if (state === 'loading') loadingState.classList.remove('hidden');
    else if (state === 'error') errorState.classList.remove('hidden');
    else if (state === 'result') resultContent.classList.remove('hidden');
}

/* ── Render result ──────────────────────────────────────────────────────────── */
function renderResult(ticket) {
    const { category, priority, priority_label, urgency, confidence, keywords, signals, custom_flags } = ticket;

    // Category
    const catClass = getCategoryClass(category);
    categoryBadge.className = `badge-card ${catClass}`;
    categoryValue.textContent = category;

    // Priority
    const priClass = `pri-${priority.toLowerCase()}`;
    priorityBadge.className = `badge-card priority-badge ${priClass}`;
    priorityCode.textContent = priority;
    priorityLabelVal.textContent = priority_label;
    priorityLabelVal.className = 'priority-label';

    // Urgency
    const urgClass = `urgency-${urgency}`;
    urgencyBadge.className = `badge-card ${urgClass}`;
    urgencyValue.textContent = urgency.charAt(0).toUpperCase() + urgency.slice(1);

    // Confidence
    const pct = Math.round(confidence * 100);
    confidencePercent.textContent = `${pct}%`;
    confidenceFill.style.width = '0%';
    confidenceBar.setAttribute('aria-valuenow', pct);
    setTimeout(() => { confidenceFill.style.width = `${pct}%`; }, 50);

    // Keywords
    keywordsList.innerHTML = keywords.length
        ? keywords.map(k => `<span class="keyword-tag">${escHtml(k)}</span>`).join('')
        : '<span class="keyword-tag" style="opacity:.5">No keywords detected</span>';

    // Signals
    signalsList.innerHTML = signals.length
        ? signals.map(s => `<li>${escHtml(s)}</li>`).join('')
        : '<li>General classification applied</li>';

    // Custom flags
    if (custom_flags && custom_flags.length > 0) {
        flagsSection.classList.remove('hidden');
        flagsList.innerHTML = custom_flags.map(f => `<span class="flag-tag ${f}">${formatFlag(f)}</span>`).join('');
    } else {
        flagsSection.classList.add('hidden');
        flagsList.innerHTML = '';
    }
}

function getCategoryClass(cat) {
    const map = {
        'Billing': 'cat-billing',
        'Technical': 'cat-technical',
        'Account': 'cat-account',
        'Feature Request': 'cat-feature',
        'Other': 'cat-other'
    };
    return map[cat] || 'cat-other';
}

function formatFlag(flag) {
    return flag === 'SECURITY_FAST_TRACK' ? '🛡 Security Fast-Track' : '💳 Refund Fast-Track';
}

/* ── Retry ──────────────────────────────────────────────────────────────────── */
retryBtn.addEventListener('click', () => {
    setResultState('empty');
});

/* ── Load tickets ───────────────────────────────────────────────────────────── */
async function loadTickets() {
    ticketsLoading.classList.remove('hidden');
    historyEmpty.classList.add('hidden');
    tableWrap.classList.add('hidden');
    pagination.innerHTML = '';

    const params = new URLSearchParams({
        limit: state.pageSize,
        offset: state.currentPage * state.pageSize
    });

    if (state.categoryFilter) params.append('category', state.categoryFilter);
    if (state.priorityFilter) params.append('priority', state.priorityFilter);

    try {
        const data = await apiGet(`/tickets?${params}`);
        const { tickets, pagination: pag } = data.data;

        state.totalTickets = pag.total;
        totalCountValue.textContent = pag.total;

        ticketsLoading.classList.add('hidden');

        if (tickets.length === 0) {
            historyEmpty.classList.remove('hidden');
        } else {
            tableWrap.classList.remove('hidden');
            renderTable(tickets);
            renderPagination(pag);
        }
    } catch (err) {
        ticketsLoading.classList.add('hidden');
        historyEmpty.classList.remove('hidden');
        historyEmpty.innerHTML = `<p style="color:#ef4444">Failed to load tickets: ${escHtml(err.message)}</p>`;
    }
}

/* ── Render table ───────────────────────────────────────────────────────────── */
function renderTable(tickets) {
    ticketsTableBody.innerHTML = tickets.map(t => {
        const catLabel = t.category.replace(' ', '').replace('Request', '');
        const catChipClass = t.category.startsWith('Feature') ? 'Feature' : t.category;
        const flags = (t.custom_flags || []);
        const flagsHtml = flags.length
            ? flags.map(f => `<span class="flag-mini ${f}">${f === 'SECURITY_FAST_TRACK' ? '🛡' : '💳'}</span>`).join(' ')
            : '<span style="color:var(--clr-text-faint);font-size:0.72rem">—</span>';

        return `
      <tr>
        <td class="td-id">#${t.id}</td>
        <td class="td-message" title="${escHtml(t.message)}">${escHtml(t.message)}</td>
        <td class="td-category"><span class="cat-chip ${escHtml(catChipClass)}">${escHtml(t.category)}</span></td>
        <td class="td-priority"><span class="pri-chip ${escHtml(t.priority)}">${escHtml(t.priority)}</span></td>
        <td class="td-urgency"><span class="urg-chip ${escHtml(t.urgency)}">${escHtml(t.urgency)}</span></td>
        <td class="td-confidence">${Math.round(t.confidence * 100)}%</td>
        <td class="td-flags">${flagsHtml}</td>
        <td class="td-created">${formatDate(t.created_at)}</td>
      </tr>
    `;
    }).join('');
}

/* ── Render pagination ──────────────────────────────────────────────────────── */
function renderPagination(pag) {
    const totalPages = Math.ceil(pag.total / pag.limit);
    if (totalPages <= 1) return;

    let html = '';

    html += `<button class="page-btn" ${state.currentPage === 0 ? 'disabled' : ''} data-page="${state.currentPage - 1}">← Prev</button>`;

    for (let i = 0; i < totalPages; i++) {
        html += `<button class="page-btn ${i === state.currentPage ? 'active' : ''}" data-page="${i}">${i + 1}</button>`;
    }

    html += `<button class="page-btn" ${!pag.hasMore ? 'disabled' : ''} data-page="${state.currentPage + 1}">Next →</button>`;

    pagination.innerHTML = html;

    pagination.querySelectorAll('.page-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
            state.currentPage = parseInt(btn.dataset.page);
            loadTickets();
        });
    });
}

/* ── Filters ────────────────────────────────────────────────────────────────── */
categoryFilter.addEventListener('change', () => {
    state.categoryFilter = categoryFilter.value;
    state.currentPage = 0;
    loadTickets();
});

priorityFilter.addEventListener('change', () => {
    state.priorityFilter = priorityFilter.value;
    state.currentPage = 0;
    loadTickets();
});

refreshBtn.addEventListener('click', () => {
    loadTickets();
});

/* ── Utilities ──────────────────────────────────────────────────────────────── */
function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/* ── Init ───────────────────────────────────────────────────────────────────── */
async function init() {
    setResultState('empty');

    // Health check (poll every 30 seconds)
    await checkHealth();
    setInterval(checkHealth, 30000);

    // Load initial tickets
    await loadTickets();
}

document.addEventListener('DOMContentLoaded', init);
