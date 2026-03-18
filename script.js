
'use strict';



/* Pomodoro durations in seconds */
const DURATIONS = {
  focus:      25 * 60,   // 25 minutes
  shortBreak:  5 * 60,   //  5 minutes
  longBreak:  15 * 60,   // 15 minutes
};

const SESSIONS_BEFORE_LONG_BREAK = 4;   // long break every 4 focus sessions

const RING_RADIUS        = 96;           // must match SVG r attribute
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈ 603.19

/* Human-readable config per mode — single place to change labels / messages */
const MODE_CONFIG = {
  focus: {
    label:         'Focus',
    statusReady:   'Ready to focus',
    statusRunning: 'Focusing…',
    toastComplete: 'Focus session done! Time for a break. 🎉',
    ringClass:     'ring-mode-focus',
    logLabel:      'Focus',
    minutes:       25,
  },
  shortBreak: {
    label:         'Short Break',
    statusReady:   'Break time',
    statusRunning: 'On a short break…',
    toastComplete: 'Break over — back to it! 💪',
    ringClass:     'ring-mode-short',
    logLabel:      'Short Break',
    minutes:       5,
  },
  longBreak: {
    label:         'Long Break',
    statusReady:   'Long break time',
    statusRunning: 'On a long break…',
    toastComplete: 'Long break done — starting a new cycle! 🔁',
    ringClass:     'ring-mode-long',
    logLabel:      'Long Break',
    minutes:       15,
  },
};

const STORAGE_KEYS = {
  tasks:          'sf_tasks',
  studyMinutes:   'sf_study_minutes',
  sessions:       'sf_sessions',
  theme:          'sf_theme',
};


/* ─────────────────────────────────────────────────────────────────────
   STATE  (single source of truth)
───────────────────────────────────────────────────────────────────── */

const state = {
  tasks:        [],      // Array of task objects
  studyMinutes: 0,       // Total minutes studied today
  sessions:     [],      // Array of { label, minutes, timestamp }

  timer: {
    mode:              'focus',          // 'focus' | 'shortBreak' | 'longBreak'
    timeLeft:          DURATIONS.focus,  // seconds remaining in current session
    isRunning:         false,
    intervalId:        null,
    sessionsCompleted: 0,                // focus sessions completed this app session
  },

  activeTab: 'dashboard',
};


/* ─────────────────────────────────────────────────────────────────────
   PERSISTENCE — LocalStorage
───────────────────────────────────────────────────────────────────── */

function persistState() {
  localStorage.setItem(STORAGE_KEYS.tasks,        JSON.stringify(state.tasks));
  localStorage.setItem(STORAGE_KEYS.studyMinutes, state.studyMinutes);
  localStorage.setItem(STORAGE_KEYS.sessions,     JSON.stringify(state.sessions));
}

function hydrateState() {
  const tasks = localStorage.getItem(STORAGE_KEYS.tasks);
  if (tasks) state.tasks = JSON.parse(tasks);

  const minutes = localStorage.getItem(STORAGE_KEYS.studyMinutes);
  if (minutes) state.studyMinutes = parseInt(minutes, 10);

  const sessions = localStorage.getItem(STORAGE_KEYS.sessions);
  if (sessions) state.sessions = JSON.parse(sessions);
}
//issues such as pomodoro not updating everyday is on this hydrate state function, the way it is fetching all of it from localstorage where previous and new everything is loaded together, total duration is taken in that sense

/* ─────────────────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────────────────── */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Returns today's date string YYYY-MM-DD in local time */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Returns tomorrow's date string YYYY-MM-DD in local time */
function localTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Pretty-formats YYYY-MM-DD → "26 Feb 2026" */
function prettyDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

/** Formats minutes → "1h 35m" or "45m" */
function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Formats seconds → "MM:SS" */
function formatSeconds(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

let toastTimeout;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function getLongDate() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}


