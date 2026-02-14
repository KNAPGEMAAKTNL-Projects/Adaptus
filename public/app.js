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
};

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
  }
  navigate(location.hash || '#home');
}

// ─── Router ──────────────────────────────────────────────────────────────────
function navigate(hash) {
  if (!hash || hash === '#') hash = '#home';
  location.hash = hash;
  const parts = hash.replace('#', '').split('/');
  const view = parts[0];
  switch (view) {
    case 'home': renderDashboard(); break;
    case 'workouts': renderWorkouts(); break;
    case 'workout': renderWorkout(parts[1]); break;
    case 'exercise': renderExercise(parseInt(parts[1])); break;
    case 'stats': renderStats(); break;
    default: renderDashboard();
  }
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

// ─── View: Dashboard ────────────────────────────────────────────────────────
async function renderDashboard() {
  const [weekSummary, streakData] = await Promise.all([
    api('GET', `/stats/week-summary?cycle=${state.progress.cycle}&week=${state.progress.week}`),
    api('GET', '/stats/streak'),
  ]);

  const deload = isDeloadWeek(state.progress.week);

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-8 pb-32">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-3xl font-black uppercase tracking-tight leading-none">Adaptus</h1>
          <p class="text-sm font-bold text-ink/40 uppercase tracking-widest mt-1">Cycle ${state.progress.cycle} &middot; Week ${state.progress.week}</p>
        </div>
        ${deload ? '<span class="text-[10px] font-bold uppercase tracking-widest text-acid bg-ink px-2 py-1 rounded-full">Deload</span>' : ''}
      </div>

      <div class="grid grid-cols-2 gap-2.5 mb-5">
        <button onclick="navigate('#workouts')" class="bg-ink text-canvas p-5 text-left transition-colors duration-200 active:bg-ink/80">
          <h3 class="text-lg font-black uppercase tracking-tight">Workouts</h3>
          <p class="text-xs text-white/40 font-bold uppercase tracking-widest mt-1">${weekSummary.workoutsCompleted}/${weekSummary.totalWorkouts} this week</p>
        </button>
        <button onclick="navigate('#stats')" class="bg-ink text-canvas p-5 text-left transition-colors duration-200 active:bg-ink/80">
          <h3 class="text-lg font-black uppercase tracking-tight">Stats</h3>
          <p class="text-xs text-white/40 font-bold uppercase tracking-widest mt-1">PRs &amp; records</p>
        </button>
      </div>

      ${state.currentSession && !state.currentSession.completed_at ? `
        <button onclick="resumeWorkout()" class="w-full mb-5 px-4 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center transition-colors duration-200 active:bg-ink active:text-acid">
          Resume: ${state.currentSession.workout_name}
        </button>
      ` : ''}

      <div class="border-2 border-ink/10 p-5 mb-5">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-4">This Week</h3>
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div>
            <span class="text-3xl font-black leading-none block">${weekSummary.workoutsCompleted}</span>
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
        </div>
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
    </div>
  `;
}

// ─── View: Stats ────────────────────────────────────────────────────────────
async function renderStats() {
  const summary = await api('GET', '/stats/summary');

  const prsHtml = summary.prs.length > 0 ? summary.prs.map(pr => `
    <div class="flex items-center justify-between py-3 border-b border-ink/10 last:border-0">
      <span class="font-bold text-[15px] truncate flex-1 mr-3">${pr.exercise_name}</span>
      <span class="font-black text-lg flex-shrink-0">${pr.max_weight}<span class="text-sm font-bold text-ink/40 ml-0.5">kg</span></span>
    </div>
  `).join('') : '<p class="text-sm text-ink/30 py-4">No data yet. Log some sets!</p>';

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-32">
      <button onclick="navigate('#home')" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Dashboard
      </button>

      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-6">Stats</h1>

      <div class="border-2 border-ink/10 p-5 mb-5">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-4">All Time</h3>
        <div class="grid grid-cols-3 gap-4">
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
}

// ─── View: Workouts ─────────────────────────────────────────────────────────
async function renderWorkouts() {
  const week = await getWeekData();
  if (!week) return;
  const deload = isDeloadWeek(state.progress.week);
  const completedIds = await api('GET', `/workouts/completed?cycle=${state.progress.cycle}&week=${state.progress.week}`);
  const activeTemplateId = state.currentSession && !state.currentSession.completed_at ? state.currentSession.workout_template_id : null;
  const workoutCards = week.workouts.map(wo => {
    const focus = wo.focus;
    const name = wo.name.split('(')[0].trim();
    const completed = completedIds.includes(wo.templateId);
    const isActive = wo.templateId === activeTemplateId;
    let badge = `<span class="text-sm text-white/40">${wo.exercises.length} exercises</span>`;
    if (completed) badge = '<span class="text-xs font-bold text-ink bg-acid px-2 py-0.5">Done</span>';
    else if (isActive) badge = '<span class="text-xs font-bold text-canvas bg-electric px-2 py-0.5">Active</span>';
    return `
      <button onclick="startWorkoutFlow('${wo.templateId}')" class="w-full ${completed ? 'bg-ink/80' : 'bg-ink'} text-canvas p-5 text-left transition-colors duration-200 active:bg-ink/80">
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
    <div class="px-3 pt-6 pb-32">
      <button onclick="navigate('#home')" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Dashboard
      </button>

      <div class="flex items-center justify-between mb-6">
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

      ${state.currentSession && !state.currentSession.completed_at ? `
        <button onclick="resumeWorkout()" class="w-full mb-5 px-4 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center transition-colors duration-200 active:bg-ink active:text-acid">
          Resume: ${state.currentSession.workout_name}
        </button>
      ` : ''}

      <div class="flex flex-col gap-2.5">
        ${workoutCards}
      </div>

      <div class="mt-8 flex items-center gap-3">
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

async function startWorkoutFlow(templateId) {
  const week = await getWeekData();
  const workout = week.workouts.find(wo => wo.templateId === templateId);
  state.currentWorkoutData = workout;
  state.activeSubstitutions = {};
  state.lastPerformance = {};

  // Check if there's already a completed or active session for this workout this week
  const completedIds = await api('GET', `/workouts/completed?cycle=${state.progress.cycle}&week=${state.progress.week}`);
  const isCompleted = completedIds.includes(templateId);

  if (isCompleted || (state.currentSession && state.currentSession.workout_template_id === templateId)) {
    // Load existing session's sets for viewing
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
  } else {
    // Don't create session yet — wait until first set is logged
    state.sessionSets = {};
    state.currentSession = null;
  }

  navigate(`#workout/${templateId}`);
}

async function resumeWorkout() {
  const week = await getWeekData(state.currentSession.week_number);
  const workout = week.workouts.find(wo => wo.templateId === state.currentSession.workout_template_id);
  state.currentWorkoutData = workout;
  navigate(`#workout/${state.currentSession.workout_template_id}`);
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
      <button onclick="navigate('#exercise/${i}')" class="w-full p-4 border-2 ${done ? 'border-acid bg-acid/5' : partial ? 'border-ink/20' : 'border-ink/10'} text-left transition-colors duration-200 active:bg-ink/5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-black text-ink/30">${i + 1}</span>
              <h3 class="font-bold text-[15px] leading-tight truncate">${name}</h3>
              ${isSubbed ? '<span class="text-[10px] font-bold uppercase tracking-widest text-electric">Swap</span>' : ''}
            </div>
            <p class="text-xs text-ink/50 mt-1">${ex.workingSets} sets &middot; ${ex.reps} reps${technique ? ` &middot; ${technique}` : ''}</p>
          </div>
          <div class="flex-shrink-0 mt-0.5">
            ${done ? '<span class="text-xs font-bold text-acid bg-ink px-2 py-1">DONE</span>'
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
  const name = workout.name.split('(')[0].trim();

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-32">
      <button onclick="navigate('#workouts')" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>

      <div class="mb-6">
        <div class="flex items-center gap-2.5">
          <h1 class="text-2xl font-black uppercase tracking-tight leading-none">${name}</h1>
          ${isCompleted ? '<span class="text-[10px] font-bold uppercase tracking-widest text-acid bg-ink px-2 py-1 rounded-full">Completed</span>' : ''}
        </div>
        <p class="text-sm font-bold text-ink/40 uppercase tracking-widest mt-1">${workout.focus} &middot; Week ${state.progress.week}</p>
      </div>

      <div class="flex flex-col gap-2">
        ${exerciseRows}
      </div>

      ${allDone && !isCompleted ? `
        <button onclick="completeWorkout()" class="w-full mt-6 px-6 py-4 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid">
          Complete Workout
        </button>
      ` : ''}

      ${state.currentSession && !isCompleted ? `
        <button onclick="showCancelWorkoutModal()" class="w-full mt-4 py-3 text-xs font-bold uppercase tracking-widest text-ink/30 text-center transition-colors duration-200 active:text-red-500">
          Cancel Workout
        </button>
      ` : ''}
    </div>
  `;
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
  state.currentSession = null;
  state.currentWorkoutData = null;
  navigate('#workouts');
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

  // Pre-fill values: localStorage draft > last logged set > last performance
  const draftKey = `draft-${exercise.id}-${nextSet}`;
  const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
  let prefillWeight = '';
  let prefillReps = '';
  if (draft) {
    prefillWeight = draft.weight;
    prefillReps = draft.reps;
  } else if (logged.length > 0) {
    const lastLogged = logged[logged.length - 1];
    prefillWeight = lastLogged.weight_kg;
    prefillReps = lastLogged.reps;
  } else if (lastPerf.length > 0) {
    prefillWeight = lastPerf[0].weight_kg;
    prefillReps = lastPerf[0].reps;
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
      <button onclick="navigate('#workout/${workout.templateId}')" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> ${workoutName}
      </button>

      <!-- Exercise name -->
      <div class="mb-5">
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-xl font-black uppercase tracking-tight leading-tight">${name}</h1>
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
                <input id="weight-input" type="number" inputmode="decimal" step="0.5" value="${prefillWeight}" placeholder="0"
                  oninput="saveDraft('${draftKey}'); updateOverloadArrow('${name.replace(/'/g, "\\'")}')"
                  class="flex-1 h-11 border-2 border-ink/15 text-center font-bold text-lg focus:border-ink focus:outline-none transition-colors duration-200">
                <button onclick="adjustInput('weight-input', 2.5, '${draftKey}', '${name.replace(/'/g, "\\'")}')" class="w-11 h-11 border-2 border-ink/15 font-bold text-lg active:bg-ink active:text-canvas transition-colors duration-200">+</button>
              </div>
            </div>
            <div>
              <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Reps</label>
              <div class="flex items-center gap-1">
                <button onclick="adjustInput('reps-input', -1, '${draftKey}')" class="w-11 h-11 border-2 border-ink/15 font-bold text-lg active:bg-ink active:text-canvas transition-colors duration-200">&minus;</button>
                <input id="reps-input" type="number" inputmode="numeric" step="1" value="${prefillReps}" placeholder="0"
                  oninput="saveDraft('${draftKey}')"
                  class="flex-1 h-11 border-2 border-ink/15 text-center font-bold text-lg focus:border-ink focus:outline-none transition-colors duration-200">
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

function saveDraft(draftKey) {
  const w = document.getElementById('weight-input')?.value || '';
  const r = document.getElementById('reps-input')?.value || '';
  localStorage.setItem(draftKey, JSON.stringify({ weight: w, reps: r }));
}

function clearDraft(exerciseId, setNumber) {
  localStorage.removeItem(`draft-${exerciseId}-${setNumber}`);
}

function adjustInput(inputId, delta, draftKey, exerciseName) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const current = parseFloat(input.value) || 0;
  const newVal = Math.max(0, current + delta);
  input.value = inputId === 'reps-input' ? Math.round(newVal) : newVal;
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
  const weight = document.getElementById('weight-input')?.value;
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
  const weight = parseFloat(document.getElementById('weight-input')?.value);
  const reps = parseInt(document.getElementById('reps-input')?.value);
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

  // PR celebration
  if (!previousPr || weight > previousPr.weight_kg) {
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

// ─── Boot ────────────────────────────────────────────────────────────────────
init();
