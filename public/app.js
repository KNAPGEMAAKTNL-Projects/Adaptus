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
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(`API ${method} ${path}: unexpected content-type ${contentType}`);
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
  // Close drawer immediately on any navigation
  document.getElementById('drawer-panel')?.classList.add('translate-x-full');
  document.getElementById('drawer-overlay')?.classList.add('hidden');

  // Hide nutrition search bar when leaving nutrition main page
  hideNutritionSearchBar();

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
    case 'nutrition': renderFn = () => {
      if (parts[1] === 'add') return renderNutritionAdd('meals');
      if (parts[1] === 'foods') return renderNutritionAdd('foods');
      if (parts[1] === 'meals') return renderNutritionAdd('meals');
      if (parts[1] === 'food') return renderFoodForm(parts[2] === 'new' ? null : parts[2]);
      if (parts[1] === 'meal') return renderMealForm(parts[2] === 'new' ? null : parts[2]);
      if (parts[1] === 'settings') { openDrawer(drawerShowNutritionGoals); return; }
      return renderNutrition();
    }; break;
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
  updateActiveTab(hash);
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

function updateActiveTab(hash) {
  const h = (hash || location.hash || '#home').replace('#', '');
  const view = h.split('/')[0];
  const tabMap = {
    home: 'home',
    workouts: 'workouts', workout: 'workouts', exercise: 'workouts',
    nutrition: 'nutrition',
    stats: 'stats', 'exercise-stats': 'stats',
  };
  const activeTab = tabMap[view] || 'home';
  document.querySelectorAll('.nav-tab').forEach(btn => {
    if (btn.dataset.tab === activeTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// ─── Drawer ─────────────────────────────────────────────────────────────────
function openDrawer(subPage) {
  document.getElementById('drawer-overlay').classList.remove('hidden');
  document.getElementById('drawer-panel').classList.remove('translate-x-full');
  if (subPage) subPage(); else drawerShowOverview();
}

function closeDrawer() {
  const panel = document.getElementById('drawer-panel');
  const overlay = document.getElementById('drawer-overlay');
  panel.classList.add('translate-x-full');
  setTimeout(() => { overlay.classList.add('hidden'); }, 500);
}

async function drawerShowOverview() {
  document.getElementById('drawer-content').innerHTML = `
    <div class="flex items-center justify-between px-5 pt-6 pb-4">
      <h2 class="text-lg font-black uppercase tracking-tight">You</h2>
      <button onclick="closeDrawer()" class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-colors duration-200">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="flex items-center justify-center h-40">
      <p class="text-sm font-bold uppercase tracking-tight text-white/20">Loading...</p>
    </div>
  `;

  let profile, summary, streakData;
  try {
    [profile, summary, streakData] = await Promise.all([
      api('GET', '/nutrition/profile').catch(() => null),
      api('GET', '/stats/summary').catch(() => null),
      api('GET', '/stats/streak').catch(() => null),
    ]);
  } catch (e) {
    profile = null; summary = null; streakData = null;
  }
  if (!profile) profile = {};
  if (!summary) summary = { totalWorkouts: 0, totalSets: 0, totalVolume: 0 };
  if (!streakData) streakData = { streak: 0 };

  const earned = computeEarnedMilestones(summary, streakData.streak);
  const earnedCount = earned.length;
  const totalCount = MILESTONES.length;
  const pct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  document.getElementById('drawer-content').innerHTML = `
    <div class="flex items-center justify-between px-5 pt-6 pb-4">
      <h2 class="text-lg font-black uppercase tracking-tight">You</h2>
      <button onclick="closeDrawer()" class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-colors duration-200">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="px-5">
      <div class="grid grid-cols-3 gap-3 mb-5">
        <div class="border-2 border-white/10 p-3 text-center">
          <span class="text-2xl font-black leading-none block text-acid">${profile.current_weight_kg || '--'}</span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-1 block">kg</span>
        </div>
        <div class="border-2 border-white/10 p-3 text-center">
          <span class="text-2xl font-black leading-none block">${profile.age || '--'}</span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-1 block">age</span>
        </div>
        <div class="border-2 border-white/10 p-3 text-center">
          <span class="text-2xl font-black leading-none block">${streakData.streak || 0}</span>
          <span class="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-1 block">wk streak</span>
        </div>
      </div>

      <button onclick="drawerShowMilestones()" class="w-full border-2 border-white/10 p-4 mb-5 text-left active:bg-white/5 transition-colors duration-200">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-bold uppercase tracking-widest text-white/40">Milestones</span>
          <span class="text-xs font-bold bg-acid text-ink px-2 py-0.5">${earnedCount}/${totalCount}</span>
        </div>
        <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div class="h-full bg-acid rounded-full" style="width: ${pct}%"></div>
        </div>
      </button>

      <div class="space-y-1">
        <button onclick="drawerShowProfile()" class="w-full text-left px-4 py-3.5 text-[15px] font-bold uppercase tracking-tight text-white hover:bg-white/10 active:bg-white/10 transition-colors duration-200 flex items-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Edit Profile
        </button>
        <button onclick="drawerShowNutritionGoals()" class="w-full text-left px-4 py-3.5 text-[15px] font-bold uppercase tracking-tight text-white hover:bg-white/10 active:bg-white/10 transition-colors duration-200 flex items-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
          Nutrition Goals
        </button>
      </div>
    </div>
  `;
}

async function drawerShowMilestones() {
  const [summary, streakData] = await Promise.all([
    api('GET', '/stats/summary'),
    api('GET', '/stats/streak'),
  ]);
  const earned = computeEarnedMilestones(summary, streakData.streak);
  earned.forEach(m => markMilestoneShown(m.id));
  const earnedIds = new Set(earned.map(m => m.id));

  const milestonesHtml = MILESTONES.map(m => {
    const isEarned = earnedIds.has(m.id);
    return `
      <div class="p-3 border-2 ${isEarned ? 'border-acid bg-acid/10' : 'border-white/10 opacity-30'} text-center">
        <div class="text-xs font-bold uppercase tracking-tight leading-tight">${m.label}</div>
      </div>
    `;
  }).join('');

  document.getElementById('drawer-content').innerHTML = `
    <div class="flex items-center justify-between px-5 pt-6 pb-4">
      <button onclick="drawerShowOverview()" class="text-sm font-bold text-white/40 uppercase tracking-widest flex items-center gap-1 active:text-white transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>
      <button onclick="closeDrawer()" class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-colors duration-200">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="px-5 overflow-y-auto" style="max-height: calc(100vh - 80px - env(safe-area-inset-top) - env(safe-area-inset-bottom))">
      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-2">Milestones</h1>
      <p class="text-sm font-bold text-white/40 mb-5">${earned.length} of ${MILESTONES.length} unlocked</p>
      <div class="grid grid-cols-3 gap-2 mb-5">
        ${milestonesHtml}
      </div>
    </div>
  `;
}

async function drawerShowProfile() {
  const [profile, weightHistory] = await Promise.all([
    api('GET', '/nutrition/profile').catch(() => ({ gender: 'male', age: 28, height_cm: 183, current_weight_kg: null })),
    api('GET', '/weight/history?limit=10').catch(() => []),
  ]);

  function genderBtn(val, label) {
    const active = profile.gender === val;
    return `<button onclick="document.querySelectorAll('.gender-btn').forEach(b=>b.className='gender-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200');this.className='gender-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-acid text-acid transition-colors duration-200'" class="gender-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 ${active ? 'border-acid text-acid' : 'border-white/20 text-white/40'} transition-colors duration-200" data-val="${val}">${label}</button>`;
  }

  document.getElementById('drawer-content').innerHTML = `
    <div class="flex items-center justify-between px-5 pt-6 pb-4">
      <button onclick="drawerShowOverview()" class="text-sm font-bold text-white/40 uppercase tracking-widest flex items-center gap-1 active:text-white transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>
      <button onclick="closeDrawer()" class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-colors duration-200">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="px-5 overflow-y-auto" style="max-height: calc(100vh - 80px - env(safe-area-inset-top) - env(safe-area-inset-bottom))">
      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-5">Edit Profile</h1>

      <div class="space-y-4 mb-6">
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2">Gender</label>
          <div class="flex gap-2">${genderBtn('male', 'Male')}${genderBtn('female', 'Female')}</div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-1">Age</label>
            <input id="drawer-age" type="number" inputmode="numeric" value="${profile.age}"
              class="w-full h-12 px-3 border-2 border-white/20 bg-transparent text-center text-white font-bold text-xl focus:border-acid focus:outline-none transition-colors duration-200">
          </div>
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-1">Height (cm)</label>
            <input id="drawer-height" type="number" inputmode="decimal" value="${profile.height_cm}"
              class="w-full h-12 px-3 border-2 border-white/20 bg-transparent text-center text-white font-bold text-xl focus:border-acid focus:outline-none transition-colors duration-200">
          </div>
        </div>
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-1">Current Weight (kg)</label>
          <input id="drawer-weight" type="number" inputmode="decimal" step="0.1" value="${profile.current_weight_kg || ''}" placeholder="e.g. 82.5"
            class="w-full h-12 px-3 border-2 border-white/20 bg-transparent text-center text-white font-bold text-xl focus:border-acid focus:outline-none transition-colors duration-200 placeholder:text-white/20">
        </div>
      </div>

      <button onclick="drawerSaveProfile()" class="w-full py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid mb-5">
        Save
      </button>

      ${weightHistory.length > 0 ? `
        <div class="border-t border-white/10 pt-5 mb-5">
          <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-3">Weight History</label>
          <div class="space-y-1">
            ${weightHistory.map(w => {
              const d = new Date(w.logged_at);
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              const dateLabel = months[d.getMonth()] + ' ' + d.getDate();
              return `
                <div class="flex items-center justify-between py-1.5">
                  <div class="flex items-center gap-3">
                    <span class="text-sm font-bold text-white/40">${dateLabel}</span>
                    <span class="text-sm font-black text-white">${w.weight_kg} kg</span>
                  </div>
                  <button onclick="drawerDeleteWeight(${w.id})" class="w-7 h-7 flex items-center justify-center text-white/20 hover:text-red-400 transition-colors duration-200 text-lg leading-none">&times;</button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function drawerDeleteWeight(id) {
  await api('DELETE', '/weight/' + id);
  drawerShowProfile();
}

async function drawerSaveProfile() {
  const current = await api('GET', '/nutrition/profile');
  const gender = document.querySelector('.gender-btn.border-acid')?.dataset.val || current.gender || 'male';
  const age = parseInt(document.getElementById('drawer-age')?.value) || current.age || 28;
  const height_cm = parseFloat(document.getElementById('drawer-height')?.value) || current.height_cm || 183;

  // Log weight if entered and not already logged today
  const weightVal = parseFloat(document.getElementById('drawer-weight')?.value);
  if (weightVal && weightVal > 0) {
    const latest = await api('GET', '/weight/latest').catch(() => null);
    const today = new Date().toISOString().split('T')[0];
    const latestDate = latest?.logged_at ? latest.logged_at.split('T')[0] : null;
    if (latestDate !== today) {
      await api('POST', '/weight', { weightKg: weightVal });
    }
  }

  await api('PUT', '/nutrition/profile', {
    gender, age, height_cm,
    activity_level: current.activity_level || 'moderate',
  });
  document.getElementById('drawer-content').innerHTML = `
    <div class="flex items-center justify-center h-40">
      <p class="text-lg font-bold uppercase tracking-tight text-acid">Profile saved!</p>
    </div>
  `;
  setTimeout(() => drawerShowOverview(), 800);
}

function formatPhaseDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

async function drawerShowNutritionGoals() {
  const [profile, phasesData, tdeeData] = await Promise.all([
    api('GET', '/nutrition/profile').catch(() => ({ activity_level: 'moderate', phase: 'maintain' })),
    api('GET', '/nutrition/phases').catch(() => ({ phases: [], active_phase: 'maintain', stabilization: { in_stabilization: false } })),
    api('GET', '/nutrition/adaptive-tdee').catch(() => null),
  ]);
  const activityLabels = { sedentary: 'Sedentary', light: 'Light', moderate: 'Moderate', very_active: 'Very Active', extra_active: 'Extra Active' };

  function activityBtn(val, label) {
    const active = profile.activity_level === val;
    return `<button onclick="document.querySelectorAll('.activity-btn').forEach(b=>b.className='activity-btn w-full py-2 px-3 text-left text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200 mb-1');this.className='activity-btn w-full py-2 px-3 text-left text-sm font-bold uppercase tracking-tight border-2 border-acid text-acid transition-colors duration-200 mb-1'" class="activity-btn w-full py-2 px-3 text-left text-sm font-bold uppercase tracking-tight border-2 ${active ? 'border-acid text-acid' : 'border-white/20 text-white/40'} transition-colors duration-200 mb-1" data-val="${val}">${label}</button>`;
  }

  const today = new Date().toISOString().split('T')[0];
  const phaseColors = { cut: 'text-red-400', maintain: 'text-white/60', bulk: 'text-green-400' };

  // Build phase list
  let phasesHtml = '';
  for (const p of phasesData.phases) {
    const isPast = p.end_date <= today;
    const dimClass = isPast ? 'opacity-40' : '';
    const color = phaseColors[p.phase_type] || 'text-white/60';
    phasesHtml += `
      <div class="flex items-center justify-between py-2 ${dimClass}">
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold text-white/60">${formatPhaseDate(p.start_date)} — ${formatPhaseDate(p.end_date)}</span>
          <span class="text-sm font-black uppercase ${color}">${p.phase_type}</span>
        </div>
        <button onclick="deletePhase(${p.id})" class="w-7 h-7 flex items-center justify-center text-white/20 hover:text-red-400 transition-colors duration-200 text-lg leading-none">&times;</button>
      </div>
    `;
  }

  // Stabilization notice
  const stab = phasesData.stabilization;
  const stabHtml = stab && stab.in_stabilization
    ? `<div class="flex items-center gap-2 px-3 py-2 border-2 border-amber-500/30 bg-amber-500/10 mb-3">
        <span class="text-amber-400 text-sm font-bold">Stabilization — ${stab.days_remaining} days remaining</span>
      </div>`
    : '';

  // Calculation breakdown
  let breakdownHtml = '';
  if (tdeeData && tdeeData.data_status !== 'no_weight') {
    const actMult = tdeeData.activity_multiplier || 1.55;
    const phaseMult = tdeeData.phase_multiplier || 1.0;
    const phaseLabel = tdeeData.data_status === 'adaptive'
      ? `Adaptive`
      : `Phase (\u00d7${phaseMult.toFixed(2)})`;
    const phaseCalLabel = tdeeData.data_status === 'adaptive'
      ? `${tdeeData.adaptive_calories.toLocaleString()} kcal`
      : `${tdeeData.formula_calories.toLocaleString()} kcal`;

    breakdownHtml = `
      <div class="border-t border-white/10 pt-5 mb-5">
        <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-3">Calculation Breakdown</label>
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-white/40 font-bold">BMR</span>
            <span class="text-white font-bold tabular-nums">${tdeeData.bmr.toLocaleString()} kcal</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-white/40 font-bold">TDEE (\u00d7${actMult.toFixed(2)})</span>
            <span class="text-white font-bold tabular-nums">${tdeeData.base_tdee.toLocaleString()} kcal</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-white/40 font-bold">${phaseLabel}</span>
            <span class="text-acid font-bold tabular-nums">${phaseCalLabel}</span>
          </div>
          <div class="border-t border-white/10 pt-2 mt-2"></div>
          <div class="flex justify-between text-sm">
            <span class="text-white/40 font-bold">Protein (2.2g/kg)</span>
            <span class="text-white font-bold tabular-nums">${tdeeData.protein_g}g</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-white/40 font-bold">Fat (25%)</span>
            <span class="text-white font-bold tabular-nums">${tdeeData.fat_g}g</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-white/40 font-bold">Carbs (fill)</span>
            <span class="text-white font-bold tabular-nums">${tdeeData.carbs_g}g</span>
          </div>
        </div>
      </div>
    `;
  }

  document.getElementById('drawer-content').innerHTML = `
    <div class="flex items-center justify-between px-5 pt-6 pb-4">
      <button onclick="drawerShowOverview()" class="text-sm font-bold text-white/40 uppercase tracking-widest flex items-center gap-1 active:text-white transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>
      <button onclick="closeDrawer()" class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-colors duration-200">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="px-5 overflow-y-auto" style="max-height: calc(100vh - 80px - env(safe-area-inset-top) - env(safe-area-inset-bottom))">
      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-5">Nutrition Goals</h1>

      <div class="mb-5">
        <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2">Activity Level</label>
        ${Object.entries(activityLabels).map(([k, v]) => activityBtn(k, v)).join('')}
      </div>

      <button onclick="drawerSaveNutritionGoals()" class="w-full py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid mb-5">
        Save Activity Level
      </button>

      <div class="border-t border-white/10 pt-5 mb-5">
        <div class="flex items-center justify-between mb-3">
          <label class="text-[10px] font-bold uppercase tracking-widest text-white/40">Phase Schedule</label>
          <span class="text-xs font-black uppercase tracking-tight ${phaseColors[phasesData.active_phase] || 'text-white/60'}">Active: ${phasesData.active_phase}</span>
        </div>
        ${stabHtml}
        <div id="phase-list" class="mb-3">
          ${phasesHtml || '<p class="text-sm text-white/20 italic">No phases scheduled</p>'}
        </div>
        <div id="add-phase-area">
          <button onclick="showAddPhaseForm()" id="add-phase-btn" class="w-full py-2 border-2 border-dashed border-white/20 text-white/40 text-sm font-bold uppercase tracking-tight hover:border-acid hover:text-acid transition-colors duration-200">
            + Add Phase
          </button>
          <div id="add-phase-form" class="hidden">
            <div class="space-y-3 border-2 border-white/20 p-3">
              <div>
                <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2">Phase Type</label>
                <div class="flex gap-2">
                  <button onclick="document.querySelectorAll('.new-phase-btn').forEach(b=>b.className='new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200');this.className='new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-acid text-acid transition-colors duration-200'" class="new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200" data-val="cut">Cut</button>
                  <button onclick="document.querySelectorAll('.new-phase-btn').forEach(b=>b.className='new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200');this.className='new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-acid text-acid transition-colors duration-200'" class="new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200" data-val="maintain">Maintain</button>
                  <button onclick="document.querySelectorAll('.new-phase-btn').forEach(b=>b.className='new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200');this.className='new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-acid text-acid transition-colors duration-200'" class="new-phase-btn flex-1 py-2 text-sm font-bold uppercase tracking-tight border-2 border-white/20 text-white/40 transition-colors duration-200" data-val="bulk">Bulk</button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-1">Start</label>
                  <input id="new-phase-start" type="date" class="w-full h-10 px-2 border-2 border-white/20 bg-transparent text-white text-sm font-bold focus:border-acid focus:outline-none transition-colors duration-200">
                </div>
                <div>
                  <label class="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-1">End</label>
                  <input id="new-phase-end" type="date" class="w-full h-10 px-2 border-2 border-white/20 bg-transparent text-white text-sm font-bold focus:border-acid focus:outline-none transition-colors duration-200">
                </div>
              </div>
              <div id="phase-error" class="text-red-400 text-xs font-bold hidden"></div>
              <div class="flex gap-2">
                <button onclick="addPhase()" class="flex-1 py-2 bg-acid text-ink font-bold uppercase tracking-tight text-sm transition-colors duration-200 active:bg-ink active:text-acid">Add</button>
                <button onclick="hideAddPhaseForm()" class="flex-1 py-2 border-2 border-white/20 text-white/40 font-bold uppercase tracking-tight text-sm transition-colors duration-200">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      ${breakdownHtml}
    </div>
  `;
}

function showAddPhaseForm() {
  document.getElementById('add-phase-btn').classList.add('hidden');
  document.getElementById('add-phase-form').classList.remove('hidden');
}

function hideAddPhaseForm() {
  document.getElementById('add-phase-btn').classList.remove('hidden');
  document.getElementById('add-phase-form').classList.add('hidden');
  const errEl = document.getElementById('phase-error');
  if (errEl) errEl.classList.add('hidden');
}

async function addPhase() {
  const phase_type = document.querySelector('.new-phase-btn.border-acid')?.dataset.val;
  const start_date = document.getElementById('new-phase-start')?.value;
  const end_date = document.getElementById('new-phase-end')?.value;
  const errEl = document.getElementById('phase-error');

  if (!phase_type || !start_date || !end_date) {
    if (errEl) { errEl.textContent = 'Select a phase type and both dates'; errEl.classList.remove('hidden'); }
    return;
  }

  try {
    await api('POST', '/nutrition/phases', { phase_type, start_date, end_date });
    drawerShowNutritionGoals();
  } catch (e) {
    if (errEl) { errEl.textContent = 'Phase overlaps with an existing phase'; errEl.classList.remove('hidden'); }
  }
}

async function deletePhase(id) {
  await api('DELETE', `/nutrition/phases/${id}`);
  drawerShowNutritionGoals();
}

async function drawerSaveNutritionGoals() {
  const current = await api('GET', '/nutrition/profile');
  const activity_level = document.querySelector('.activity-btn.border-acid')?.dataset.val || current.activity_level || 'moderate';

  await api('PUT', '/nutrition/profile', {
    gender: current.gender, age: current.age, height_cm: current.height_cm,
    activity_level,
  });
  document.getElementById('drawer-content').innerHTML = `
    <div class="flex items-center justify-center h-40">
      <p class="text-lg font-bold uppercase tracking-tight text-acid">Goals saved!</p>
    </div>
  `;
  setTimeout(() => drawerShowOverview(), 800);
}

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
    api('GET', '/weight/summary').catch(() => ({ current: null })),
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
        <p class="text-sm text-white/50 font-bold uppercase tracking-widest mt-1">Cycle ${state.progress.cycle} &middot; Week ${state.progress.week}${deload ? ' &middot; Deload' : ''}</p>
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
    <div class="px-3 pt-8 pb-20">
      <div class="mb-8">
        <h1 class="text-3xl font-black uppercase tracking-tight leading-none">Adaptus</h1>
        <p class="text-sm font-bold text-ink/40 mt-1">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
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
  const [summary, weightHistory, exercises, tdeeData] = await Promise.all([
    api('GET', '/stats/summary'),
    api('GET', '/weight/history?limit=60').catch(() => []),
    api('GET', '/stats/exercises').catch(() => []),
    api('GET', '/nutrition/adaptive-tdee').catch(() => null),
  ]);

  const exerciseBrowserHtml = exercises.length > 0 ? `
    <div class="border-2 border-ink/10 p-5 mb-5">
      <div class="flex items-center gap-2 mb-4">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Exercise History</h3>
        <span class="text-xs font-bold text-canvas bg-ink px-2 py-0.5">${exercises.length}</span>
      </div>
      <input id="exercise-search" type="text" placeholder="Search exercises..."
        oninput="filterExerciseList(this.value)"
        class="w-full h-10 px-3 border-2 border-ink/15 text-sm font-bold focus:border-ink focus:outline-none transition-colors duration-200 mb-3">
      <div id="exercise-list">
        ${exercises.map(ex => `
          <button onclick="navigate('#exercise-stats/${encodeURIComponent(ex.exercise_name)}')"
            class="exercise-row flex items-center justify-between py-3 border-b border-ink/10 last:border-0 w-full text-left active:bg-ink/5 transition-colors duration-200"
            data-name="${ex.exercise_name.toLowerCase()}">
            <div class="flex-1 min-w-0 mr-3">
              <span class="font-bold text-[15px] truncate block">${ex.exercise_name}</span>
              <span class="text-xs text-ink/40">${ex.total_sets} sets &middot; last ${parseUtc(ex.last_logged).toLocaleDateString()}</span>
            </div>
            <span class="flex-shrink-0 text-right">
              <span class="font-black text-lg">${ex.best_weight}<span class="text-sm font-bold text-ink/40 ml-0.5">kg</span></span>
              ${ex.best_e1rm ? `<span class="text-xs font-bold text-electric ml-2">${ex.best_e1rm} e1rm</span>` : ''}
            </span>
          </button>
        `).join('')}
      </div>
    </div>
  ` : '';

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-20">
      <div class="mb-6">
        <h1 class="text-2xl font-black uppercase tracking-tight leading-none">Stats</h1>
        <p class="text-sm font-bold text-ink/40 mt-1">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>

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
          ${buildWeightTrend(tdeeData)}
          <canvas id="weight-chart" class="w-full mt-3" height="160"></canvas>
        </div>
      ` : ''}

      ${exerciseBrowserHtml}
    </div>
  `;
  if (weightHistory.length >= 2) {
    requestAnimationFrame(() => drawWeightChart(weightHistory));
  }
}

function filterExerciseList(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.exercise-row').forEach(row => {
    row.style.display = row.dataset.name.includes(q) ? '' : 'none';
  });
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
    return `<div class="${active ? 'w-5 h-2 rounded-full bg-acid' : 'w-2 h-2 rounded-full bg-ink/15'} transition-all duration-300"></div>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-20">
      <div class="flex items-center justify-between mb-4 pr-12">
        <div>
          <h1 class="text-2xl font-black uppercase tracking-tight leading-none">Workouts</h1>
          <p class="text-sm font-bold text-ink/40 mt-1">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <div class="text-right">
          <span class="text-4xl font-black leading-none">${state.progress.week}</span>
          <p class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Week</p>
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
        <div class="flex items-center gap-1.5 flex-1 justify-center">
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
    <div class="px-3 pt-6 pb-20">
      <div class="flex items-center justify-between mb-3 pr-12">
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
      <div class="flex items-center justify-between mb-4 pr-12">
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
    <div class="px-3 pt-6 pb-20">
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

// ─── Nutrition State ─────────────────────────────────────────────────────────
let nutritionDate = new Date().toISOString().split('T')[0];
let _searchFoods = null;

function getNutritionDateLabel() {
  return new Date(nutritionDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Week Date Picker Helpers ───────────────────────────────────────────────
function getWeekDays(offset) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  // Get Monday of current week
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7) + (offset * 7));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    days.push({
      date: dateStr,
      dayNum: d.getDate(),
      dayName: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2).toUpperCase(),
      isToday: dateStr === todayStr,
    });
  }
  return days;
}

function calculateWeekOffset(dateStr) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T12:00:00');
  const diff = Math.floor((target - monday) / (7 * 86400000));
  return diff;
}

function buildWeekDayButtons(days) {
  return days.map(d => `
    <button onclick="selectNutritionDate('${d.date}')" class="flex-1 flex flex-col items-center gap-1 py-2">
      <span class="text-[10px] font-bold text-ink/40">${d.dayName}</span>
      <span class="w-9 h-9 flex items-center justify-center text-sm font-black rounded-full
        ${d.date === nutritionDate ? 'border-2 border-[#CCFF00] bg-[#CCFF00]/10' : ''}
        ${d.isToday && d.date !== nutritionDate ? 'text-ink' : d.date === nutritionDate ? 'text-ink' : 'text-ink/60'}">${d.dayNum}</span>
      ${d.isToday ? '<span class="w-1 h-1 rounded-full bg-ink"></span>' : '<span class="w-1 h-1"></span>'}
    </button>
  `).join('');
}

function initWeekPicker() {
  const picker = document.getElementById('week-picker');
  if (!picker) return;
  // Scroll to middle (current) week
  requestAnimationFrame(() => {
    const slides = picker.querySelectorAll('.week-picker-week');
    if (slides.length >= 2) {
      slides[1].scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  });

  let scrollTimer = null;
  picker.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const scrollLeft = picker.scrollLeft;
      const slideWidth = picker.offsetWidth;
      const index = Math.round(scrollLeft / slideWidth);
      const slides = picker.querySelectorAll('.week-picker-week');
      // If scrolled to first slide, prepend a new week
      if (index === 0 && slides.length > 0) {
        const firstOffset = parseInt(slides[0].dataset.offset);
        const newDays = getWeekDays(firstOffset - 1);
        const newSlide = document.createElement('div');
        newSlide.className = 'week-picker-week flex';
        newSlide.dataset.offset = firstOffset - 1;
        newSlide.innerHTML = buildWeekDayButtons(newDays);
        picker.prepend(newSlide);
        picker.scrollLeft = slideWidth;
      }
      // If scrolled to last slide, append a new week
      if (index >= slides.length - 1 && slides.length > 0) {
        const lastOffset = parseInt(slides[slides.length - 1].dataset.offset);
        const newDays = getWeekDays(lastOffset + 1);
        const newSlide = document.createElement('div');
        newSlide.className = 'week-picker-week flex';
        newSlide.dataset.offset = lastOffset + 1;
        newSlide.innerHTML = buildWeekDayButtons(newDays);
        picker.appendChild(newSlide);
      }
    }, 100);
  });
}