/* ─────────────────────────────────────────────────────────────────────
   TASK CATEGORISATION
───────────────────────────────────────────────────────────────────── */

function categorizeTasks() {
  const today    = localToday();
  const tomorrow = localTomorrow();

  const cats = { overdue: [], today: [], tomorrow: [], upcoming: [] };

  for (const task of state.tasks) {
    if (!task.deadline) { cats.upcoming.push(task); continue; }

    const isOverdue = !task.completed && task.deadline < today;

    if (isOverdue) {
      cats.overdue.push(task);
    } else if (task.deadline === today) {
      cats.today.push(task);
    } else if (task.deadline === tomorrow) {
      cats.tomorrow.push(task);
    } else if (task.deadline > tomorrow) {
      cats.upcoming.push(task);
    }
    // completed tasks with past deadlines are not shown
  }

  return cats;
}


/* ─────────────────────────────────────────────────────────────────────
   TASK CARD FACTORY
───────────────────────────────────────────────────────────────────── */

function createTaskCard(task, options = {}) {
  const { isOverdue = false } = options;
  const today = localToday();

  const card = document.createElement('li');
  card.className = `task-card p-${task.priority}${task.completed ? ' is-completed' : ''}`;
  card.dataset.id = task.id;

  // Checkbox
  const check = document.createElement('div');
  check.className = `task-check${task.completed ? ' checked' : ''}`;
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', task.completed);
  check.setAttribute('tabindex', '0');
  check.setAttribute('aria-label', `Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`);
  check.addEventListener('click',   () => toggleTask(task.id));
  check.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id); } });

  // Info
  const info = document.createElement('div');
  info.className = 'task-info';

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  if (task.deadline) {
    const dl = document.createElement('span');
    dl.className = `task-deadline${isOverdue ? ' is-overdue' : ''}`;
    dl.textContent = isOverdue
      ? `Overdue · ${prettyDate(task.deadline)}`
      : prettyDate(task.deadline);
    meta.appendChild(dl);
  }

  const pill = document.createElement('span');
  pill.className = `task-priority-pill pill-${task.priority}`;
  pill.textContent = task.priority;
  meta.appendChild(pill);

  info.appendChild(title);
  info.appendChild(meta);

  // Delete button
  const del = document.createElement('button');
  del.className = 'task-delete';
  del.setAttribute('aria-label', `Delete task: ${task.title}`);
  del.innerHTML = '&times;';
  del.addEventListener('click', () => deleteTask(task.id));

  card.appendChild(check);
  card.appendChild(info);
  card.appendChild(del);

  return card;
}


/* ─────────────────────────────────────────────────────────────────────
   RENDER HELPERS
───────────────────────────────────────────────────────────────────── */

/**
 * Populates a task-list div and shows/hides the associated empty state.
 * @param {string}   listId      - id of the .task-list element
 * @param {string}   emptyId     - id of the .empty-state element
 * @param {Array}    tasks       - array of task objects
 * @param {Object}   [options]   - forwarded to createTaskCard
 */
function renderTaskGroup(listId, emptyId, tasks, options = {}) {
  const listEl  = document.getElementById(listId);
  const emptyEl = document.getElementById(emptyId);

  if (!listEl || !emptyEl) return;

  listEl.innerHTML = '';

  if (tasks.length === 0) {
    emptyEl.classList.add('visible');
  } else {
    emptyEl.classList.remove('visible');
    const fragment = document.createDocumentFragment();
    tasks.forEach(t => fragment.appendChild(createTaskCard(t, options)));
    listEl.appendChild(fragment);
  }
}

function updateGroupCount(countId, count) {
  const el = document.getElementById(countId);
  if (el) el.textContent = count;
}


/* ─────────────────────────────────────────────────────────────────────
   FULL RENDER — called whenever state changes
───────────────────────────────────────────────────────────────────── */

