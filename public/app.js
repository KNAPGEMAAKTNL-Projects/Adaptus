// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  progress: { cycle: 1, week: 1 },
  weekCache: {},
  currentSession: null,
  currentWorkoutData: null,
  currentExerciseIndex: 0,
  activeSubstitutions: {},
  sessionSets: {},
  lastPerformance: {},
  restTimer: { active: false, seconds: 0, total: 0, intervalId: null, done: false },
  workoutTimer: { intervalId: null },
};

// ─── Milestones ─────────────────────────────────────────────────────────────
const MILESTONES = [
  { id: 'workouts-1', category: 'workouts', label: 'First Workout', threshold: 1 },
  { id: 'workouts-10', category: 'workouts', label: '10 Workouts', threshold: 10 },
  { id: 'workouts-25', category: 'workouts', label: '25 Workouts', threshold: 25 },
  { id: 'workouts-50', category: 'workouts', label: '50 Workouts', threshold: 50 },
  { id: 'workouts-100', category: 'workouts', label: '100 Workouts', threshold: 100 },
  { id: 'workouts-200', category: 'workouts', label: '200 Workouts', threshold: 200 },
  { id: 'workouts-500', category: 'workouts', label: '500 Workouts', threshold: 500 },
  { id: 'volume-10k', category: 'volume', label: '10,000kg Lifted', threshold: 10000 },
  { id: 'volume-50k', category: 'volume', label: '50,000kg Lifted', threshold: 50000 },
  { id: 'volume-100k', category: 'volume', label: '100,000kg Lifted', threshold: 100000 },
  { id: 'volume-250k', category: 'volume', label: '250,000kg Lifted', threshold: 250000 },
  { id: 'volume-500k', category: 'volume', label: '500,000kg Lifted', threshold: 500000 },
  { id: 'volume-1m', category: 'volume', label: '1,000,000kg Lifted', threshold: 1000000 },
  { id: 'streak-4', category: 'streak', label: '4-Week Streak', threshold: 4 },
  { id: 'streak-8', category: 'streak', label: '8-Week Streak', threshold: 8 },
  { id: 'streak-12', category: 'streak', label: '12-Week Streak', threshold: 12 },
  { id: 'sets-100', category: 'sets', label: '100 Sets', threshold: 100 },
  { id: 'sets-500', category: 'sets', label: '500 Sets', threshold: 500 },
  { id: 'sets-1000', category: 'sets', label: '1,000 Sets', threshold: 1000 },
  { id: 'sets-2500', category: 'sets', label: '2,500 Sets', threshold: 2500 },
  { id: 'sets-5000', category: 'sets', label: '5,000 Sets', threshold: 5000 },
];

// ─── API helpers ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) throw new Error(`API ${method} ${path}: ${res.status}`);
  return res.json();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  state.progress = await api('GET', '/progress');
  await getWeekData(state.progress.week);
  const active = await api('GET', '/workouts/active');
  if (active) {
    state.currentSession = active;
    await getWeekData(active.week_number);
    const sets = await api('GET', `/sets/session/${active.id}`);
    sets.forEach(s => {
      const key = s.exercise_id;
      if (!state.sessionSets[key]) state.sessionSets[key] = [];
      state.sessionSets[key].push(s);
    });
    startWorkoutTimer();
  }
  navigate(location.hash || '#home');
}

// ─── Router ──────────────────────────────────────────────────────────────────
let isTransitioning = false;

function navigate(hash) {
  if (!hash || hash === '#') hash = '#home';
  location.hash = hash;
  const parts = hash.replace('#', '').split('/');
  const view = parts[0];
  let renderFn;
  switch (view) {
    case 'home': renderFn = () => renderDashboard(); break;
    case 'workouts': renderFn = () => renderWorkouts(); break;
    case 'workout': renderFn = () => renderWorkout(parts[1]); break;
    case 'exercise': renderFn = () => renderExercise(parseInt(parts[1])); break;
    case 'stats': renderFn = () => renderStats(); break;
    case 'exercise-stats': renderFn = () => renderExerciseStats(decodeURIComponent(parts[1])); break;
    default: renderFn = () => renderDashboard();
  }
  transitionTo(renderFn).catch(err => {
    console.error('View render error:', err);
    const app = document.getElementById('app');
    app.classList.remove('view-exit');
    app.innerHTML = `
      <div class="px-3 pt-8">
        <h1 class="text-xl font-black uppercase mb-2">Something went wrong</h1>
        <p class="text-sm text-ink/60 mb-4">${err.message}</p>
        <button onclick="location.reload()" class="px-4 py-2 bg-ink text-canvas font-bold uppercase text-sm">Reload</button>
      </div>`;
  });
}

async function transitionTo(renderFn) {
  const app = document.getElementById('app');
  if (isTransitioning) {
    await renderFn();
    app.classList.remove('view-exit');
    return;
  }
  isTransitioning = true;
  app.classList.add('view-exit');
  const fadeOut = new Promise(resolve => {
    const done = () => { app.removeEventListener('transitionend', done); resolve(); };
    app.addEventListener('transitionend', done);
    setTimeout(resolve, 150);
  });
  await Promise.all([fadeOut, renderFn()]);
  app.offsetHeight; // force reflow
  app.classList.remove('view-exit');
  isTransitioning = false;
}

window.addEventListener('hashchange', () => navigate(location.hash));

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getWeekData(weekNum) {
  const w = weekNum || state.progress.week;
  if (!state.weekCache[w]) {
    state.weekCache[w] = await api('GET', `/program/week/${w}`);
  }
  return state.weekCache[w];
}

function isDeloadWeek(weekNum) {
  return weekNum === 1 || weekNum === 6;
}

function parseRestSeconds(restStr) {
  const match = restStr.match(/(\d+)(?:\s*-\s*(\d+))?\s*min/);
  if (!match) return 120;
  const minutes = match[2] ? parseInt(match[2]) : parseInt(match[1]);
  return minutes * 60;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getExerciseName(exercise) {
  return state.activeSubstitutions[exercise.id] || exercise.name;
}

function getSetRpe(exercise, setNum, totalSets) {
  const isLast = setNum === totalSets;
  return isLast ? exercise.lastSetRpe : exercise.earlySetRpe;
}

function getLoggedSets(exerciseId) {
  return state.sessionSets[exerciseId] || [];
}

function formatVolume(kg) {
  if (kg >= 1000) return Math.round(kg / 1000) + 'k';
  return kg.toString();
}

function parseRepRange(repsStr) {
  if (!repsStr) return null;
  const match = repsStr.match(/(\d+)\s*-\s*(\d+)/);
  if (match) return { min: parseInt(match[1]), max: parseInt(match[2]) };
  const single = parseInt(repsStr);
  if (!isNaN(single)) return { min: single, max: single };
  return null;
}

function getWeightIncrement(weight) {
  if (weight <= 10) return 0.5;
  if (weight <= 25) return 1;
  return 2.5;
}

function suggestOverloadWeight(lastWeight) {
  const increment = getWeightIncrement(lastWeight);
  return Math.round((lastWeight + increment) * 10) / 10;
}

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// SQLite datetime('now') returns UTC without Z suffix — JS would parse as local time
function parseUtc(dateStr) {
  if (!dateStr) return new Date(NaN);
  if (!dateStr.endsWith('Z') && !dateStr.includes('+') && !dateStr.includes('T')) {
    return new Date(dateStr.replace(' ', 'T') + 'Z');
  }
  return new Date(dateStr);
}

// ─── Rest Timer ──────────────────────────────────────────────────────────────
function startRestTimer(restStr) {
  const total = parseRestSeconds(restStr);
  clearInterval(state.restTimer.intervalId);
  state.restTimer = {
    active: true,
    seconds: total,
    total: total,
    done: false,
    intervalId: setInterval(() => {
      state.restTimer.seconds--;
      updateTimerDisplay();
      if (state.restTimer.seconds <= 0) {
        clearInterval(state.restTimer.intervalId);
        state.restTimer.active = false;
        state.restTimer.done = true;
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        updateTimerDisplay();
      }
    }, 1000),
  };
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const el = document.getElementById('rest-timer');
  const display = document.getElementById('timer-display');
  const progress = document.getElementById('timer-progress');
  if (!el) return;

  if (!state.restTimer.active && !state.restTimer.done) {
    el.classList.add('hidden');
    return;
  }

  el.classList.remove('hidden');

  const bar = document.getElementById('timer-bar');
  const label = document.getElementById('timer-label');
  const dismiss = document.getElementById('timer-dismiss');

  if (state.restTimer.done) {
    display.textContent = 'DONE';
    display.className = 'text-2xl font-black tabular-nums text-ink';
    progress.style.width = '100%';
    progress.classList.add('timer-done');
    bar.className = 'bg-acid text-ink px-4 py-3 flex items-center justify-between';
    label.className = 'text-xs font-bold uppercase tracking-widest text-ink/60';
    if (dismiss) dismiss.className = 'text-xs font-bold uppercase tracking-widest text-ink/40 hover:text-ink transition-colors duration-200';
  } else {
    display.textContent = formatTime(state.restTimer.seconds);
    display.className = 'text-2xl font-black tabular-nums text-acid';
    const pct = (state.restTimer.seconds / state.restTimer.total) * 100;
    progress.style.width = `${pct}%`;
    progress.classList.remove('timer-done');
    bar.className = 'bg-ink text-canvas px-4 py-3 flex items-center justify-between';
    label.className = 'text-xs font-bold uppercase tracking-widest text-white/60';
    if (dismiss) dismiss.className = 'text-xs font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors duration-200';
  }
}

function dismissTimer() {
  clearInterval(state.restTimer.intervalId);
  state.restTimer = { active: false, seconds: 0, total: 0, intervalId: null, done: false };
  const el = document.getElementById('rest-timer');
  if (el) el.classList.add('hidden');
  const bar = document.getElementById('timer-bar');
  if (bar) bar.className = 'bg-ink text-canvas px-4 py-3 flex items-center justify-between';
  const progress = document.getElementById('timer-progress');
  if (progress) progress.classList.remove('timer-done');
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'timer-dismiss') dismissTimer();
});