function selectNutritionDate(dateStr) {
  nutritionDate = dateStr;
  // Update selection ring visually without re-rendering picker
  const picker = document.getElementById('week-picker');
  if (picker) {
    picker.querySelectorAll('button > span:nth-child(2)').forEach(span => {
      const btn = span.parentElement;
      const btnDate = btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
      if (btnDate === dateStr) {
        span.className = 'w-9 h-9 flex items-center justify-center text-sm font-black rounded-full border-2 border-[#CCFF00] bg-[#CCFF00]/10 text-ink';
      } else {
        const isToday = btn.querySelector('span:nth-child(3)')?.classList.contains('bg-ink');
        span.className = `w-9 h-9 flex items-center justify-center text-sm font-black rounded-full ${isToday ? 'text-ink' : 'text-ink/60'}`;
      }
    });
  }
  // Update date label
  const label = document.getElementById('nutrition-date-label');
  if (label) label.textContent = getNutritionDateLabel();
  // Refresh content sections
  refreshNutritionContent();
}

async function refreshNutritionContent() {
  const [logData, targets] = await Promise.all([
    api('GET', `/nutrition/log?date=${nutritionDate}`),
    api('GET', '/nutrition/targets'),
  ]);
  const macroEl = document.getElementById('nutrition-macro-bar');
  if (macroEl) macroEl.innerHTML = buildCompactMacroBar(logData.totals, targets);
  const logEl = document.getElementById('nutrition-log-section');
  if (logEl) logEl.innerHTML = buildTimeGroupedLog(logData.entries);
  const label = document.getElementById('nutrition-date-label');
  if (label) label.textContent = getNutritionDateLabel();
}