function render() {
  const cats = categorizeTasks();

  // ── Dashboard ───────────────────────────────────────
  renderTaskGroup('dash-today-list',   'dash-today-empty',   cats.today,    {});
  renderTaskGroup('dash-overdue-list', 'dash-overdue-empty', cats.overdue,  { isOverdue: true });

  const overdueCountLabel = document.getElementById('dash-overdue-count-label');
  if (overdueCountLabel) {
    overdueCountLabel.textContent = cats.overdue.length > 0 ? cats.overdue.length : '';
  }

  // ── Tasks tab ───────────────────────────────────────
  renderTaskGroup('list-overdue',  'empty-overdue',  cats.overdue,  { isOverdue: true });
  renderTaskGroup('list-today',    'empty-today',    cats.today,    {});
  renderTaskGroup('list-tomorrow', 'empty-tomorrow', cats.tomorrow, {});
  renderTaskGroup('list-upcoming', 'empty-upcoming', cats.upcoming, {});

  updateGroupCount('count-overdue',  cats.overdue.length);
  updateGroupCount('count-today',    cats.today.length);
  updateGroupCount('count-tomorrow', cats.tomorrow.length);
  updateGroupCount('count-upcoming', cats.upcoming.length);

  // ── Analytics ───────────────────────────────────────
  renderAnalytics(cats);

  // ── KPIs ────────────────────────────────────────────
  renderKPIs(cats);

  // ── Nav badge ───────────────────────────────────────
  const pendingCount = cats.overdue.length + cats.today.length;
  const badge = document.getElementById('nav-tasks-badge');
  if (badge) {
    badge.textContent = pendingCount > 0 ? pendingCount : '';
    badge.classList.toggle('visible', pendingCount > 0);
  }
}


/* ─────────────────────────────────────────────────────────────────────
   KPI CARDS
───────────────────────────────────────────────────────────────────── */

function renderKPIs(cats) {
  const completed  = state.tasks.filter(t => t.completed).length;
  const total      = state.tasks.length;
  const overdue    = cats.overdue.length;

  // Study time
  const hours = Math.floor(state.studyMinutes / 60);
  const mins  = state.studyMinutes % 60;
  setText('kpi-study-time', `${hours}h ${mins}m`);
  setText('kpi-completed',  completed);
  setText('kpi-overdue',    overdue);

  // Progress bars (max 4h for study time, tasks for completion)
  const maxStudyMins = 240;
  setBarWidth('kpi-time-bar',      Math.min(state.studyMinutes / maxStudyMins * 100, 100));
  setBarWidth('kpi-completed-bar', total > 0 ? (completed / total) * 100 : 0);
  setBarWidth('kpi-overdue-bar',   total > 0 ? (overdue / total) * 100 : 0);
}


/* ─────────────────────────────────────────────────────────────────────
   ANALYTICS
───────────────────────────────────────────────────────────────────── */

function renderAnalytics(cats) {
  const completed = state.tasks.filter(t => t.completed).length;
  const total     = state.tasks.length;
  const overdue   = cats.overdue.length;
  const rate      = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Counts
  setText('an-study-time',    formatMinutes(state.studyMinutes));
  setText('an-sessions-txt',  `${state.sessions.length} session${state.sessions.length !== 1 ? 's' : ''} completed`);
  setText('an-completed',     completed);
  setText('an-of-total',      `of ${total} total`);
  setText('an-overdue',       overdue);
  setText('an-rate-pct',      `${rate}%`);
  setBarWidth('an-rate-fill', rate);

  const rateMsg = rate === 0
    ? 'Complete tasks to track your progress.'
    : rate < 50
    ? 'Good start — keep going!'
    : rate < 100
    ? 'Great momentum, finish strong.'
    : 'All tasks completed! 🎉';
  setText('an-rate-msg', rateMsg);

  // Priority breakdown
  const high   = state.tasks.filter(t => t.priority === 'high').length;
  const medium = state.tasks.filter(t => t.priority === 'medium').length;
  const low    = state.tasks.filter(t => t.priority === 'low').length;
  const maxP   = Math.max(high, medium, low, 1);

  setText('an-p-high',   high);
  setText('an-p-medium', medium);
  setText('an-p-low',    low);
  setBarWidth('an-bar-high',   (high   / maxP) * 100);
  setBarWidth('an-bar-medium', (medium / maxP) * 100);
  setBarWidth('an-bar-low',    (low    / maxP) * 100);
}