// ─── Workout Timer ──────────────────────────────────────────────────────────
function getElapsedText() {
  if (!state.currentSession?.started_at) return '';
  if (state.currentSession.completed_at || state.currentSession.skipped_at) return '';
  const elapsed = Math.floor((Date.now() - parseUtc(state.currentSession.started_at).getTime()) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function startWorkoutTimer() {
  stopWorkoutTimer();
  if (!state.currentSession || !state.currentSession.started_at) return;
  state.workoutTimer.intervalId = setInterval(updateWorkoutTimer, 1000);
  updateWorkoutTimer();
}

function stopWorkoutTimer() {
  if (state.workoutTimer.intervalId) {
    clearInterval(state.workoutTimer.intervalId);
    state.workoutTimer.intervalId = null;
  }
}

function updateWorkoutTimer() {
  const text = getElapsedText();
  document.querySelectorAll('.workout-elapsed').forEach(el => {
    el.textContent = text;
  });
}

function findFirstIncompleteExercise(workout) {
  for (let i = 0; i < workout.exercises.length; i++) {
    const logged = getLoggedSets(workout.exercises[i].id);
    const total = parseInt(workout.exercises[i].workingSets) || 0;
    if (logged.length < total) return i;
  }
  return 0;
}

function navigateToCurrentExercise() {
  if (!state.currentSession) return;
  startWorkoutFlow(state.currentSession.workout_template_id, true);
}

// ─── View: Dashboard ────────────────────────────────────────────────────────
async function renderDashboard() {
  const week = await getWeekData();
  const [weekSummary, streakData, statusData, weightData] = await Promise.all([
    api('GET', `/stats/week-summary?cycle=${state.progress.cycle}&week=${state.progress.week}`),
    api('GET', '/stats/streak'),
    api('GET', `/workouts/status?cycle=${state.progress.cycle}&week=${state.progress.week}`),
    api('GET', '/weight/summary'),
  ]);

  const deload = isDeloadWeek(state.progress.week);
  const hasActiveSession = state.currentSession && !state.currentSession.completed_at && !state.currentSession.skipped_at;

  // Find next incomplete & non-skipped workout
  let nextWorkout = null;
  if (week && week.workouts) {
    nextWorkout = week.workouts.find(wo =>
      !statusData.completed.includes(wo.templateId) &&
      !statusData.skipped.includes(wo.templateId)
    );
  }

  const doneCount = statusData.completed.length;
  const skippedCount = statusData.skipped.length;
  const allAccountedFor = (doneCount + skippedCount) >= 5;

  // Next Up card content
  let nextUpHtml = '';
  if (hasActiveSession) {
    nextUpHtml = `
      <div class="bg-ink text-canvas p-5 mb-5 cursor-pointer active:bg-ink/80 transition-colors duration-200" onclick="startWorkoutFlow('${state.currentSession.workout_template_id}')">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-white/40">In Progress</h3>
          <span class="workout-elapsed text-sm font-bold tabular-nums text-acid">${getElapsedText()}</span>
        </div>
        <h2 class="text-xl font-black uppercase tracking-tight leading-tight">${state.currentSession.workout_name.split('(')[0].trim()}</h2>
        <p class="text-sm text-white/50 font-bold uppercase tracking-widest mt-1">Cycle ${state.progress.cycle} &middot; Week ${state.progress.week}${deload ? ' &middot; Deload' : ''}</p>
        <button onclick="event.stopPropagation(); resumeWorkout()" class="w-full mt-4 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid">
          Resume Workout
        </button>
      </div>
    `;
  } else if (nextWorkout) {
    nextUpHtml = `
      <div class="bg-ink text-canvas p-5 mb-5 cursor-pointer active:bg-ink/80 transition-colors duration-200" onclick="startWorkoutFlow('${nextWorkout.templateId}')">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Next Up</h3>
        <h2 class="text-xl font-black uppercase tracking-tight leading-tight">${nextWorkout.name.split('(')[0].trim()}</h2>
        <p class="text-sm text-white/50 font-bold uppercase tracking-widest mt-1">${nextWorkout.focus} &middot; Cycle ${state.progress.cycle} &middot; Week ${state.progress.week}${deload ? ' &middot; Deload' : ''}</p>
        <button onclick="event.stopPropagation(); startWorkoutFlow('${nextWorkout.templateId}', true)" class="w-full mt-4 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid">
          Start Workout
        </button>
      </div>
    `;
  } else if (allAccountedFor) {
    nextUpHtml = `
      <div class="bg-ink text-canvas p-5 mb-5">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-acid mb-2">Week Complete</h3>
        <p class="text-sm text-white/50 font-bold uppercase tracking-widest">All workouts done or skipped this week</p>
      </div>
    `;
  }

  // Week progress dots
  const progressDots = week && week.workouts ? week.workouts.map(wo => {
    const isDone = statusData.completed.includes(wo.templateId);
    const isSkipped = statusData.skipped.includes(wo.templateId);
    const isActive = hasActiveSession && state.currentSession.workout_template_id === wo.templateId;
    if (isDone) return '<div class="w-3 h-3 rounded-full bg-acid"></div>';
    if (isSkipped) return '<div class="w-3 h-3 rounded-full bg-ink/20 relative"><div class="absolute inset-0 flex items-center justify-center"><div class="w-2 h-[2px] bg-ink/40"></div></div></div>';
    if (isActive) return '<div class="w-3 h-3 rounded-full bg-electric"></div>';
    return '<div class="w-3 h-3 rounded-full border-2 border-ink/15"></div>';
  }).join('') : '';

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-8 pb-32">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-3xl font-black uppercase tracking-tight leading-none">Adaptus</h1>
          <p class="text-sm font-bold text-ink/40 uppercase tracking-widest mt-1">Cycle ${state.progress.cycle} &middot; Week ${state.progress.week}</p>
        </div>
        ${deload ? '<span class="text-[10px] font-bold uppercase tracking-widest text-acid bg-ink px-2 py-1 rounded-full">Deload</span>' : ''}
      </div>

      ${nextUpHtml}

      <div class="grid grid-cols-2 gap-2.5 mb-5">
        <button onclick="navigate('#workouts')" class="bg-ink text-canvas p-5 text-left transition-colors duration-200 active:bg-ink/80">
          <h3 class="text-lg font-black uppercase tracking-tight">Workouts</h3>
          <p class="text-xs text-white/40 font-bold uppercase tracking-widest mt-1">${doneCount}/${weekSummary.totalWorkouts} done</p>
        </button>
        <button onclick="navigate('#stats')" class="bg-ink text-canvas p-5 text-left transition-colors duration-200 active:bg-ink/80">
          <h3 class="text-lg font-black uppercase tracking-tight">Stats</h3>
          <p class="text-xs text-white/40 font-bold uppercase tracking-widest mt-1">PRs &amp; records</p>
        </button>
      </div>

      <div class="border-2 border-ink/10 p-5 mb-5">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-4">This Week</h3>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <span class="text-3xl font-black leading-none block">${doneCount}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">/ ${weekSummary.totalWorkouts} done</span>
          </div>
          <div>
            <span class="text-3xl font-black leading-none block">${weekSummary.totalSets}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">sets</span>
          </div>
          <div>
            <span class="text-3xl font-black leading-none block">${formatVolume(weekSummary.totalVolume)}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">volume</span>
          </div>
          <div>
            <span class="text-3xl font-black leading-none block">${weekSummary.totalDuration ? formatDuration(weekSummary.totalDuration) : '—'}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">duration</span>
          </div>
        </div>
        ${progressDots ? `
          <div class="flex items-center gap-2 mb-4">
            ${progressDots}
          </div>
        ` : ''}
        ${weekSummary.prsThisWeek && weekSummary.prsThisWeek.length > 0 ? `
          <div class="border-t-2 border-ink/10 pt-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xs font-bold text-canvas bg-electric px-2 py-0.5">PR</span>
              <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">${weekSummary.prsThisWeek.length} this week</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${weekSummary.prsThisWeek.map(pr => `
                <span class="text-xs font-bold bg-acid/20 text-ink px-2 py-1">${pr.exercise_name} ${pr.weight_kg}kg</span>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="border-2 ${streakData.streak > 0 ? 'border-acid bg-acid/5' : 'border-ink/10'} p-5">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-1">Streak</h3>
            <span class="text-4xl font-black leading-none">${streakData.streak}</span>
            <span class="text-sm font-bold text-ink/40 ml-1">week${streakData.streak !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <p class="text-xs text-ink/40 mt-2">Consecutive weeks with all 5 workouts completed</p>
      </div>

      <div class="border-2 border-ink/10 p-5 mt-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Body Weight</h3>
          <button onclick="showWeightLogModal()" class="text-xs font-bold uppercase tracking-widest text-ink/40 active:text-ink transition-colors duration-200">+ Log</button>
        </div>
        ${weightData.current ? `
          <div class="flex items-center gap-4">
            <div>
              <span class="text-3xl font-black leading-none">${weightData.current}</span>
              <span class="text-sm font-bold text-ink/40 ml-0.5">kg</span>
            </div>
            ${weightData.avg7day ? `
              <div class="border-l-2 border-ink/10 pl-4">
                <span class="text-lg font-black leading-none">${weightData.avg7day}</span>
                <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block">7d avg</span>
              </div>
            ` : ''}
            ${weightData.trend ? `
              <span class="text-lg font-black ${weightData.trend === 'up' ? 'text-green-600' : weightData.trend === 'down' ? 'text-red-500' : 'text-ink/30'}">${weightData.trend === 'up' ? '&#9650;' : weightData.trend === 'down' ? '&#9660;' : '='}</span>
            ` : ''}
          </div>
        ` : `
          <p class="text-sm text-ink/30">No entries yet</p>
        `}
      </div>
    </div>
  `;
}

function showWeightLogModal() {
  const modal = document.createElement('div');
  modal.id = 'weight-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-ink/50" onclick="closeWeightModal()"></div>
    <div class="relative bg-canvas mx-4 p-5 max-w-sm w-full">
      <h2 class="text-lg font-black uppercase tracking-tight mb-4">Log Weight</h2>
      <div class="mb-4">
        <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Weight (kg)</label>
        <input id="weight-log-input" type="number" inputmode="decimal" step="0.1"
          class="w-full h-12 border-2 border-ink/15 text-center font-bold text-xl focus:border-ink focus:outline-none transition-colors duration-200">
      </div>
      <div class="flex gap-2">
        <button onclick="closeWeightModal()" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">Cancel</button>
        <button onclick="confirmWeightLog()" class="flex-1 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-acid">Log</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => document.getElementById('weight-log-input')?.focus());
}

function closeWeightModal() {
  document.getElementById('weight-modal')?.remove();
}

async function confirmWeightLog() {
  const weight = parseFloat(document.getElementById('weight-log-input')?.value);
  if (!weight || weight <= 0) return;
  closeWeightModal();
  await api('POST', '/weight', { weightKg: weight });
  renderDashboard();
}

// ─── Milestones ────────────────────────────────────────────────────────────
function getShownMilestones() {
  return JSON.parse(localStorage.getItem('milestones-shown') || '[]');
}

function markMilestoneShown(id) {
  const shown = getShownMilestones();
  if (!shown.includes(id)) {
    shown.push(id);
    localStorage.setItem('milestones-shown', JSON.stringify(shown));
  }
}

function computeEarnedMilestones(stats, streak) {
  const earned = [];
  for (const m of MILESTONES) {
    let value = 0;
    switch (m.category) {
      case 'workouts': value = stats.totalWorkouts; break;
      case 'volume': value = stats.totalVolume; break;
      case 'streak': value = streak; break;
      case 'sets': value = stats.totalSets; break;
    }
    if (value >= m.threshold) earned.push(m);
  }
  return earned;
}

async function checkAndCelebrateMilestones() {
  const [summary, streakData] = await Promise.all([
    api('GET', '/stats/summary'),
    api('GET', '/stats/streak'),
  ]);
  const earned = computeEarnedMilestones(summary, streakData.streak);
  const shown = getShownMilestones();
  const newMilestones = earned.filter(m => !shown.includes(m.id));
  for (let i = 0; i < newMilestones.length; i++) {
    setTimeout(() => {
      showMilestoneCelebration(newMilestones[i]);
      markMilestoneShown(newMilestones[i].id);
    }, i * 3000);
  }
}

function showMilestoneCelebration(milestone) {
  const el = document.getElementById('milestone-celebration');
  if (el) el.remove();
  const celebration = document.createElement('div');
  celebration.id = 'milestone-celebration';
  celebration.className = 'fixed inset-0 z-[90] flex items-center justify-center pointer-events-none';
  celebration.innerHTML = `
    <div class="bg-ink text-canvas px-8 py-6 text-center animate-pr-pop pointer-events-auto" onclick="this.parentElement.remove()">
      <div class="text-[10px] font-bold uppercase tracking-widest text-acid mb-3">Milestone Unlocked</div>
      <div class="text-2xl font-black uppercase tracking-tight">${milestone.label}</div>
    </div>
  `;
  document.body.appendChild(celebration);
  setTimeout(() => {
    const existing = document.getElementById('milestone-celebration');
    if (existing) existing.remove();
  }, 2500);
}

// ─── View: Stats ────────────────────────────────────────────────────────────
async function renderStats() {
  const [summary, weightHistory, streakData] = await Promise.all([
    api('GET', '/stats/summary'),
    api('GET', '/weight/history?limit=60'),
    api('GET', '/stats/streak'),
  ]);

  const earned = computeEarnedMilestones(summary, streakData.streak);
  earned.forEach(m => markMilestoneShown(m.id));
  const earnedIds = new Set(earned.map(m => m.id));

  const achievementsHtml = MILESTONES.map(m => {
    const isEarned = earnedIds.has(m.id);
    return `
      <div class="p-3 border-2 ${isEarned ? 'border-acid bg-acid/5' : 'border-ink/10 opacity-30'} text-center">
        <div class="text-xs font-bold uppercase tracking-tight leading-tight">${m.label}</div>
      </div>
    `;
  }).join('');

  const prsHtml = summary.prs.length > 0 ? summary.prs.map(pr => `
    <button onclick="navigate('#exercise-stats/${encodeURIComponent(pr.exercise_name)}')" class="flex items-center justify-between py-3 border-b border-ink/10 last:border-0 w-full text-left active:bg-ink/5 transition-colors duration-200">
      <span class="font-bold text-[15px] truncate flex-1 mr-3">${pr.exercise_name}</span>
      <span class="flex-shrink-0 text-right">
        <span class="font-black text-lg">${pr.max_weight}<span class="text-sm font-bold text-ink/40 ml-0.5">kg</span></span>
        ${pr.estimated_1rm ? `<span class="text-xs font-bold text-electric ml-2">${pr.estimated_1rm} e1rm</span>` : ''}
      </span>
    </button>
  `).join('') : '<p class="text-sm text-ink/30 py-4">No data yet. Log some sets!</p>';

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-32">
      <button onclick="navigate('#home')" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Dashboard
      </button>

      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-6">Stats</h1>

      <div class="border-2 border-ink/10 p-5 mb-5">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-4">All Time</h3>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <span class="text-3xl font-black leading-none block">${summary.totalWorkouts}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">workouts</span>
          </div>
          <div>
            <span class="text-3xl font-black leading-none block">${summary.totalSets}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">sets</span>
          </div>
          <div>
            <span class="text-3xl font-black leading-none block">${formatVolume(summary.totalVolume)}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">volume (kg)</span>
          </div>
          <div>
            <span class="text-3xl font-black leading-none block">${summary.avgDuration ? formatDuration(summary.avgDuration) : '—'}</span>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">avg duration</span>
          </div>
        </div>
      </div>

      ${weightHistory.length >= 2 ? `
        <div class="border-2 border-ink/10 p-5 mb-5">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-3">Body Weight</h3>
          <canvas id="weight-chart" class="w-full" height="160"></canvas>
        </div>
      ` : ''}

      <div class="border-2 border-ink/10 p-5 mb-5">
        <div class="flex items-center gap-2 mb-4">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Milestones</h3>
          <span class="text-xs font-bold text-canvas bg-acid text-ink px-2 py-0.5">${earned.length}/${MILESTONES.length}</span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          ${achievementsHtml}
        </div>
      </div>

      <div class="border-2 border-ink/10 p-5">
        <div class="flex items-center gap-2 mb-4">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Personal Records</h3>
          <span class="text-xs font-bold text-canvas bg-electric px-2 py-0.5">${summary.prs.length}</span>
        </div>
        <div>
          ${prsHtml}
        </div>
      </div>
    </div>
  `;
  if (weightHistory.length >= 2) {
    requestAnimationFrame(() => drawWeightChart(weightHistory));
  }
}

// ─── View: Workouts ─────────────────────────────────────────────────────────
async function renderWorkouts() {
  const week = await getWeekData();
  if (!week) return;
  const deload = isDeloadWeek(state.progress.week);
  const statusData = await api('GET', `/workouts/status?cycle=${state.progress.cycle}&week=${state.progress.week}`);
  const activeTemplateId = state.currentSession && !state.currentSession.completed_at && !state.currentSession.skipped_at ? state.currentSession.workout_template_id : null;
  const workoutCards = week.workouts.map(wo => {
    const focus = wo.focus;
    const name = wo.name.split('(')[0].trim();
    const completed = statusData.completed.includes(wo.templateId);
    const skipped = statusData.skipped.includes(wo.templateId);
    const isActive = wo.templateId === activeTemplateId;
    let badge = `<span class="text-sm text-white/40">${wo.exercises.length} exercises</span>`;
    let bgClass = 'bg-ink';
    if (completed) {
      badge = '<span class="text-xs font-bold text-ink bg-acid px-2 py-0.5">Done</span>';
      bgClass = 'bg-ink/80';
    } else if (skipped) {
      badge = '<span class="text-xs font-bold text-ink/60 bg-ink/20 px-2 py-0.5">Skipped</span>';
      bgClass = 'bg-ink/40';
    } else if (isActive) {
      badge = `<span class="text-xs font-bold text-canvas bg-ink px-2 py-0.5 flex items-center gap-1.5">In Progress <span class="workout-elapsed tabular-nums text-acid">${getElapsedText()}</span></span>`;
    }
    return `
      <button onclick="startWorkoutFlow('${wo.templateId}')" class="w-full ${bgClass} text-canvas px-4 py-3 text-left transition-colors duration-200 active:bg-ink/80">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-black uppercase tracking-tight">${name}</h3>
            <p class="text-sm text-white/50 font-bold uppercase tracking-widest">${focus}</p>
          </div>
          <div class="text-right flex items-center gap-2">
            ${badge}
          </div>
        </div>
      </button>
    `;
  }).join('');

  const weekDots = Array.from({ length: 12 }, (_, i) => {
    const w = i + 1;
    const active = w === state.progress.week;
    const deloadW = isDeloadWeek(w);
    return `<div class="flex flex-col items-center gap-1">
      <div class="w-2 h-2 rounded-full ${active ? 'bg-acid scale-125' : 'bg-ink/15'} transition-all duration-300"></div>
      ${deloadW ? '<span class="text-[8px] font-bold uppercase tracking-widest text-ink/30">D</span>' : ''}
    </div>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-2">
      <button onclick="navigate('#home')" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-3 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Dashboard
      </button>

      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-2xl font-black uppercase tracking-tight leading-none">Workouts</h1>
          <p class="text-sm font-bold text-ink/40 uppercase tracking-widest mt-1">Cycle ${state.progress.cycle}</p>
        </div>
        <div class="flex items-center gap-2.5">
          ${deload ? '<span class="text-[10px] font-bold uppercase tracking-widest text-acid bg-ink px-2 py-1 rounded-full">Deload</span>' : ''}
          <div class="text-right">
            <span class="text-4xl font-black leading-none">${state.progress.week}</span>
            <p class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Week</p>
          </div>
        </div>
      </div>

      ${state.currentSession && !state.currentSession.completed_at && !state.currentSession.skipped_at ? `
        <button onclick="resumeWorkout()" class="w-full mb-3 px-4 py-2.5 bg-acid text-ink font-bold uppercase tracking-tight text-center transition-colors duration-200 active:bg-ink active:text-acid">
          Resume: ${state.currentSession.workout_name}
        </button>
      ` : ''}

      <div class="flex flex-col gap-2">
        ${workoutCards}
      </div>

      <div class="mt-5 flex items-center gap-3">
        <button onclick="changeWeek(-1)" class="flex-shrink-0 px-4 py-2.5 border-2 border-ink/15 font-bold uppercase tracking-tight text-xs transition-colors duration-200 active:bg-ink active:text-canvas ${state.progress.week === 1 && state.progress.cycle === 1 ? 'opacity-30 pointer-events-none' : ''}">
          Prev
        </button>
        <div class="flex items-end gap-1.5 flex-1 justify-center">
          ${weekDots}
        </div>
        <button onclick="changeWeek(1)" class="flex-shrink-0 px-4 py-2.5 border-2 border-ink/15 font-bold uppercase tracking-tight text-xs transition-colors duration-200 active:bg-ink active:text-canvas">
          Next
        </button>
      </div>
    </div>
  `;
}

async function changeWeek(dir) {
  let newWeek = state.progress.week + dir;
  let newCycle = state.progress.cycle;

  if (newWeek > 12) {
    showCycleModal(newCycle, newCycle + 1);
    return;
  }
  if (newWeek < 1) {
    if (newCycle <= 1) return;
    showCycleModal(newCycle, newCycle - 1);
    return;
  }

  state.progress = await api('PUT', '/progress', { cycle: newCycle, week: newWeek });
  renderWorkouts();
}

function showCycleModal(fromCycle, toCycle) {
  const goingForward = toCycle > fromCycle;
  const newWeek = goingForward ? 1 : 12;
  const title = goingForward ? 'Complete Cycle' : 'Go Back';
  const message = goingForward
    ? `You've reached the end of Cycle ${fromCycle}. Start Cycle ${toCycle} from Week 1?`
    : `Go back to Cycle ${toCycle}, Week 12?`;
  const confirmLabel = goingForward ? `Start Cycle ${toCycle}` : `Back to Cycle ${toCycle}`;

  const modal = document.createElement('div');
  modal.id = 'cycle-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-ink/50" onclick="closeCycleModal()"></div>
    <div class="relative bg-canvas mx-4 p-5 max-w-sm w-full">
      <h2 class="text-lg font-black uppercase tracking-tight mb-2">${title}</h2>
      <p class="text-sm text-ink/60 mb-5">${message}</p>
      <div class="flex gap-2">
        <button onclick="closeCycleModal()" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">
          Cancel
        </button>
        <button onclick="confirmCycleChange(${toCycle}, ${newWeek})" class="flex-1 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-acid">
          ${confirmLabel}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeCycleModal() {
  const modal = document.getElementById('cycle-modal');
  if (modal) modal.remove();
}

async function confirmCycleChange(newCycle, newWeek) {
  closeCycleModal();
  state.progress = await api('PUT', '/progress', { cycle: newCycle, week: newWeek });
  renderWorkouts();
}

async function startWorkoutFlow(templateId, directStart = false) {
  const week = await getWeekData();
  const workout = week.workouts.find(wo => wo.templateId === templateId);
  state.currentWorkoutData = workout;
  state.activeSubstitutions = {};
  state.lastPerformance = {};

  // Check if there's already a completed, skipped, or active session for this workout this week
  const statusData = await api('GET', `/workouts/status?cycle=${state.progress.cycle}&week=${state.progress.week}`);
  const isCompleted = statusData.completed.includes(templateId);
  const isSkipped = statusData.skipped.includes(templateId);

  if (isCompleted || isSkipped) {
    // Load existing session for viewing
    const recent = await api('GET', '/workouts/recent?limit=50');
    const existing = recent.find(s =>
      s.workout_template_id === templateId &&
      s.week_number === state.progress.week &&
      s.cycle === state.progress.cycle
    );
    if (existing) {
      state.currentSession = existing;
      state.sessionSets = {};
      const sets = await api('GET', `/sets/session/${existing.id}`);
      sets.forEach(s => {
        if (!state.sessionSets[s.exercise_id]) state.sessionSets[s.exercise_id] = [];
        state.sessionSets[s.exercise_id].push(s);
      });
    }
    navigate(`#workout/${templateId}`);
  } else if (state.currentSession && !state.currentSession.completed_at && !state.currentSession.skipped_at && state.currentSession.workout_template_id === templateId) {
    // Active session — load sets
    state.sessionSets = {};
    const sets = await api('GET', `/sets/session/${state.currentSession.id}`);
    sets.forEach(s => {
      if (!state.sessionSets[s.exercise_id]) state.sessionSets[s.exercise_id] = [];
      state.sessionSets[s.exercise_id].push(s);
    });
    startWorkoutTimer();
    if (directStart) {
      navigate(`#exercise/${findFirstIncompleteExercise(workout)}`);
    } else {
      navigate(`#workout/${templateId}`);
    }
  } else {
    // New workout
    state.sessionSets = {};
    if (directStart) {
      // Create session immediately and go to first exercise
      state.currentSession = await api('POST', '/workouts', {
        cycle: state.progress.cycle,
        weekNumber: state.progress.week,
        workoutTemplateId: workout.templateId,
        workoutName: workout.name,
      });
      startWorkoutTimer();
      navigate(`#exercise/0`);
    } else {
      // Show overview, session created later
      state.currentSession = null;
      navigate(`#workout/${templateId}`);
    }
  }
}

async function resumeWorkout() {
  const week = await getWeekData(state.currentSession.week_number);
  const workout = week.workouts.find(wo => wo.templateId === state.currentSession.workout_template_id);
  state.currentWorkoutData = workout;
  startWorkoutTimer();
  navigate(`#exercise/${findFirstIncompleteExercise(workout)}`);
}

// ─── View: Workout Overview ──────────────────────────────────────────────────
async function renderWorkout(templateId) {
  const week = await getWeekData();
  const workout = week.workouts.find(wo => wo.templateId === templateId);
  if (!workout) return navigate('#workouts');
  state.currentWorkoutData = workout;

  const exerciseRows = workout.exercises.map((ex, i) => {
    const logged = getLoggedSets(ex.id);
    const totalSets = parseInt(ex.workingSets) || 0;
    const done = logged.length >= totalSets;
    const partial = logged.length > 0 && !done;
    const name = getExerciseName(ex);
    const isSubbed = state.activeSubstitutions[ex.id];
    const technique = ex.lastSetIntensityTechnique !== 'N/A' ? ex.lastSetIntensityTechnique : '';

    return `
      <button onclick="navigate('#exercise/${i}')" class="w-full px-3 py-2.5 border-2 ${done ? 'border-ink/10' : partial ? 'border-ink/20' : 'border-ink/10'} text-left transition-colors duration-200 active:bg-ink/5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-black ${done ? 'text-ink/15' : 'text-ink/30'}">${i + 1}</span>
              <h3 class="font-bold text-[15px] leading-tight truncate ${done ? 'text-ink/35' : ''}">${name}</h3>
              ${isSubbed ? '<span class="text-[10px] font-bold uppercase tracking-widest text-electric">Swap</span>' : ''}
            </div>
            <p class="text-xs ${done ? 'text-ink/30' : 'text-ink/50'} mt-1">${ex.workingSets} sets &middot; ${ex.reps} reps${technique ? ` &middot; ${technique}` : ''}</p>
          </div>
          <div class="flex-shrink-0 mt-0.5">
            ${done ? '<span class="text-xs font-bold text-ink/25">&#10003;</span>'
              : partial ? `<span class="text-xs font-bold text-ink/50">${logged.length}/${totalSets}</span>`
              : '<span class="w-2 h-2 rounded-full bg-ink/15 inline-block"></span>'}
          </div>
        </div>
      </button>
    `;
  }).join('');

  const allDone = workout.exercises.every(ex => {
    const logged = getLoggedSets(ex.id);
    return logged.length >= (parseInt(ex.workingSets) || 0);
  });

  const isCompleted = state.currentSession && state.currentSession.completed_at;
  const isSkipped = state.currentSession && state.currentSession.skipped_at;
  const isActive = state.currentSession && !isCompleted && !isSkipped;
  const name = workout.name.split('(')[0].trim();
  const hasLoggedSets = Object.values(state.sessionSets).some(sets => sets.length > 0);

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-2">
      <div class="flex items-center justify-between mb-3">
        <button onclick="navigate('#workouts')" class="text-sm font-bold text-ink/40 uppercase tracking-widest flex items-center gap-1 active:text-ink transition-colors duration-200">
          <span class="text-lg leading-none">&larr;</span> Back
        </button>
        ${isActive ? `<span class="workout-elapsed text-sm font-bold tabular-nums text-electric min-w-[3.5rem] text-right">${getElapsedText()}</span>` : ''}
      </div>

      <div class="mb-4">
        <div class="flex items-center gap-2.5">
          <h1 class="text-2xl font-black uppercase tracking-tight leading-none">${name}</h1>
          ${isCompleted ? '<span class="text-[10px] font-bold uppercase tracking-widest text-acid bg-ink px-2 py-1 rounded-full">Completed</span>' : ''}
          ${isSkipped ? '<span class="text-[10px] font-bold uppercase tracking-widest text-ink/60 bg-ink/10 px-2 py-1 rounded-full">Skipped</span>' : ''}
        </div>
        <p class="text-sm font-bold text-ink/40 uppercase tracking-widest mt-1">${workout.focus} &middot; Week ${state.progress.week}${isCompleted && state.currentSession.started_at && state.currentSession.completed_at ? ` &middot; ${formatDuration((parseUtc(state.currentSession.completed_at) - parseUtc(state.currentSession.started_at)) / 60000)}` : ''}</p>
      </div>

      ${isSkipped ? `
        <div class="border-2 border-ink/10 bg-ink/5 p-5 mb-5 text-center">
          <p class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4">This workout was skipped</p>
          <button onclick="unskipWorkout()" class="px-6 py-2.5 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm transition-colors duration-200 active:bg-ink active:text-canvas">
            Undo Skip
          </button>
        </div>
      ` : `
        ${isActive ? `
          <button onclick="startWorkoutFlow('${workout.templateId}', true)" class="w-full mb-3 py-2.5 bg-ink text-canvas font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink/80">
            ${hasLoggedSets ? 'Continue Logging' : 'Start Logging'}
          </button>
        ` : ''}
        ${!isCompleted && !isActive ? `
          <button onclick="startWorkoutFlow('${workout.templateId}', true)" class="w-full mb-3 py-2.5 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid">
            Start Workout
          </button>
        ` : ''}

        <div class="flex flex-col gap-1.5">
          ${exerciseRows}
        </div>

        ${allDone && !isCompleted ? `
          <button onclick="completeWorkout()" class="w-full mt-6 px-6 py-4 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid">
            Complete Workout
          </button>
        ` : ''}

        ${!isCompleted && !hasLoggedSets && !state.currentSession ? `
          <button onclick="showSkipWorkoutModal('${workout.templateId}', '${workout.name.replace(/'/g, "\\'")}')" class="w-full mt-4 py-3 text-xs font-bold uppercase tracking-widest text-ink/30 text-center transition-colors duration-200 active:text-ink/60">
            Skip Workout
          </button>
        ` : ''}

        ${state.currentSession && !isCompleted ? `
          <button onclick="showCancelWorkoutModal()" class="w-full mt-4 py-3 text-xs font-bold uppercase tracking-widest text-red-400 text-center transition-colors duration-200 active:text-red-600">
            Cancel Workout
          </button>
        ` : ''}
      `}

      ${isCompleted ? `
        <button onclick="showDeleteWorkoutModal()" class="w-full mt-4 py-3 text-xs font-bold uppercase tracking-widest text-red-400 text-center transition-colors duration-200 active:text-red-600">
          Delete Workout
        </button>
      ` : ''}
    </div>
  `;
}

function showDeleteWorkoutModal() {
  const modal = document.createElement('div');
  modal.id = 'delete-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-ink/50" onclick="closeDeleteModal()"></div>
    <div class="relative bg-canvas mx-4 p-5 max-w-sm w-full">
      <h2 class="text-lg font-black uppercase tracking-tight mb-2">Delete Workout</h2>
      <p class="text-sm text-ink/60 mb-5">This will permanently delete this workout and all its logged sets.</p>
      <div class="flex gap-2">
        <button onclick="closeDeleteModal()" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">
          Keep
        </button>
        <button onclick="confirmDeleteWorkout()" class="flex-1 py-3 bg-red-500 text-canvas font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-red-700">
          Delete
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeDeleteModal() {
  const modal = document.getElementById('delete-modal');
  if (modal) modal.remove();
}

async function confirmDeleteWorkout() {
  closeDeleteModal();
  if (state.currentSession) {
    await api('DELETE', `/workouts/${state.currentSession.id}`);
  }
  stopWorkoutTimer();
  state.currentSession = null;
  state.sessionSets = {};
  navigate('#workouts');
}

function renderLastExerciseButton(index, workout) {
  if (index < workout.exercises.length - 1) {
    const allDone = getLoggedSets(workout.exercises[index].id).length >= (parseInt(workout.exercises[index].workingSets) || 0);
    return `<button onclick="navigate('#exercise/${index + 1}')" class="flex-1 py-3 ${allDone ? 'bg-acid text-ink' : 'border-2 border-ink/15'} font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">
      Next &rarr;
    </button>`;
  }
  const workoutAllDone = workout.exercises.every(ex => getLoggedSets(ex.id).length >= (parseInt(ex.workingSets) || 0));
  const isCompleted = state.currentSession && state.currentSession.completed_at;
  if (workoutAllDone && !isCompleted) {
    return `<button onclick="completeWorkout()" class="flex-1 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-acid">
      Complete Workout
    </button>`;
  }
  return `<button onclick="navigate('#workout/${workout.templateId}')" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">
    Back to Workout
  </button>`;
}

function showCancelWorkoutModal() {
  const modal = document.createElement('div');
  modal.id = 'cancel-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-ink/50" onclick="closeCancelModal()"></div>
    <div class="relative bg-canvas mx-4 p-5 max-w-sm w-full">
      <h2 class="text-lg font-black uppercase tracking-tight mb-2">Cancel Workout</h2>
      <p class="text-sm text-ink/60 mb-5">This will delete all logged sets for this workout. Are you sure?</p>
      <div class="flex gap-2">
        <button onclick="closeCancelModal()" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">
          Keep
        </button>
        <button onclick="confirmCancelWorkout()" class="flex-1 py-3 bg-red-500 text-canvas font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-red-700">
          Delete
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeCancelModal() {
  const modal = document.getElementById('cancel-modal');
  if (modal) modal.remove();
}

async function confirmCancelWorkout() {
  closeCancelModal();
  if (state.currentSession) {
    await api('DELETE', `/workouts/${state.currentSession.id}`);
  }
  dismissTimer();
  stopWorkoutTimer();
  // Clear all localStorage drafts for this workout
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('draft-')) keys.push(key);
  }
  keys.forEach(k => localStorage.removeItem(k));
  state.currentSession = null;
  state.sessionSets = {};
  state.currentWorkoutData = null;
  navigate('#workouts');
}

async function completeWorkout() {
  if (!state.currentSession) return;
  await api('PUT', `/workouts/${state.currentSession.id}/complete`);
  dismissTimer();
  stopWorkoutTimer();
  state.currentSession = null;
  state.currentWorkoutData = null;
  navigate('#workouts');
  setTimeout(() => checkAndCelebrateMilestones(), 500);
}

// ─── View: Exercise Logging ──────────────────────────────────────────────────
async function renderExercise(index) {
  const workout = state.currentWorkoutData;
  if (!workout) return navigate('#workouts');
  const exercise = workout.exercises[index];
  if (!exercise) return navigate(`#workout/${workout.templateId}`);
  state.currentExerciseIndex = index;

  const name = getExerciseName(exercise);
  const isSubbed = !!state.activeSubstitutions[exercise.id];
  const totalSets = parseInt(exercise.workingSets) || 0;
  const logged = getLoggedSets(exercise.id);
  const nextSet = logged.length + 1;
  const allDone = logged.length >= totalSets;
  const technique = exercise.lastSetIntensityTechnique;
  const showTechnique = technique && technique !== 'N/A';

  // Fetch last performance if not cached
  if (!state.lastPerformance[name]) {
    try {
      const perf = await api('GET', `/sets/last-performance/${encodeURIComponent(name)}`);
      state.lastPerformance[name] = perf;
    } catch { state.lastPerformance[name] = []; }
  }
  const lastPerf = state.lastPerformance[name] || [];

  // Pre-fill values: localStorage draft > last logged set > last performance (set-matched)
  const draftKey = `draft-${exercise.id}-${nextSet}`;
  const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
  let prefillWeight = '';
  let prefillReps = '';
  let isSuggested = false;
  if (draft) {
    prefillWeight = draft.weight;
    prefillReps = draft.reps;
  } else if (logged.length > 0) {
    const lastLogged = logged[logged.length - 1];
    prefillWeight = lastLogged.weight_kg;
    prefillReps = lastLogged.reps;
    isSuggested = true;
  } else if (lastPerf.length > 0) {
    prefillWeight = lastPerf[0].weight_kg;
    prefillReps = lastPerf[0].reps;
    // Progressive overload: if last session hit top of rep range, suggest increase
    const repRange = parseRepRange(exercise.reps);
    if (repRange && lastPerf[0].reps >= repRange.max) {
      prefillWeight = suggestOverloadWeight(lastPerf[0].weight_kg);
    }
    isSuggested = true;
  }

  const isLastSet = nextSet === totalSets;
  const isSingleSet = totalSets === 1;
  const currentRpe = (isSingleSet || isLastSet) ? exercise.lastSetRpe : exercise.earlySetRpe;

  // Logged sets display
  const loggedHtml = logged.map((s, i) => {
    const setIsLast = (i + 1) === totalSets;
    const rpe = (isSingleSet || setIsLast) ? exercise.lastSetRpe : exercise.earlySetRpe;
    return `
      <div class="flex items-center justify-between py-2 ${i < logged.length - 1 ? 'border-b border-ink/10' : ''}">
        <div class="flex items-center gap-3">
          <span class="text-acid text-lg font-black">&#10003;</span>
          <span class="font-bold">Set ${i + 1}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="font-bold">${s.weight_kg}kg &times; ${s.reps}</span>
          <span class="text-xs text-ink/40 font-bold">${rpe}</span>
          <button onclick="deleteSet(${s.id}, '${exercise.id}')" class="text-ink/20 hover:text-red-500 text-xs font-bold uppercase transition-colors duration-200">&times;</button>
        </div>
      </div>
    `;
  }).join('');

  // Last performance display
  const perfHtml = lastPerf.length > 0 ? lastPerf.map((s, i) => `
    <div class="flex items-center justify-between text-sm ${i < lastPerf.length - 1 ? 'border-b border-ink/5 pb-1 mb-1' : ''}">
      <span class="text-ink/40 font-bold">Set ${s.set_number}</span>
      <span class="font-bold text-ink/60">${s.weight_kg}kg &times; ${s.reps}</span>
    </div>
  `).join('') : '<p class="text-sm text-ink/30">No previous data</p>';

  const hasSubs = exercise.substitutionOptions && exercise.substitutionOptions.length > 0;

  const workoutName = workout.name.split('(')[0].trim();

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-40">
      <div class="flex items-center justify-between mb-4">
        <button onclick="navigate('#workout/${workout.templateId}')" class="text-sm font-bold text-ink/40 uppercase tracking-widest flex items-center gap-1 active:text-ink transition-colors duration-200">
          <span class="text-lg leading-none">&larr;</span> ${workoutName}
        </button>
        ${state.currentSession && !state.currentSession.completed_at ? `<span class="workout-elapsed text-sm font-bold tabular-nums text-electric min-w-[3.5rem] text-right">${getElapsedText()}</span>` : ''}
      </div>

      <!-- Exercise name -->
      <div class="mb-5">
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-xl font-black uppercase tracking-tight leading-tight">${name}</h1>
          <button onclick="navigate('#exercise-stats/${encodeURIComponent(name)}')" class="w-8 h-8 flex items-center justify-center border-2 border-ink/15 text-ink/40 text-sm transition-colors duration-200 active:bg-ink active:text-canvas" title="View history">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 5 7 8 9 11 4 14 6"/><line x1="2" y1="14" x2="14" y2="14"/></svg>
          </button>
          ${isSubbed ? '<span class="text-[10px] font-bold uppercase tracking-widest text-electric bg-electric/10 px-2 py-0.5">Swapped</span>' : ''}
        </div>
        <p class="text-xs font-bold text-ink/40 uppercase tracking-widest mt-1">Exercise ${index + 1} of ${workout.exercises.length}</p>
      </div>

      <!-- Info card -->
      <div class="border-2 border-ink/10 p-4 mb-4">
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block">Warmup</span>
            <span class="font-bold">${exercise.warmupSets} sets</span>
          </div>
          <div>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block">Working</span>
            <span class="font-bold">${exercise.workingSets} sets</span>
          </div>
          <div>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block">Reps</span>
            <span class="font-bold">${exercise.reps}</span>
          </div>
          <div>
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block">Rest</span>
            <span class="font-bold">${exercise.rest}</span>
          </div>
          ${showTechnique ? `<div class="col-span-2">
            <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block">Last Set Technique</span>
            <span class="font-bold text-electric">${technique}</span>
          </div>` : ''}
        </div>
      </div>

      <!-- Notes -->
      ${exercise.notes ? `
        <details class="mb-4 border-2 border-ink/10">
          <summary class="px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-ink/40 cursor-pointer select-none">Notes</summary>
          <div class="px-4 pb-3 text-sm text-ink/70 leading-relaxed">${exercise.notes}</div>
        </details>
      ` : ''}

      <!-- Previous performance -->
      <div class="mb-5 p-4 bg-ink/[0.03]">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-2">Previous</h3>
        ${perfHtml}
      </div>

      <!-- Set logging -->
      ${!allDone ? `
        <div class="border-2 border-acid p-4 mb-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-black uppercase tracking-tight">Set ${nextSet} of ${totalSets}</h3>
            <span class="text-xs font-bold uppercase tracking-widest ${isLastSet || isSingleSet ? 'text-electric' : 'text-ink/50'}">
              RPE ${currentRpe}${isLastSet && showTechnique ? ' &middot; ' + technique : ''}
            </span>
          </div>

          <div class="space-y-2.5 mb-3">
            <div>
              <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 flex items-center gap-1 mb-1">Weight (kg) <span id="overload-arrow">${getOverloadArrow(name, prefillWeight)}</span></label>
              <div class="flex items-center gap-1">
                <button onclick="adjustInput('weight-input', -2.5, '${draftKey}', '${name.replace(/'/g, "\\'")}')" class="w-11 h-11 border-2 border-ink/15 font-bold text-lg active:bg-ink active:text-canvas transition-colors duration-200">&minus;</button>
                <input id="weight-input" type="number" inputmode="decimal" step="0.5" value="${isSuggested ? '' : prefillWeight}" placeholder="${isSuggested ? prefillWeight : '0'}"
                  data-suggested="${isSuggested ? prefillWeight : ''}"
                  onfocus="clearSuggested(this)" onblur="restoreSuggested(this)"
                  oninput="handleInput(this, '${draftKey}', '${name.replace(/'/g, "\\'")}')"
                  class="flex-1 h-11 border-2 border-ink/15 text-center font-bold text-lg focus:border-ink focus:outline-none transition-colors duration-200 ${isSuggested ? 'placeholder:text-ink/30' : ''}">
                <button onclick="adjustInput('weight-input', 2.5, '${draftKey}', '${name.replace(/'/g, "\\'")}')" class="w-11 h-11 border-2 border-ink/15 font-bold text-lg active:bg-ink active:text-canvas transition-colors duration-200">+</button>
              </div>
            </div>
            <div>
              <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Reps</label>
              <div class="flex items-center gap-1">
                <button onclick="adjustInput('reps-input', -1, '${draftKey}')" class="w-11 h-11 border-2 border-ink/15 font-bold text-lg active:bg-ink active:text-canvas transition-colors duration-200">&minus;</button>
                <input id="reps-input" type="number" inputmode="numeric" step="1" value="${isSuggested ? '' : prefillReps}" placeholder="${isSuggested ? prefillReps : '0'}"
                  data-suggested="${isSuggested ? prefillReps : ''}"
                  onfocus="clearSuggested(this)" onblur="restoreSuggested(this)"
                  oninput="handleInput(this, '${draftKey}')"
                  class="flex-1 h-11 border-2 border-ink/15 text-center font-bold text-lg focus:border-ink focus:outline-none transition-colors duration-200 ${isSuggested ? 'placeholder:text-ink/30' : ''}">
                <button onclick="adjustInput('reps-input', 1, '${draftKey}')" class="w-11 h-11 border-2 border-ink/15 font-bold text-lg active:bg-ink active:text-canvas transition-colors duration-200">+</button>
              </div>
            </div>
          </div>

          <button onclick="logSet('${exercise.id}', '${name.replace(/'/g, "\\'")}', ${nextSet}, ${totalSets}, '${currentRpe}', '${exercise.rest}')"
            class="w-full py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center transition-colors duration-200 active:bg-ink active:text-acid">
            Log Set ${nextSet}
          </button>
        </div>
      ` : `
        <div class="border-2 border-acid bg-acid/10 p-4 mb-4 text-center">
          <span class="font-bold uppercase tracking-tight text-ink/60">All sets complete</span>
        </div>
      `}

      <!-- Logged sets -->
      ${logged.length > 0 ? `
        <div class="mb-5 px-1">
          ${loggedHtml}
        </div>
      ` : ''}

      <!-- Swap exercise -->
      ${hasSubs ? `
        <button onclick="showSubstitutionModal(${index})" class="w-full py-3 border-2 border-ink/15 text-sm font-bold uppercase tracking-widest text-ink/50 text-center transition-colors duration-200 active:bg-ink active:text-canvas mb-4">
          Swap Exercise
        </button>
      ` : ''}

      <!-- Navigation -->
      <div class="flex gap-2">
        ${index > 0 ? `
          <button onclick="navigate('#exercise/${index - 1}')" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">
            &larr; Prev
          </button>
        ` : '<div class="flex-1"></div>'}
        ${renderLastExerciseButton(index, workout)}
      </div>
    </div>
  `;
}

function clearSuggested(input) {
  // On focus: if showing suggested placeholder, field is already empty — just let user type
}

function restoreSuggested(input) {
  // On blur: if empty and has suggested value, keep it as placeholder
  if (input.value === '' && input.dataset.suggested) {
    input.placeholder = input.dataset.suggested;
  }
}

function handleInput(input, draftKey, exerciseName) {
  // User typed something — clear suggested state
  if (input.value !== '') {
    input.dataset.suggested = '';
  }
  saveDraft(draftKey);
  if (exerciseName) updateOverloadArrow(exerciseName);
}

function getInputValue(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return '';
  // If user typed nothing, use the suggested placeholder value
  return input.value || input.dataset.suggested || '';
}

function saveDraft(draftKey) {
  const w = getInputValue('weight-input');
  const r = getInputValue('reps-input');
  // Only save draft if user has actually typed values (not suggested placeholders)
  const wInput = document.getElementById('weight-input');
  const rInput = document.getElementById('reps-input');
  if ((wInput?.value || rInput?.value)) {
    localStorage.setItem(draftKey, JSON.stringify({ weight: w, reps: r }));
  }
}

function clearDraft(exerciseId, setNumber) {
  localStorage.removeItem(`draft-${exerciseId}-${setNumber}`);
}

function adjustInput(inputId, delta, draftKey, exerciseName) {
  const input = document.getElementById(inputId);
  if (!input) return;
  // If suggested and no value typed, start from suggested value
  const current = parseFloat(input.value || input.dataset.suggested) || 0;
  const newVal = Math.max(0, current + delta);
  input.value = inputId === 'reps-input' ? Math.round(newVal) : newVal;
  input.dataset.suggested = ''; // User has interacted, no longer suggested
  if (draftKey) saveDraft(draftKey);
  if (inputId === 'weight-input' && exerciseName) updateOverloadArrow(exerciseName);
}

function getOverloadArrow(exerciseName, currentWeight) {
  const lastPerf = state.lastPerformance[exerciseName];
  if (!lastPerf || lastPerf.length === 0 || !currentWeight) return '';
  const prevWeight = lastPerf[0].weight_kg;
  const current = parseFloat(currentWeight);
  if (isNaN(current) || current === 0) return '';
  if (current > prevWeight) return '<span class="text-green-600 font-black text-sm">&#9650;</span>';
  if (current < prevWeight) return '<span class="text-red-500 font-black text-sm">&#9660;</span>';
  return '<span class="text-ink/30 font-black text-sm">=</span>';
}

function updateOverloadArrow(exerciseName) {
  const el = document.getElementById('overload-arrow');
  if (!el) return;
  const weight = getInputValue('weight-input');
  el.innerHTML = getOverloadArrow(exerciseName, weight);
}

function showPrCelebration(exerciseName, weight) {
  const celebration = document.createElement('div');
  celebration.id = 'pr-celebration';
  celebration.className = 'fixed inset-0 z-[90] flex items-center justify-center pointer-events-none';
  celebration.innerHTML = `
    <div class="bg-ink text-canvas px-8 py-6 text-center animate-pr-pop pointer-events-auto" onclick="this.parentElement.remove()">
      <div class="text-4xl font-black text-acid mb-2">NEW PR</div>
      <div class="text-lg font-bold">${exerciseName}</div>
      <div class="text-3xl font-black text-acid mt-1">${weight}kg</div>
    </div>
  `;
  document.body.appendChild(celebration);
  setTimeout(() => {
    const el = document.getElementById('pr-celebration');
    if (el) el.remove();
  }, 2500);
}

async function logSet(exerciseId, exerciseName, setNumber, totalSets, targetRpe, restStr) {
  const weight = parseFloat(getInputValue('weight-input'));
  const reps = parseInt(getInputValue('reps-input'));
  if (!weight || weight <= 0 || !reps || reps <= 0) return;

  // Create session on first logged set
  if (!state.currentSession || state.currentSession.completed_at) {
    state.currentSession = await api('POST', '/workouts', {
      cycle: state.progress.cycle,
      weekNumber: state.progress.week,
      workoutTemplateId: state.currentWorkoutData.templateId,
      workoutName: state.currentWorkoutData.name,
    });
  }

  // Check current PR before logging the new set
  let previousPr = null;
  try {
    previousPr = await api('GET', `/sets/pr/${encodeURIComponent(exerciseName)}`);
  } catch { /* no previous data */ }

  const isLastSet = setNumber === totalSets;
  const subUsed = state.activeSubstitutions[exerciseId] || null;

  const set = await api('POST', '/sets', {
    workoutSessionId: state.currentSession.id,
    exerciseId,
    exerciseName,
    setNumber,
    weightKg: weight,
    reps,
    isLastSet,
    targetRpe,
    substitutionUsed: subUsed,
  });

  if (!state.sessionSets[exerciseId]) state.sessionSets[exerciseId] = [];
  state.sessionSets[exerciseId].push(set);

  // PR celebration (only when beating an existing PR, not on first-ever set)
  if (previousPr && weight > previousPr.weight_kg) {
    showPrCelebration(exerciseName, weight);
  }

  clearDraft(exerciseId, setNumber);
  startRestTimer(restStr);
  renderExercise(state.currentExerciseIndex);
}

async function deleteSet(setId, exerciseId) {
  await api('DELETE', `/sets/${setId}`);
  state.sessionSets[exerciseId] = (state.sessionSets[exerciseId] || []).filter(s => s.id !== setId);
  renderExercise(state.currentExerciseIndex);
}

// ─── Substitution Modal ──────────────────────────────────────────────────────
function showSubstitutionModal(exerciseIndex) {
  const workout = state.currentWorkoutData;
  const exercise = workout.exercises[exerciseIndex];
  const subs = exercise.substitutionOptions || [];
  const currentName = getExerciseName(exercise);

  const options = [
    { name: exercise.name, isOriginal: true },
    ...subs.map(s => ({ name: s, isOriginal: false })),
  ];

  const optionsHtml = options.map(opt => {
    const isActive = getExerciseName(exercise) === opt.name;
    return `
      <button onclick="selectSubstitution(${exerciseIndex}, ${opt.isOriginal ? 'null' : `'${opt.name.replace(/'/g, "\\'")}'`})"
        class="w-full p-4 text-left border-2 ${isActive ? 'border-acid bg-acid/5' : 'border-ink/10'} font-bold transition-colors duration-200 active:bg-ink/5">
        <div class="flex items-center justify-between">
          <span>${opt.name}</span>
          ${opt.isOriginal ? '<span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Original</span>' : ''}
          ${isActive ? '<span class="text-acid text-lg">&#10003;</span>' : ''}
        </div>
      </button>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'sub-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-end';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-ink/50" onclick="closeSubModal()"></div>
    <div class="relative w-full bg-canvas p-5 pb-8" style="padding-bottom: calc(2rem + env(safe-area-inset-bottom))">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-black uppercase tracking-tight">Swap Exercise</h2>
        <button onclick="closeSubModal()" class="text-ink/40 font-bold text-2xl leading-none">&times;</button>
      </div>
      <div class="flex flex-col gap-2">
        ${optionsHtml}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function selectSubstitution(exerciseIndex, subName) {
  const exercise = state.currentWorkoutData.exercises[exerciseIndex];
  if (subName) {
    state.activeSubstitutions[exercise.id] = subName;
  } else {
    delete state.activeSubstitutions[exercise.id];
  }
  // Clear cached last performance for this exercise so it re-fetches
  delete state.lastPerformance[getExerciseName(exercise)];
  closeSubModal();
  renderExercise(exerciseIndex);
}

function closeSubModal() {
  const modal = document.getElementById('sub-modal');
  if (modal) modal.remove();
}

// ─── Skip Workout ───────────────────────────────────────────────────────────
function showSkipWorkoutModal(templateId, workoutName) {
  const modal = document.createElement('div');
  modal.id = 'skip-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-ink/50" onclick="closeSkipModal()"></div>
    <div class="relative bg-canvas mx-4 p-5 max-w-sm w-full">
      <h2 class="text-lg font-black uppercase tracking-tight mb-2">Skip Workout</h2>
      <p class="text-sm text-ink/60 mb-5">Skip this workout? You can't log sets for a skipped workout.</p>
      <div class="flex gap-2">
        <button onclick="closeSkipModal()" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">
          Cancel
        </button>
        <button onclick="confirmSkipWorkout('${templateId}', '${workoutName.replace(/'/g, "\\'")}')" class="flex-1 py-3 bg-ink text-canvas font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink/80">
          Skip
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeSkipModal() {
  const modal = document.getElementById('skip-modal');
  if (modal) modal.remove();
}

async function confirmSkipWorkout(templateId, workoutName) {
  closeSkipModal();
  await api('PUT', '/workouts/skip', {
    cycle: state.progress.cycle,
    weekNumber: state.progress.week,
    workoutTemplateId: templateId,
    workoutName: workoutName,
  });
  navigate('#workouts');
}

async function unskipWorkout() {
  if (!state.currentSession) return;
  await api('PUT', `/workouts/${state.currentSession.id}/unskip`);
  state.currentSession = null;
  state.sessionSets = {};
  navigate('#workouts');
}

// ─── View: Exercise Stats ───────────────────────────────────────────────────
async function renderExerciseStats(exerciseName) {
  const [history, pr, e1rm] = await Promise.all([
    api('GET', `/sets/exercise-history/${encodeURIComponent(exerciseName)}`),
    api('GET', `/sets/pr/${encodeURIComponent(exerciseName)}`),
    api('GET', `/sets/e1rm/${encodeURIComponent(exerciseName)}`),
  ]);

  const prHtml = pr ? `
    <div class="border-2 border-acid bg-acid/5 p-4 mb-5">
      <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-1">Personal Record</h3>
      <span class="text-2xl font-black">${pr.weight_kg}<span class="text-sm font-bold text-ink/40 ml-0.5">kg</span></span>
      <span class="text-lg font-bold text-ink/40 mx-1">&times;</span>
      <span class="text-2xl font-black">${pr.reps}</span>
      <p class="text-xs text-ink/40 mt-1">${pr.logged_at ? parseUtc(pr.logged_at).toLocaleDateString() : ''}</p>
    </div>
  ` : '';

  const e1rmHtml = e1rm ? `
    <div class="border-2 border-electric bg-electric/5 p-4 mb-5">
      <h3 class="text-[10px] font-bold uppercase tracking-widest text-electric/60 mb-1">Estimated 1RM</h3>
      <span class="text-2xl font-black text-electric">${e1rm.estimated1rm}<span class="text-sm font-bold text-electric/40 ml-0.5">kg</span></span>
      <p class="text-xs text-ink/40 mt-1">From ${e1rm.fromWeight}kg &times; ${e1rm.fromReps} reps</p>
    </div>
  ` : '';

  const sessionsHtml = history.length > 0 ? [...history].reverse().map(s => {
    const date = parseUtc(s.date).toLocaleDateString();
    const setsStr = s.sets.map(set => `${set.weight_kg}kg&times;${set.reps}`).join('&ensp;&ensp;');
    return `
      <div class="py-3 border-b border-ink/10 last:border-0">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-bold uppercase tracking-widest text-ink/40">C${s.cycle} W${s.weekNumber}</span>
          <span class="text-xs text-ink/40">${date}</span>
        </div>
        <p class="text-sm font-bold">${setsStr}</p>
      </div>
    `;
  }).join('') : '<p class="text-sm text-ink/30 py-4">No history yet</p>';

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-32">
      <button onclick="history.back()" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>

      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-1">${exerciseName}</h1>
      <p class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-6">History</p>

      ${prHtml}
      ${e1rmHtml}

      ${history.length >= 2 ? `
        <div class="border-2 border-ink/10 p-4 mb-5">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-3">Progress Over Time</h3>
          <canvas id="progress-chart" class="w-full" height="200"></canvas>
          <div class="flex items-center justify-center gap-4 mt-3">
            <div class="flex items-center gap-1.5">
              <div class="w-3 h-1 bg-[#CCFF00]"></div>
              <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Max Weight</span>
            </div>
            <div class="flex items-center gap-1.5">
              <div class="w-3 h-1 bg-electric"></div>
              <span class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Est. 1RM</span>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="border-2 border-ink/10 p-4">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-2">All Sessions</h3>
        ${sessionsHtml}
      </div>
    </div>
  `;

  if (history.length >= 2) {
    requestAnimationFrame(() => drawProgressChart(history, pr));
  }
}

function drawProgressChart(history, pr) {
  const canvas = document.getElementById('progress-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Hi-DPI support
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const H = 200;
  canvas.width = rect.width * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;

  const weights = history.map(s => s.maxWeight);
  const e1rms = history.map(s => s.bestE1rm || 0);
  const allValues = [...weights, ...e1rms.filter(v => v > 0)];
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = maxV - minV || 1;

  const padTop = 20, padBottom = 30, padLeft = 40, padRight = 15;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Y axis
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const val = minV + (range * i / steps);
    const y = padTop + chartH - (chartH * i / steps);
    ctx.fillText(Math.round(val) + '', padLeft - 8, y + 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
  }

  // X positions
  const xPositions = history.map((s, i) => padLeft + (chartW * i / (history.length - 1)));

  // X axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  xPositions.forEach((x, i) => {
    if (history.length <= 12 || i % Math.ceil(history.length / 8) === 0) {
      ctx.fillText('W' + history[i].weekNumber, x, H - 8);
    }
  });

  // Helper: map value to Y
  const toY = (val) => padTop + chartH - (chartH * (val - minV) / range);

  // E1RM line (draw first so weight line is on top)
  const hasE1rm = e1rms.some(v => v > 0);
  if (hasE1rm) {
    ctx.strokeStyle = '#7C3AED';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    e1rms.forEach((val, i) => {
      if (val <= 0) return;
      const x = xPositions[i];
      const y = toY(val);
      if (i === 0 || e1rms[i - 1] <= 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // E1RM dots
    e1rms.forEach((val, i) => {
      if (val <= 0) return;
      ctx.beginPath();
      ctx.arc(xPositions[i], toY(val), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#7C3AED';
      ctx.fill();
    });
  }

  // Weight line
  ctx.strokeStyle = '#CCFF00';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  weights.forEach((val, i) => {
    const x = xPositions[i];
    const y = toY(val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Weight dots
  const prWeight = pr ? pr.weight_kg : null;
  weights.forEach((val, i) => {
    const isPr = val === prWeight;
    ctx.beginPath();
    ctx.arc(xPositions[i], toY(val), isPr ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = '#CCFF00';
    ctx.fill();
    if (isPr) {
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

function drawWeightChart(history) {
  const canvas = document.getElementById('weight-chart');
  if (!canvas || history.length < 2) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const H = 160;
  canvas.width = rect.width * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;

  const values = history.map(e => e.weight_kg);
  const minV = Math.min(...values) - 0.5;
  const maxV = Math.max(...values) + 0.5;
  const range = maxV - minV || 1;

  const padTop = 15, padBottom = 25, padLeft = 40, padRight = 15;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Y axis
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const val = minV + (range * i / steps);
    const y = padTop + chartH - (chartH * i / steps);
    ctx.fillText(val.toFixed(1), padLeft - 8, y + 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
  }

  const xPositions = history.map((_, i) => padLeft + (chartW * i / (history.length - 1)));
  const toY = (val) => padTop + chartH - (chartH * (val - minV) / range);

  // X axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  xPositions.forEach((x, i) => {
    if (history.length <= 10 || i % Math.ceil(history.length / 6) === 0) {
      const d = parseUtc(history[i].logged_at);
      ctx.fillText(`${d.getDate()}/${d.getMonth() + 1}`, x, H - 6);
    }
  });

  // Line
  ctx.strokeStyle = '#CCFF00';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  values.forEach((val, i) => {
    const x = xPositions[i];
    const y = toY(val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  values.forEach((val, i) => {
    ctx.beginPath();
    ctx.arc(xPositions[i], toY(val), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#CCFF00';
    ctx.fill();
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────────
init();