// ─── Compact Macro Bar ──────────────────────────────────────────────────────
function buildCompactMacroBar(totals, targets) {
  function miniBar(current, target, color) {
    const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    return `<div class="h-[3px] bg-ink/10 rounded-full overflow-hidden mt-0.5"><div class="h-full rounded-full" style="width:${pct}%;background:${color}"></div></div>`;
  }
  return `
    <button onclick="openDrawer(drawerShowNutritionGoals)" class="w-full flex items-center gap-2.5 p-3 border-2 border-ink/10 active:bg-ink/5 transition-colors duration-200">
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between text-xs">
          <svg class="flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#CCFF00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z"/></svg>
          <span class="font-bold tabular-nums">${Math.round(totals.calories)} <span class="text-ink/30">/ ${Math.round(targets.calories)}</span></span>
        </div>
        ${miniBar(totals.calories, targets.calories, '#CCFF00')}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between text-xs">
          <span class="font-black text-[#7C3AED]">P</span>
          <span class="font-bold tabular-nums">${Math.round(totals.protein)} <span class="text-ink/30">/ ${Math.round(targets.protein)}</span></span>
        </div>
        ${miniBar(totals.protein, targets.protein, '#7C3AED')}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between text-xs">
          <span class="font-black text-[#F59E0B]">F</span>
          <span class="font-bold tabular-nums">${Math.round(totals.fat)} <span class="text-ink/30">/ ${Math.round(targets.fat)}</span></span>
        </div>
        ${miniBar(totals.fat, targets.fat, '#F59E0B')}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between text-xs">
          <span class="font-black text-[#3B82F6]">C</span>
          <span class="font-bold tabular-nums">${Math.round(totals.carbs)} <span class="text-ink/30">/ ${Math.round(targets.carbs)}</span></span>
        </div>
        ${miniBar(totals.carbs, targets.carbs, '#3B82F6')}
      </div>
    </button>
  `;
}