/* Quick DOM helpers */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBarWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(pct, 100))}%`;
}

function updateTimerStatus(text) {
  setText('timerStatus', text);
}


/* ─────────────────────────────────────────────────────────────────────
   TASK CRUD
───────────────────────────────────────────────────────────────────── */

function addTask(title, deadline, priority) {
  const task = {
    id:        uid(),
    title:     title.trim(),
    deadline,
    priority,
    completed: false,
    createdAt: Date.now(),
  };
  state.tasks.unshift(task); // newest first
  persistState();
  render();
  showToast('Task added ✓');
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  persistState();
  render();
  showToast('Task removed');
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  persistState();
  render();
  showToast(task.completed ? 'Task completed ✓' : 'Task marked incomplete');
}


/* ─────────────────────────────────────────────────────────────────────
   SOUND ALERT — Web Audio API synthesised chime (no external file needed)
───────────────────────────────────────────────────────────────────── */

/**
 * Plays a pleasant 3-note ascending chime using the Web Audio API.
 * Fails silently if AudioContext is unavailable (e.g. restricted env).
 */
function playSound() {
  try {
    const ctx   = new (window.AudioContext || window.webkitAudioContext)();
    // C5 → E5 → G5 : a major triad arpeggio
    const notes = [523.25, 659.25, 783.99];

    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type            = 'sine';
      osc.frequency.value = freq;

      const t0 = ctx.currentTime + i * 0.2;   // stagger each note 200 ms apart
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);

      osc.start(t0);
      osc.stop(t0 + 0.65);
    });
  } catch (_) {
    /* AudioContext unavailable — silent fallback */
  }
}


/* ─────────────────────────────────────────────────────────────────────
   POMODORO TIMER — state machine
───────────────────────────────────────────────────────────────────── */

/**
 * Switch the timer to a new mode, loading the correct duration.
 * Does NOT start the timer — call startTimer() separately.
 * @param {'focus'|'shortBreak'|'longBreak'} newMode
 */
function switchMode(newMode) {
  // Always clear any running interval before switching
  clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  state.timer.isRunning  = false;

  state.timer.mode     = newMode;
  state.timer.timeLeft = DURATIONS[newMode];
}

/**
 * Updates the clock display, SVG ring progress, and all mode-specific
 * visual elements.  Called every second while running and on mode switch.
 */
function updateTimerDisplay() {
  const { timeLeft, mode } = state.timer;

  // ── Clock text ────────────────────────────────────────
  setText('timerDisplay', formatSeconds(timeLeft));

  // ── SVG ring ──────────────────────────────────────────
  const totalDuration = DURATIONS[mode];
  const elapsed       = totalDuration - timeLeft;
  const progress      = totalDuration > 0 ? elapsed / totalDuration : 0;
  const offset        = RING_CIRCUMFERENCE * (1 - progress);

  const ring = document.getElementById('ringProgress');
  if (ring) ring.style.strokeDashoffset = Math.max(0, offset);
}

/**
 * Updates every piece of mode-dependent UI:
 * badge label, ring colour class, cycle dots, session counter,
 * status text, and the timer-face data attribute.
 */
function updateTimerModeUI() {
  const { mode, sessionsCompleted } = state.timer;
  const config = MODE_CONFIG[mode];

  // ── Mode badge ────────────────────────────────────────
  setText('timerModeBadge', config.label);

  // ── Status text ───────────────────────────────────────
  updateTimerStatus(state.timer.isRunning ? config.statusRunning : config.statusReady);

  // ── Ring colour — swap class on the SVG circle ────────
  const ring = document.getElementById('ringProgress');
  if (ring) {
    ring.classList.remove('ring-mode-focus', 'ring-mode-short', 'ring-mode-long');
    ring.classList.add(config.ringClass);
  }

  // ── data-mode on wrapper drives CSS accent tokens ─────
  const faceWrap = document.getElementById('timerFaceWrap');
  if (faceWrap) faceWrap.dataset.mode = mode;

  // ── Cycle dots (4 dots = one full cycle) ──────────────
  const dotsContainer = document.getElementById('cycleDots');
  if (dotsContainer) {
    dotsContainer.innerHTML = '';
    const dotsInCycle = SESSIONS_BEFORE_LONG_BREAK;
    const filled      = sessionsCompleted % dotsInCycle;  // 0-3

    for (let i = 0; i < dotsInCycle; i++) {
      const dot = document.createElement('span');
      dot.className = `cycle-dot${i < filled ? ' filled' : ''}`;
      dotsContainer.appendChild(dot);
    }
  }

  // ── Sessions counter ──────────────────────────────────
  const inCycle = sessionsCompleted % SESSIONS_BEFORE_LONG_BREAK;
  setText('timerSessionsCount', `${inCycle} / ${SESSIONS_BEFORE_LONG_BREAK} to long break`);
  setText('timerTotalSessions', `${sessionsCompleted} focus session${sessionsCompleted !== 1 ? 's' : ''} today`);
}

/**
 * Handles logic when timeLeft reaches 0.
 * Implements the full cycle:
 *   focus × 4 → longBreak → repeat
 *   focus     → shortBreak (between long breaks)
 */
function handleSessionEnd() {
  // ── Stop the tick cleanly ─────────────────────────────
  clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  state.timer.isRunning  = false;
  state.timer.timeLeft   = 0;

  // ── Snap ring to 100% before switching ────────────────
  updateTimerDisplay();

  // ── Play chime ────────────────────────────────────────
  playSound();

  // ── Determine next mode ───────────────────────────────
  const currentMode  = state.timer.mode;
  const currentConfig = MODE_CONFIG[currentMode];
  let   nextMode;

  if (currentMode === 'focus') {
    // Record the completed focus session
    state.timer.sessionsCompleted += 1;
    state.studyMinutes            += currentConfig.minutes;

    const now       = new Date();
    const timeLabel = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    state.sessions.push({
      label:     timeLabel,
      type:      'focus',
      minutes:   currentConfig.minutes,
      timestamp: Date.now(),
    });

    persistState();
    render();           // refresh KPIs and analytics immediately
    renderSessionLog(); // update the session log list

    // Every 4th focus session triggers a long break
    nextMode = (state.timer.sessionsCompleted % SESSIONS_BEFORE_LONG_BREAK === 0)
      ? 'longBreak'
      : 'shortBreak';

  } else {
    // A break ended — log it and return to focus
    const now       = new Date();
    const timeLabel = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    state.sessions.push({
      label:     timeLabel,
      type:      currentMode,
      minutes:   currentConfig.minutes,
      timestamp: Date.now(),
    });

    persistState();
    renderSessionLog();

    nextMode = 'focus';
  }

  // ── Show toast for completed mode ─────────────────────
  showToast(currentConfig.toastComplete);

  // ── Switch to next mode & refresh UI ──────────────────
  switchMode(nextMode);
  updateTimerModeUI();
  updateTimerDisplay();

  // ── Auto-start next session after a short pause ───────
  setTimeout(() => {
    startTimer();
  }, 1500);
}

/**
 * Starts (or resumes) the countdown.
 * Clears any stale interval before creating a new one (no leaks).
 */
function startTimer() {
  if (state.timer.isRunning) return;

  // Guard: if somehow timeLeft is 0, reset the current mode first
  if (state.timer.timeLeft <= 0) {
    state.timer.timeLeft = DURATIONS[state.timer.mode];
  }

  // Clear any stale interval before creating a new one
  clearInterval(state.timer.intervalId);
  state.timer.isRunning = true;

  document.getElementById('startBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = false;

  updateTimerStatus(MODE_CONFIG[state.timer.mode].statusRunning);

  state.timer.intervalId = setInterval(() => {
    state.timer.timeLeft -= 1;
    updateTimerDisplay();

    if (state.timer.timeLeft <= 0) {
      handleSessionEnd();
    }
  }, 1000);
}

/**
 * Pauses the countdown, preserving timeLeft.
 */
function pauseTimer() {
  if (!state.timer.isRunning) return;

  clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  state.timer.isRunning  = false;

  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;

  updateTimerStatus('Paused');
}

/**
 * Resets the timer to the beginning of the current mode.
 * Does NOT change the mode or clear sessionsCompleted.
 */
function resetTimer() {
  clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  state.timer.isRunning  = false;
  state.timer.timeLeft   = DURATIONS[state.timer.mode];

  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;

  updateTimerModeUI();
  updateTimerDisplay();
}

/* Thin wrapper kept for backward-compat with init() */
function updateTimerUI() {
  updateTimerModeUI();
  updateTimerDisplay();
}

function renderSessionLog() {
  const list  = document.getElementById('sessionList');
  const empty = document.getElementById('sessionEmpty');
  const total = document.getElementById('sessionTotalDisplay');
  if (!list || !empty || !total) return;

  total.textContent = formatMinutes(state.studyMinutes);

  if (state.sessions.length === 0) {
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = '';

  const TYPE_ICON = {
    focus:      '🍅',
    shortBreak: '☕',
    longBreak:  '🌿',
  };

  // Show sessions newest-first
  const reversed = [...state.sessions].reverse();
  const fragment = document.createDocumentFragment();

  reversed.forEach((session, idx) => {
    const sessionNumber = state.sessions.length - idx;
    const typeLabel     = MODE_CONFIG[session.type]?.logLabel ?? session.type;
    const icon          = TYPE_ICON[session.type] ?? '⏱';

    const li = document.createElement('li');
    li.className = `session-item session-type-${session.type}`;
    li.innerHTML = `
      <span class="session-item-icon">${icon}</span>
      <span class="session-item-label">${typeLabel} · ${session.label}</span>
      <span class="session-item-time">${session.minutes}m</span>
    `;
    fragment.appendChild(li);
  });

  list.appendChild(fragment);
}


/* ─────────────────────────────────────────────────────────────────────
   TAB NAVIGATION (SPA routing — no page reload)
───────────────────────────────────────────────────────────────────── */

function navigateTo(tabName) {
  if (state.activeTab === tabName) return;
  state.activeTab = tabName;

  // Toggle panel visibility
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isTarget = panel.id === `tab-${tabName}`;
    panel.hidden = !isTarget;
    panel.classList.toggle('active', isTarget);
  });

  // Toggle nav-item active state
  document.querySelectorAll('.nav-item').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Close mobile sidebar
  closeMobileSidebar();
}

/* Delegate all [data-tab] clicks (sidebar + text-links) */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  navigateTo(btn.dataset.tab);
});


/* ─────────────────────────────────────────────────────────────────────
   MOBILE SIDEBAR
───────────────────────────────────────────────────────────────────── */

function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

document.getElementById('hamburger')?.addEventListener('click', openMobileSidebar);
document.getElementById('mobileClose')?.addEventListener('click', closeMobileSidebar);
document.getElementById('sidebarOverlay')?.addEventListener('click', closeMobileSidebar);


/* ─────────────────────────────────────────────────────────────────────
   DARK MODE
───────────────────────────────────────────────────────────────────── */

function applyTheme(isDark) {
  document.body.classList.toggle('dark', isDark);
  localStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');

  // Swap moon ↔ sun icon
  const moonPath = "M17.3 13.4A7 7 0 0 1 6.6 2.7 7.5 7.5 0 1 0 17.3 13.4z";
  const sunPath  = "M10 2v1M10 17v1M3.2 5.2l.7.7M16.1 15.1l.7.7M2 10h1M17 10h1M3.9 14.8l.7-.7M15.4 4.9l.7-.7M7 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0z";

  const icon = document.getElementById('themeIcon');
  if (icon) icon.querySelector('path').setAttribute('d', isDark ? sunPath : moonPath);
}

function toggleTheme() {
  applyTheme(!document.body.classList.contains('dark'));
}

document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
document.getElementById('themeToggleMobile')?.addEventListener('click', toggleTheme);


/* ─────────────────────────────────────────────────────────────────────
   TASK FORM SUBMISSION
───────────────────────────────────────────────────────────────────── */

document.getElementById('addTaskBtn')?.addEventListener('click', () => {
  const titleEl    = document.getElementById('taskTitle');
  const deadlineEl = document.getElementById('taskDeadline');
  const priorityEl = document.getElementById('taskPriority');

  const title    = titleEl.value.trim();
  const deadline = deadlineEl.value;
  const priority = priorityEl.value;

  if (!title) {
    showToast('Please enter a task title.');
    titleEl.focus();
    return;
  }
  if (!deadline) {
    showToast('Please choose a deadline date.');
    deadlineEl.focus();
    return;
  }

  addTask(title, deadline, priority);

  // Reset form
  titleEl.value    = '';
  deadlineEl.value = localToday();
  priorityEl.value = 'medium';
  titleEl.focus();
});

/* Allow Enter key in title field to submit */
document.getElementById('taskTitle')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('addTaskBtn')?.click();
  }
});


/* ─────────────────────────────────────────────────────────────────────
   TIMER CONTROLS
───────────────────────────────────────────────────────────────────── */

document.getElementById('startBtn')?.addEventListener('click', startTimer);
document.getElementById('pauseBtn')?.addEventListener('click', pauseTimer);
document.getElementById('resetBtn')?.addEventListener('click', resetTimer);


/* ─────────────────────────────────────────────────────────────────────
   DASHBOARD HEADER — date & greeting
───────────────────────────────────────────────────────────────────── */

function renderDashboardMeta() {
  const dateEl = document.getElementById('dashDate');
  const greetEl = document.getElementById('timeOfDay');
  if (dateEl) dateEl.textContent = getLongDate();
  if (greetEl) greetEl.textContent = getGreeting();
}


/* ─────────────────────────────────────────────────────────────────────
   RING SVG — set correct dasharray on mount
───────────────────────────────────────────────────────────────────── */

function initRing() {
  const ring = document.getElementById('ringProgress');
  if (ring) {
    ring.style.strokeDasharray  = RING_CIRCUMFERENCE;
    ring.style.strokeDashoffset = 0;
    ring.classList.add('ring-mode-focus');   // start in focus colour
  }

  // Stamp the initial data-mode so CSS tokens are correct from load
  const faceWrap = document.getElementById('timerFaceWrap');
  if (faceWrap) faceWrap.dataset.mode = 'focus';
}


/* ─────────────────────────────────────────────────────────────────────
   INITIALISE APPLICATION
───────────────────────────────────────────────────────────────────── */

function init() {
  // 1. Load persisted data
  hydrateState();

  // 2. Apply saved theme
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  if (savedTheme === 'dark') applyTheme(true);

  // 3. Set default form date
  const deadlineInput = document.getElementById('taskDeadline');
  if (deadlineInput) deadlineInput.value = localToday();

  // 4. Render everything
  renderDashboardMeta();
  initRing();
  updateTimerUI();
  renderSessionLog();
  render();

  // 5. Ensure correct initial tab state
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isActive = panel.id === 'tab-dashboard';
    panel.hidden = !isActive;
    panel.classList.toggle('active', isActive);
  });
}

// Kick off
init();