// ─── Time-Grouped Log ───────────────────────────────────────────────────────
function buildTimeGroupedLog(entries) {
  if (!entries || entries.length === 0) {
    return '<p class="text-sm text-ink/30 py-8 text-center">No entries yet today.</p>';
  }

  const groups = { morning: [], afternoon: [], evening: [] };
  entries.forEach(e => {
    const dt = parseUtc(e.logged_at);
    const hour = dt.getHours();
    if (hour < 12) groups.morning.push(e);
    else if (hour < 18) groups.afternoon.push(e);
    else groups.evening.push(e);
  });

  const labels = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
  let html = '';
  for (const [key, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    html += `<div class="mb-4">
      <h4 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-2">${labels[key]}</h4>
      ${items.map(e => `
        <div class="flex items-center justify-between py-2.5 border-b border-ink/5 last:border-0">
          <div class="flex-1 min-w-0 mr-3">
            <span class="font-bold text-[14px] block truncate">${e.name}</span>
            <span class="text-[11px] text-ink/40">${Math.round(e.calories)} cal · ${Math.round(e.protein)}p · ${Math.round(e.carbs)}c · ${Math.round(e.fat)}f${e.servings !== 1 ? ` · ${e.servings}x` : ''}</span>
          </div>
          <button onclick="deleteLogEntry(${e.id})" class="text-ink/20 hover:text-red-500 text-xs font-bold transition-colors duration-200 flex-shrink-0">&times;</button>
        </div>
      `).join('')}
    </div>`;
  }
  return html;
}

// ─── Bottom Search Bar + Inline Search ──────────────────────────────────────
function showNutritionSearchBar() {
  if (document.getElementById('nutrition-search-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'nutrition-search-bar';
  bar.innerHTML = `
    <div class="flex items-center gap-2 px-3 py-2 bg-canvas border-t border-ink/10">
      <button onclick="openNutritionSearch()" class="flex-1 flex items-center gap-2 h-10 px-3 bg-ink/5 rounded-full active:bg-ink/10 transition-colors duration-200">
        <svg class="text-ink/30 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span class="text-sm text-ink/30 font-medium">Search food database</span>
      </button>
      <button onclick="navigate('#nutrition/add')" class="w-10 h-10 flex items-center justify-center bg-[#CCFF00] rounded-full font-bold text-lg text-ink active:bg-[#b8e600] transition-colors duration-200 flex-shrink-0">+</button>
    </div>
  `;
  document.body.appendChild(bar);
}

function hideNutritionSearchBar() {
  document.getElementById('nutrition-search-bar')?.remove();
  closeNutritionSearch();
}

async function openNutritionSearch() {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'nutrition-search-overlay';
  overlay.innerHTML = '<div class="absolute inset-0 bg-ink/30" onclick="closeNutritionSearch()"></div>';
  document.body.appendChild(overlay);

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'nutrition-search-panel';
  panel.innerHTML = `
    <div class="bg-canvas rounded-t-2xl border-t border-ink/10 max-h-[60vh] flex flex-col">
      <div class="flex items-center gap-2 px-3 py-3 border-b border-ink/5">
        <svg class="text-ink/30 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="nutrition-search-input" type="text" placeholder="Search foods..."
          oninput="filterNutritionSearch(this.value)"
          class="flex-1 text-sm font-bold bg-transparent focus:outline-none">
        <button onclick="closeNutritionSearch()" class="text-ink/30 text-xs font-bold uppercase active:text-ink transition-colors duration-200">Cancel</button>
      </div>
      <div id="nutrition-search-results" class="overflow-y-auto px-3 pb-3" style="max-height: calc(60vh - 52px)">
        <p class="text-sm text-ink/30 py-4 text-center">Loading...</p>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('active');
    panel.classList.add('active');
    document.getElementById('nutrition-search-input')?.focus();
  });

  // Load foods
  if (!_searchFoods) {
    _searchFoods = await api('GET', '/nutrition/foods');
  }
  filterNutritionSearch('');
}

function filterNutritionSearch(query) {
  const results = document.getElementById('nutrition-search-results');
  if (!results || !_searchFoods) return;
  const q = query.toLowerCase().trim();
  const filtered = q ? _searchFoods.filter(f => f.name.toLowerCase().includes(q)) : _searchFoods;
  if (filtered.length === 0) {
    results.innerHTML = '<p class="text-sm text-ink/30 py-4 text-center">No foods found.</p>';
    return;
  }
  results.innerHTML = filtered.map(f => {
    const servingLabel = f.serving_unit ? `1 ${f.serving_unit} = ${f.serving_size}g` : 'per 100g';
    return `
      <button onclick="closeNutritionSearch();showFoodServingsModal(${f.id}, '${f.name.replace(/'/g, "\\'")}', ${f.calories}, ${f.protein}, ${f.carbs}, ${f.fat}, ${f.serving_size ? `'${f.serving_unit}'` : 'null'}, ${f.serving_size || 'null'})"
        class="flex items-center justify-between py-3 border-b border-ink/5 last:border-0 w-full text-left active:bg-ink/5 transition-colors duration-200">
        <div class="flex-1 min-w-0 mr-3">
          <span class="font-bold text-[14px] block truncate">${f.name}</span>
          <span class="text-[11px] text-ink/40">${servingLabel} · ${Math.round(f.calories)} cal/100g</span>
        </div>
        <span class="text-[11px] text-ink/40 flex-shrink-0">${Math.round(f.protein)}p · ${Math.round(f.carbs)}c · ${Math.round(f.fat)}f</span>
      </button>`;
  }).join('');
}

function closeNutritionSearch() {
  const overlay = document.getElementById('nutrition-search-overlay');
  const panel = document.getElementById('nutrition-search-panel');
  if (overlay) {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 200);
  }
  if (panel) {
    panel.classList.remove('active');
    setTimeout(() => panel.remove(), 300);
  }
}

// ─── View: Nutrition (Main) ─────────────────────────────────────────────────
async function renderNutrition() {
  const [logData, targets, tdeeData] = await Promise.all([
    api('GET', `/nutrition/log?date=${nutritionDate}`),
    api('GET', '/nutrition/targets'),
    api('GET', '/nutrition/adaptive-tdee').catch(() => null),
  ]);

  // Auto-update targets if adaptive TDEE differs meaningfully
  let activeTargets = targets;
  if (tdeeData && tdeeData.final_calories && Math.abs(tdeeData.final_calories - targets.calories) > 50) {
    activeTargets = { calories: tdeeData.final_calories, protein: tdeeData.protein_g, carbs: tdeeData.carbs_g, fat: tdeeData.fat_g };
    api('PUT', '/nutrition/targets', activeTargets).catch(() => {});
  }

  const curOffset = calculateWeekOffset(nutritionDate);
  const prevWeek = getWeekDays(curOffset - 1);
  const curWeek = getWeekDays(curOffset);
  const nextWeek = getWeekDays(curOffset + 1);

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-40">
      <div class="mb-4">
        <h1 class="text-2xl font-black uppercase tracking-tight leading-none">Nutrition</h1>
        <p id="nutrition-date-label" class="text-sm font-bold text-ink/40 mt-1">${getNutritionDateLabel()}</p>
      </div>

      <div id="week-picker" class="week-picker flex mb-4">
        <div class="week-picker-week flex" data-offset="${curOffset - 1}">${buildWeekDayButtons(prevWeek)}</div>
        <div class="week-picker-week flex" data-offset="${curOffset}">${buildWeekDayButtons(curWeek)}</div>
        <div class="week-picker-week flex" data-offset="${curOffset + 1}">${buildWeekDayButtons(nextWeek)}</div>
      </div>

      <div id="nutrition-macro-bar" class="mb-4">
        ${buildCompactMacroBar(logData.totals, activeTargets)}
      </div>

      <div id="nutrition-log-section">
        ${buildTimeGroupedLog(logData.entries)}
      </div>
    </div>
  `;

  initWeekPicker();
  showNutritionSearchBar();
}

function buildWeightTrend(tdeeData) {
  if (!tdeeData || !tdeeData.weight_trend || !tdeeData.weight_trend.current) return '';
  const wt = tdeeData.weight_trend;
  let changeHtml = '';
  if (wt.weekly_change_kg !== null) {
    const sign = wt.weekly_change_kg > 0 ? '+' : '';
    const phase = tdeeData.phase;
    let color = 'text-ink/40';
    if (phase === 'cut' && wt.weekly_change_kg < -0.05) color = 'text-green-600';
    else if (phase === 'cut' && wt.weekly_change_kg > 0.05) color = 'text-red-500';
    else if (phase === 'bulk' && wt.weekly_change_kg > 0.05) color = 'text-green-600';
    else if (phase === 'bulk' && wt.weekly_change_kg < -0.05) color = 'text-red-500';
    changeHtml = `<span class="text-sm font-bold ${color}">${sign}${wt.weekly_change_kg} kg/wk</span>`;
  }
  const isStabilizing = tdeeData.data_status === 'stabilization';
  const statusLabel = isStabilizing ? 'Stabilizing' : (tdeeData.data_status === 'adaptive' ? 'Adaptive' : 'Estimated');
  const statusColor = isStabilizing ? 'text-amber-500' : 'text-ink/20';
  const stabNote = isStabilizing && tdeeData.stabilization
    ? `<span class="text-[10px] font-bold text-amber-500/60 ml-1">${tdeeData.stabilization.days_remaining}d left</span>`
    : '';
  return `
    <div class="flex items-center justify-between p-3 border-2 border-ink/10">
      <div class="flex items-center gap-3">
        <span class="text-lg font-black">${wt.current} <span class="text-sm font-bold text-ink/40">kg</span></span>
        ${wt.avg_7d ? `<span class="text-xs text-ink/40">7d avg ${wt.avg_7d}</span>` : ''}
      </div>
      <div class="flex items-center gap-2">
        ${changeHtml}
        <span class="text-[10px] font-bold uppercase tracking-widest ${statusColor}">${statusLabel}</span>${stabNote}
      </div>
    </div>
  `;
}

async function deleteLogEntry(id) {
  await api('DELETE', `/nutrition/log/${id}`);
  // If on nutrition main page, partial refresh to preserve date picker
  if (location.hash === '#nutrition' || location.hash === '' || location.hash === '#') {
    refreshNutritionContent();
  } else {
    renderNutrition();
  }
}

// ─── View: Library (Foods + Meals tabs) ─────────────────────────────────────
async function renderNutritionAdd(initialTab) {
  const tab = initialTab || 'meals';
  const [meals, foods] = await Promise.all([
    api('GET', '/nutrition/meals'),
    api('GET', '/nutrition/foods'),
  ]);
  window._libraryData = { meals, foods };

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-20">
      <button onclick="navigate('#nutrition')" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>

      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-4">Library</h1>

      <div class="flex border-b border-ink/10 mb-4">
        <button onclick="switchLibraryTab('meals')" class="lib-tab ${tab === 'meals' ? 'active' : ''}" id="lib-tab-meals">Meals</button>
        <button onclick="switchLibraryTab('foods')" class="lib-tab ${tab === 'foods' ? 'active' : ''}" id="lib-tab-foods">Foods</button>
      </div>

      <div id="library-content">
        ${tab === 'foods' ? buildFoodsTab(foods) : buildMealsTab(meals)}
      </div>
    </div>
  `;
}

function switchLibraryTab(tab) {
  document.getElementById('lib-tab-meals')?.classList.toggle('active', tab === 'meals');
  document.getElementById('lib-tab-foods')?.classList.toggle('active', tab === 'foods');
  const content = document.getElementById('library-content');
  if (!content || !window._libraryData) return;
  content.innerHTML = tab === 'foods' ? buildFoodsTab(window._libraryData.foods) : buildMealsTab(window._libraryData.meals);
  // Update hash without triggering navigation
  history.replaceState(null, '', tab === 'foods' ? '#nutrition/foods' : '#nutrition/add');
}

function buildFoodsTab(foods) {
  const foodsHtml = foods.length > 0 ? foods.map(f => {
    const servingLabel = f.serving_unit ? `1 ${f.serving_unit} = ${f.serving_size}g` : 'per 100g';
    return `
    <div class="food-item flex items-center justify-between py-3 border-b border-ink/5 last:border-0" data-name="${f.name.toLowerCase()}">
      <button onclick="showFoodServingsModal(${f.id}, '${f.name.replace(/'/g, "\\'")}', ${f.calories}, ${f.protein}, ${f.carbs}, ${f.fat}, ${f.serving_size ? `'${f.serving_unit}'` : 'null'}, ${f.serving_size || 'null'})"
        class="flex-1 min-w-0 mr-2 text-left active:bg-ink/5 transition-colors duration-200">
        <span class="font-bold text-[14px] block truncate">${f.name}</span>
        <span class="text-[11px] text-ink/40">${servingLabel} · ${Math.round(f.calories)} cal/100g · ${Math.round(f.protein)}p · ${Math.round(f.carbs)}c · ${Math.round(f.fat)}f</span>
      </button>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button onclick="navigate('#nutrition/food/${f.id}')" class="w-8 h-8 flex items-center justify-center text-ink/30 active:text-ink transition-colors duration-200">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 1.5l2.5 2.5M1 13l1-4L10.5 0.5l2.5 2.5L4.5 12z"/></svg>
        </button>
        <button onclick="deleteFood(${f.id})" class="w-8 h-8 flex items-center justify-center text-ink/20 hover:text-red-500 transition-colors duration-200">&times;</button>
      </div>
    </div>`;
  }).join('') : '<p class="text-sm text-ink/30 py-4">No foods yet.</p>';

  return `
    <div class="flex items-center gap-2 mb-3">
      <input type="text" placeholder="Search foods..."
        oninput="filterFoodItems(this.value)"
        class="flex-1 h-10 px-3 border-2 border-ink/15 text-sm font-bold focus:border-ink focus:outline-none transition-colors duration-200">
      <button onclick="navigate('#nutrition/food/new')" class="h-10 px-3 border-2 border-ink/15 text-xs font-bold uppercase tracking-tight whitespace-nowrap active:bg-ink active:text-canvas transition-colors duration-200">+ New</button>
    </div>
    <div class="food-list">${foodsHtml}</div>
  `;
}

function buildMealsTab(meals) {
  const mealsHtml = meals.length > 0 ? meals.map(m => `
    <div class="border-2 border-ink/10 p-4 mb-2">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-bold text-[15px] truncate flex-1 mr-2">${m.name}</h3>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button onclick="navigate('#nutrition/meal/${m.id}')" class="w-8 h-8 flex items-center justify-center text-ink/30 active:text-ink transition-colors duration-200">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 1.5l2.5 2.5M1 13l1-4L10.5 0.5l2.5 2.5L4.5 12z"/></svg>
          </button>
          <button onclick="deleteMeal(${m.id})" class="w-8 h-8 flex items-center justify-center text-ink/20 hover:text-red-500 transition-colors duration-200">&times;</button>
        </div>
      </div>
      <p class="text-xs text-ink/40 mb-3">${Math.round(m.totalCalories)} cal · ${Math.round(m.totalProtein)}p · ${Math.round(m.totalCarbs)}c · ${Math.round(m.totalFat)}f</p>
      <button onclick="quickLogMeal(${m.id})" class="w-full py-2 bg-ink text-canvas font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink/80">
        Log Meal
      </button>
    </div>
  `).join('') : '<p class="text-sm text-ink/30 py-4">No meals yet.</p>';

  return `
    <div class="flex items-center justify-end mb-3">
      <button onclick="navigate('#nutrition/meal/new')" class="h-10 px-3 border-2 border-ink/15 text-xs font-bold uppercase tracking-tight whitespace-nowrap active:bg-ink active:text-canvas transition-colors duration-200">+ New</button>
    </div>
    ${mealsHtml}
  `;
}

function filterFoodItems(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.food-item').forEach(row => {
    row.style.display = row.dataset.name.includes(q) ? '' : 'none';
  });
}

async function quickLogMeal(mealId) {
  await api('POST', '/nutrition/log/meal', { mealId, servings: 1, date: nutritionDate });
  navigate('#nutrition');
}

function showFoodServingsModal(foodId, foodName, cal, pro, carb, fat, servingName, servingGrams) {
  const hasServing = servingName && servingGrams;
  const modal = document.createElement('div');
  modal.id = 'servings-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-center justify-center';

  if (hasServing) {
    const perServingCal = Math.round(cal * servingGrams / 100);
    modal.innerHTML = `
      <div class="absolute inset-0 bg-ink/50" onclick="closeFoodServingsModal()"></div>
      <div class="relative bg-canvas mx-4 p-5 max-w-sm w-full">
        <h2 class="text-lg font-black uppercase tracking-tight mb-1">${foodName}</h2>
        <p class="text-xs text-ink/40 mb-1">${perServingCal} cal per ${servingName} (${servingGrams}g)</p>
        <p id="food-grams-equiv" class="text-xs text-ink/30 mb-4">= ${servingGrams}g</p>
        <div class="mb-4">
          <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Servings</label>
          <input id="food-servings-input" type="number" inputmode="decimal" step="0.5" value="1"
            data-serving-grams="${servingGrams}"
            oninput="document.getElementById('food-grams-equiv').textContent = '= ' + Math.round((parseFloat(this.value)||0) * ${servingGrams}) + 'g'"
            class="w-full h-12 border-2 border-ink/15 text-center font-bold text-xl focus:border-ink focus:outline-none transition-colors duration-200">
        </div>
        <div class="flex gap-2">
          <button onclick="closeFoodServingsModal()" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">Cancel</button>
          <button onclick="confirmLogFood(${foodId}, true, ${servingGrams})" class="flex-1 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-acid">Log</button>
        </div>
      </div>
    `;
  } else {
    modal.innerHTML = `
      <div class="absolute inset-0 bg-ink/50" onclick="closeFoodServingsModal()"></div>
      <div class="relative bg-canvas mx-4 p-5 max-w-sm w-full">
        <h2 class="text-lg font-black uppercase tracking-tight mb-1">${foodName}</h2>
        <p class="text-xs text-ink/40 mb-4">${Math.round(cal)} cal per 100g</p>
        <div class="mb-4">
          <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Grams</label>
          <input id="food-servings-input" type="number" inputmode="decimal" step="10" value="100"
            class="w-full h-12 border-2 border-ink/15 text-center font-bold text-xl focus:border-ink focus:outline-none transition-colors duration-200">
        </div>
        <div class="flex gap-2">
          <button onclick="closeFoodServingsModal()" class="flex-1 py-3 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">Cancel</button>
          <button onclick="confirmLogFood(${foodId}, false, null)" class="flex-1 py-3 bg-acid text-ink font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-acid">Log</button>
        </div>
      </div>
    `;
  }

  document.body.appendChild(modal);
  requestAnimationFrame(() => document.getElementById('food-servings-input')?.select());
}

function closeFoodServingsModal() {
  document.getElementById('servings-modal')?.remove();
}

async function confirmLogFood(foodId, hasServing, servingGrams) {
  const inputVal = parseFloat(document.getElementById('food-servings-input')?.value) || 1;
  const grams = hasServing ? inputVal * servingGrams : inputVal;
  closeFoodServingsModal();
  _searchFoods = null;
  await api('POST', '/nutrition/log/food', { foodId, grams, date: nutritionDate });
  // If on nutrition main page, partial refresh to preserve picker state
  const h = location.hash.replace('#', '').split('/')[0];
  if (h === 'nutrition' && !location.hash.includes('/')) {
    refreshNutritionContent();
  } else {
    navigate('#nutrition');
  }
}

// ─── View: Food Form ────────────────────────────────────────────────────────
async function renderFoodForm(id) {
  let food = { name: '', calories: '', protein: '', carbs: '', fat: '', serving_size: null, serving_unit: null };
  if (id) {
    const foods = await api('GET', '/nutrition/foods');
    food = foods.find(f => f.id === parseInt(id)) || food;
  }

  const hasServing = food.serving_unit && food.serving_unit !== 'g';

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-20">
      <button onclick="history.back()" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>

      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-5">${id ? 'Edit Food' : 'New Food'}</h1>

      <div class="space-y-4 mb-6">
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Name</label>
          <input id="food-name" type="text" value="${food.name}" placeholder="e.g. Chicken Breast"
            class="w-full h-12 px-3 border-2 border-ink/15 font-bold focus:border-ink focus:outline-none transition-colors duration-200">
        </div>

        <p class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mt-2">Nutrition per 100g</p>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Calories</label>
            <input id="food-calories" type="number" inputmode="decimal" value="${food.calories}" placeholder="0"
              class="w-full h-12 px-3 border-2 border-ink/15 text-center font-bold focus:border-ink focus:outline-none transition-colors duration-200">
          </div>
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Protein (g)</label>
            <input id="food-protein" type="number" inputmode="decimal" value="${food.protein}" placeholder="0"
              class="w-full h-12 px-3 border-2 border-ink/15 text-center font-bold focus:border-ink focus:outline-none transition-colors duration-200">
          </div>
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Carbs (g)</label>
            <input id="food-carbs" type="number" inputmode="decimal" value="${food.carbs}" placeholder="0"
              class="w-full h-12 px-3 border-2 border-ink/15 text-center font-bold focus:border-ink focus:outline-none transition-colors duration-200">
          </div>
          <div>
            <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Fat (g)</label>
            <input id="food-fat" type="number" inputmode="decimal" value="${food.fat}" placeholder="0"
              class="w-full h-12 px-3 border-2 border-ink/15 text-center font-bold focus:border-ink focus:outline-none transition-colors duration-200">
          </div>
        </div>

        <div class="border-t border-ink/10 pt-4">
          <div class="flex items-center justify-between mb-3">
            <p class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Custom Serving (optional)</p>
            <label class="relative inline-flex items-center cursor-pointer">
              <input id="food-has-serving" type="checkbox" ${hasServing ? 'checked' : ''} onchange="document.getElementById('custom-serving-fields').style.display = this.checked ? '' : 'none'" class="sr-only peer">
              <div class="w-9 h-5 bg-ink/15 peer-checked:bg-acid rounded-full peer-focus:outline-none transition-colors duration-200 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-canvas after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>
          <div id="custom-serving-fields" class="grid grid-cols-2 gap-3" style="${hasServing ? '' : 'display:none'}">
            <div>
              <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Serving Name</label>
              <input id="food-serving-name" type="text" value="${hasServing ? food.serving_unit : ''}" placeholder="e.g. scoop"
                class="w-full h-12 px-3 border-2 border-ink/15 font-bold focus:border-ink focus:outline-none transition-colors duration-200">
            </div>
            <div>
              <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Grams per Serving</label>
              <input id="food-serving-grams" type="number" inputmode="decimal" value="${hasServing ? food.serving_size : ''}" placeholder="e.g. 30"
                class="w-full h-12 px-3 border-2 border-ink/15 text-center font-bold focus:border-ink focus:outline-none transition-colors duration-200">
            </div>
          </div>
        </div>
      </div>

      <button onclick="saveFood(${id || 'null'})" class="w-full py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid">
        ${id ? 'Update Food' : 'Create Food'}
      </button>

      ${id ? `
        <button onclick="deleteFood(${id})" class="w-full mt-3 py-3 text-xs font-bold uppercase tracking-widest text-red-400 text-center transition-colors duration-200 active:text-red-600">
          Delete Food
        </button>
      ` : ''}
    </div>
  `;
}

async function saveFood(id) {
  const hasServing = document.getElementById('food-has-serving')?.checked;
  const data = {
    name: document.getElementById('food-name').value.trim(),
    calories: parseFloat(document.getElementById('food-calories').value) || 0,
    protein: parseFloat(document.getElementById('food-protein').value) || 0,
    carbs: parseFloat(document.getElementById('food-carbs').value) || 0,
    fat: parseFloat(document.getElementById('food-fat').value) || 0,
    servingName: hasServing ? (document.getElementById('food-serving-name').value.trim() || null) : null,
    servingGrams: hasServing ? (parseFloat(document.getElementById('food-serving-grams').value) || null) : null,
  };
  if (!data.name) return;
  if (id) {
    await api('PUT', `/nutrition/foods/${id}`, data);
  } else {
    await api('POST', '/nutrition/foods', data);
  }
  _searchFoods = null;
  history.back();
}

async function deleteFood(id) {
  await api('DELETE', `/nutrition/foods/${id}`);
  _searchFoods = null;
  // If on the library page, re-render foods tab; otherwise go back
  if (location.hash === '#nutrition/foods' || location.hash === '#nutrition/add') renderNutritionAdd('foods');
  else history.back();
}

// ─── View: Meal Form ────────────────────────────────────────────────────────
async function renderMealForm(id) {
  const allFoods = await api('GET', '/nutrition/foods');
  let meal = { name: '', foods: [] };
  if (id) {
    const meals = await api('GET', '/nutrition/meals');
    const found = meals.find(m => m.id === parseInt(id));
    if (found) {
      meal.name = found.name;
      // Convert per-100g macros to per-serving for meal form display
      meal.foods = found.foods.map(f => {
        const ratio = (f.serving_size || 100) / 100;
        return { foodId: f.food_id, name: f.name, servings: f.servings, calories: f.calories * ratio, protein: f.protein * ratio, carbs: f.carbs * ratio, fat: f.fat * ratio };
      });
    }
  }

  // Store meal foods in a temporary global for manipulation
  window._mealFormFoods = meal.foods.map(f => ({ ...f }));

  renderMealFormInner(id, meal.name, allFoods);
}

function renderMealFormInner(id, mealName, allFoods) {
  const foods = window._mealFormFoods || [];

  const totalCal = foods.reduce((s, f) => s + (f.calories || 0) * f.servings, 0);
  const totalPro = foods.reduce((s, f) => s + (f.protein || 0) * f.servings, 0);
  const totalCarb = foods.reduce((s, f) => s + (f.carbs || 0) * f.servings, 0);
  const totalFat = foods.reduce((s, f) => s + (f.fat || 0) * f.servings, 0);

  const foodListHtml = foods.length > 0 ? foods.map((f, i) => `
    <div class="flex items-center justify-between py-2 border-b border-ink/10 last:border-0">
      <div class="flex-1 min-w-0 mr-2">
        <span class="font-bold text-sm truncate block">${f.name}</span>
        <span class="text-xs text-ink/40">${Math.round(f.calories * f.servings)} cal</span>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <button onclick="adjustMealFoodServings(${i}, -0.5, ${id || 'null'}, '${(mealName || '').replace(/'/g, "\\'")}', ${JSON.stringify(allFoods).length > 5000 ? 'null' : 'null'})" class="w-8 h-8 border border-ink/15 font-bold text-sm active:bg-ink active:text-canvas transition-colors duration-200">&minus;</button>
        <span class="text-sm font-bold w-8 text-center">${f.servings}</span>
        <button onclick="adjustMealFoodServings(${i}, 0.5, ${id || 'null'}, '${(mealName || '').replace(/'/g, "\\'")}', null)" class="w-8 h-8 border border-ink/15 font-bold text-sm active:bg-ink active:text-canvas transition-colors duration-200">+</button>
        <button onclick="removeMealFood(${i}, ${id || 'null'}, '${(mealName || '').replace(/'/g, "\\'")}', null)" class="text-ink/20 hover:text-red-500 text-xs font-bold transition-colors duration-200 ml-1">&times;</button>
      </div>
    </div>
  `).join('') : '<p class="text-sm text-ink/30 py-2">No foods added yet.</p>';

  document.getElementById('app').innerHTML = `
    <div class="px-3 pt-6 pb-20">
      <button onclick="history.back()" class="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-1 active:text-ink transition-colors duration-200">
        <span class="text-lg leading-none">&larr;</span> Back
      </button>

      <h1 class="text-2xl font-black uppercase tracking-tight leading-none mb-5">${id ? 'Edit Meal' : 'New Meal'}</h1>

      <div class="mb-4">
        <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Meal Name</label>
        <input id="meal-name" type="text" value="${mealName || ''}" placeholder="e.g. Weekday Breakfast"
          class="w-full h-12 px-3 border-2 border-ink/15 font-bold focus:border-ink focus:outline-none transition-colors duration-200">
      </div>

      <div class="border-2 border-ink/10 p-4 mb-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Foods in Meal</h3>
        </div>
        ${foodListHtml}
      </div>

      <button onclick="showMealFoodPicker()" class="w-full py-2.5 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas mb-4">
        + Add Food
      </button>

      <div class="border-2 border-ink/10 p-4 mb-5">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-2">Meal Totals</h3>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div>
            <span class="text-lg font-black block">${Math.round(totalCal)}</span>
            <span class="text-[10px] font-bold uppercase text-ink/40">Cal</span>
          </div>
          <div>
            <span class="text-lg font-black block">${Math.round(totalPro)}</span>
            <span class="text-[10px] font-bold uppercase text-ink/40">Pro</span>
          </div>
          <div>
            <span class="text-lg font-black block">${Math.round(totalCarb)}</span>
            <span class="text-[10px] font-bold uppercase text-ink/40">Carb</span>
          </div>
          <div>
            <span class="text-lg font-black block">${Math.round(totalFat)}</span>
            <span class="text-[10px] font-bold uppercase text-ink/40">Fat</span>
          </div>
        </div>
      </div>

      <button onclick="saveMeal(${id || 'null'})" class="w-full py-3 bg-acid text-ink font-bold uppercase tracking-tight text-center text-lg transition-colors duration-200 active:bg-ink active:text-acid">
        ${id ? 'Update Meal' : 'Create Meal'}
      </button>

      ${id ? `
        <button onclick="deleteMeal(${id})" class="w-full mt-3 py-3 text-xs font-bold uppercase tracking-widest text-red-400 text-center transition-colors duration-200 active:text-red-600">
          Delete Meal
        </button>
      ` : ''}
    </div>
  `;
}

function adjustMealFoodServings(index, delta) {
  if (!window._mealFormFoods) return;
  const f = window._mealFormFoods[index];
  f.servings = Math.max(0.5, f.servings + delta);
  reRenderMealForm();
}

function removeMealFood(index) {
  if (!window._mealFormFoods) return;
  window._mealFormFoods.splice(index, 1);
  reRenderMealForm();
}

function reRenderMealForm() {
  const id = location.hash.match(/meal\/(\d+)/)?.[1] || null;
  const mealName = document.getElementById('meal-name')?.value || '';
  // Re-fetch allFoods is not needed since we stored it — just re-render the inner
  renderMealFormInner(id, mealName, []);
}

async function showMealFoodPicker() {
  const allFoods = await api('GET', '/nutrition/foods');
  const currentMealName = document.getElementById('meal-name')?.value || '';

  const modal = document.createElement('div');
  modal.id = 'food-picker-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-end';
  modal.innerHTML = `
    <div class="absolute inset-0 bg-ink/50" onclick="closeFoodPickerModal()"></div>
    <div id="food-picker-content" class="relative w-full bg-canvas p-5 max-h-[70vh] overflow-y-auto" style="padding-bottom: calc(2rem + env(safe-area-inset-bottom))">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-black uppercase tracking-tight">Pick Food</h2>
        <button onclick="closeFoodPickerModal()" class="text-ink/40 font-bold text-2xl leading-none">&times;</button>
      </div>
      <div class="flex gap-2 mb-3">
        <input type="text" placeholder="Search..."
          oninput="filterPickerFoods(this.value)"
          class="flex-1 h-10 px-3 border-2 border-ink/15 text-sm font-bold focus:border-ink focus:outline-none transition-colors duration-200">
        <button onclick="showInlineFoodCreator()" class="h-10 px-3 border-2 border-ink/15 text-xs font-bold uppercase tracking-tight whitespace-nowrap active:bg-ink active:text-canvas transition-colors duration-200">+ Create</button>
      </div>
      <div id="picker-food-list">
        ${allFoods.length > 0 ? allFoods.map(f => `
          <button onclick="pickFoodForMeal(${f.id}, '${f.name.replace(/'/g, "\\'")}', ${f.calories}, ${f.protein}, ${f.carbs}, ${f.fat}, ${f.serving_size || 'null'})"
            class="picker-food-row flex items-center justify-between py-3 border-b border-ink/10 last:border-0 w-full text-left active:bg-ink/5 transition-colors duration-200"
            data-name="${f.name.toLowerCase()}">
            <span class="font-bold text-[15px] truncate flex-1 mr-3">${f.name}</span>
            <span class="text-xs text-ink/40 flex-shrink-0">${Math.round(f.calories)} cal/100g</span>
          </button>
        `).join('') : '<p class="text-sm text-ink/30 py-4">No foods. Create one first.</p>'}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  // Store the meal name so we can restore it
  window._mealFormName = currentMealName;
}

function filterPickerFoods(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.picker-food-row').forEach(row => {
    row.style.display = row.dataset.name.includes(q) ? '' : 'none';
  });
}

function closeFoodPickerModal() {
  document.getElementById('food-picker-modal')?.remove();
}

function pickFoodForMeal(foodId, name, cal, pro, carb, fat, servingGrams) {
  if (!window._mealFormFoods) window._mealFormFoods = [];
  // Convert per-100g macros to per-serving
  const ratio = (servingGrams || 100) / 100;
  window._mealFormFoods.push({ foodId, name, servings: 1, calories: cal * ratio, protein: pro * ratio, carbs: carb * ratio, fat: fat * ratio });
  closeFoodPickerModal();
  reRenderMealForm();
  // Restore meal name
  if (window._mealFormName) {
    const nameInput = document.getElementById('meal-name');
    if (nameInput) nameInput.value = window._mealFormName;
  }
}

function showInlineFoodCreator() {
  const content = document.getElementById('food-picker-content');
  if (!content) return;
  content.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-black uppercase tracking-tight">Create Food</h2>
      <button onclick="closeFoodPickerModal()" class="text-ink/40 font-bold text-2xl leading-none">&times;</button>
    </div>
    <div class="space-y-3 mb-4">
      <div>
        <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Name</label>
        <input id="inline-food-name" type="text" placeholder="e.g. Chicken Breast"
          class="w-full h-10 px-3 border-2 border-ink/15 font-bold text-sm focus:border-ink focus:outline-none transition-colors duration-200">
      </div>
      <p class="text-[10px] font-bold uppercase tracking-widest text-ink/40">Nutrition per 100g</p>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Calories</label>
          <input id="inline-food-cal" type="number" inputmode="decimal" placeholder="0"
            class="w-full h-10 px-3 border-2 border-ink/15 text-center font-bold text-sm focus:border-ink focus:outline-none transition-colors duration-200">
        </div>
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Protein (g)</label>
          <input id="inline-food-pro" type="number" inputmode="decimal" placeholder="0"
            class="w-full h-10 px-3 border-2 border-ink/15 text-center font-bold text-sm focus:border-ink focus:outline-none transition-colors duration-200">
        </div>
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Carbs (g)</label>
          <input id="inline-food-carb" type="number" inputmode="decimal" placeholder="0"
            class="w-full h-10 px-3 border-2 border-ink/15 text-center font-bold text-sm focus:border-ink focus:outline-none transition-colors duration-200">
        </div>
        <div>
          <label class="text-[10px] font-bold uppercase tracking-widest text-ink/40 block mb-1">Fat (g)</label>
          <input id="inline-food-fat" type="number" inputmode="decimal" placeholder="0"
            class="w-full h-10 px-3 border-2 border-ink/15 text-center font-bold text-sm focus:border-ink focus:outline-none transition-colors duration-200">
        </div>
      </div>
      <div class="border-t border-ink/10 pt-3">
        <p class="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-2">Custom Serving (optional)</p>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <input id="inline-food-serving-name" type="text" placeholder="e.g. scoop"
              class="w-full h-10 px-3 border-2 border-ink/15 font-bold text-sm focus:border-ink focus:outline-none transition-colors duration-200">
          </div>
          <div>
            <input id="inline-food-serving-grams" type="number" inputmode="decimal" placeholder="grams"
              class="w-full h-10 px-3 border-2 border-ink/15 text-center font-bold text-sm focus:border-ink focus:outline-none transition-colors duration-200">
          </div>
        </div>
      </div>
    </div>
    <div class="flex gap-2">
      <button onclick="closeFoodPickerModal();showMealFoodPicker()" class="flex-1 py-2.5 border-2 border-ink/15 font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-canvas">Cancel</button>
      <button onclick="saveInlineFood()" class="flex-1 py-2.5 bg-acid text-ink font-bold uppercase tracking-tight text-sm text-center transition-colors duration-200 active:bg-ink active:text-acid">Save & Add</button>
    </div>
  `;
  requestAnimationFrame(() => document.getElementById('inline-food-name')?.focus());
}

async function saveInlineFood() {
  const name = document.getElementById('inline-food-name')?.value.trim();
  if (!name) return;
  const cal = parseFloat(document.getElementById('inline-food-cal')?.value) || 0;
  const pro = parseFloat(document.getElementById('inline-food-pro')?.value) || 0;
  const carb = parseFloat(document.getElementById('inline-food-carb')?.value) || 0;
  const fat = parseFloat(document.getElementById('inline-food-fat')?.value) || 0;
  const servingName = document.getElementById('inline-food-serving-name')?.value.trim() || null;
  const servingGrams = parseFloat(document.getElementById('inline-food-serving-grams')?.value) || null;

  const food = await api('POST', '/nutrition/foods', { name, calories: cal, protein: pro, carbs: carb, fat: fat, servingName, servingGrams });
  _searchFoods = null;

  // Add to meal form with per-serving macros
  if (!window._mealFormFoods) window._mealFormFoods = [];
  const ratio = (food.serving_size || 100) / 100;
  window._mealFormFoods.push({ foodId: food.id, name: food.name, servings: 1, calories: food.calories * ratio, protein: food.protein * ratio, carbs: food.carbs * ratio, fat: food.fat * ratio });

  closeFoodPickerModal();
  reRenderMealForm();
  if (window._mealFormName) {
    const nameInput = document.getElementById('meal-name');
    if (nameInput) nameInput.value = window._mealFormName;
  }
}

async function saveMeal(id) {
  const name = document.getElementById('meal-name')?.value.trim();
  if (!name) return;
  const foods = (window._mealFormFoods || []).map(f => ({ foodId: f.foodId, servings: f.servings }));
  if (id) {
    await api('PUT', `/nutrition/meals/${id}`, { name, foods });
  } else {
    await api('POST', '/nutrition/meals', { name, foods });
  }
  window._mealFormFoods = null;
  history.back();
}

async function deleteMeal(id) {
  await api('DELETE', `/nutrition/meals/${id}`);
  window._mealFormFoods = null;
  // If on the library page, re-render meals tab; otherwise go back
  if (location.hash === '#nutrition/meals' || location.hash === '#nutrition/add') renderNutritionAdd('meals');
  else history.back();
}

// ─── Boot ────────────────────────────────────────────────────────────────────
init();
