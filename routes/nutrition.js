const express = require('express');
const { get, all, run } = require('../db');
const router = express.Router();

// ─── Foods ──────────────────────────────────────────────────────────────────

// GET /foods — all foods, ordered by most recently used in daily_log
router.get('/foods', (req, res) => {
  const foods = all(`
    SELECT f.*, MAX(dl.logged_at) as last_used
    FROM foods f
    LEFT JOIN daily_log dl ON dl.food_id = f.id
    GROUP BY f.id
    ORDER BY last_used DESC NULLS LAST, f.created_at DESC
  `);
  res.json(foods);
});

// GET /foods/barcode/:barcode — look up food by barcode
router.get('/foods/barcode/:barcode', (req, res) => {
  const food = get(`SELECT * FROM foods WHERE barcode = ?`, [req.params.barcode]);
  res.json(food || null);
});

// POST /foods — create food (macros are per 100g)
router.post('/foods', (req, res) => {
  const { name, calories, protein, carbs, fat, servingName, servingGrams, barcode } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = run(
    `INSERT INTO foods (name, calories, protein, carbs, fat, serving_size, serving_unit, barcode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, calories || 0, protein || 0, carbs || 0, fat || 0, servingName ? (servingGrams || 100) : 100, servingName || 'g', barcode || null]
  );
  const food = get(`SELECT * FROM foods WHERE id = ?`, [result.lastInsertRowid]);
  res.json(food);
});

// PUT /foods/:id — update food (macros are per 100g)
router.put('/foods/:id', (req, res) => {
  const { name, calories, protein, carbs, fat, servingName, servingGrams, barcode } = req.body;
  run(
    `UPDATE foods SET name = ?, calories = ?, protein = ?, carbs = ?, fat = ?, serving_size = ?, serving_unit = ?, barcode = ? WHERE id = ?`,
    [name, calories || 0, protein || 0, carbs || 0, fat || 0, servingName ? (servingGrams || 100) : 100, servingName || 'g', barcode || null, req.params.id]
  );
  const food = get(`SELECT * FROM foods WHERE id = ?`, [req.params.id]);
  res.json(food);
});

// DELETE /foods/:id — delete food
router.delete('/foods/:id', (req, res) => {
  run(`DELETE FROM meal_foods WHERE food_id = ?`, [req.params.id]);
  run(`DELETE FROM foods WHERE id = ?`, [req.params.id]);
  res.json({ ok: true });
});

// ─── Meals ──────────────────────────────────────────────────────────────────

// GET /meals — all meals with computed totals
router.get('/meals', (req, res) => {
  const meals = all(`SELECT * FROM meals ORDER BY created_at DESC`);
  for (const meal of meals) {
    const foods = all(`
      SELECT mf.servings, f.name, f.calories, f.protein, f.carbs, f.fat, f.serving_size, f.serving_unit, f.id as food_id
      FROM meal_foods mf
      JOIN foods f ON f.id = mf.food_id
      WHERE mf.meal_id = ?
    `, [meal.id]);
    meal.foods = foods;
    const factor = (f) => (f.serving_size || 100) / 100 * f.servings;
    meal.totalCalories = foods.reduce((sum, f) => sum + f.calories * factor(f), 0);
    meal.totalProtein = foods.reduce((sum, f) => sum + f.protein * factor(f), 0);
    meal.totalCarbs = foods.reduce((sum, f) => sum + f.carbs * factor(f), 0);
    meal.totalFat = foods.reduce((sum, f) => sum + f.fat * factor(f), 0);
  }
  res.json(meals);
});

// POST /meals — create meal
router.post('/meals', (req, res) => {
  const { name, foods } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = run(`INSERT INTO meals (name) VALUES (?)`, [name]);
  const mealId = result.lastInsertRowid;
  if (foods && foods.length > 0) {
    for (const f of foods) {
      run(`INSERT INTO meal_foods (meal_id, food_id, servings) VALUES (?, ?, ?)`, [mealId, f.foodId, f.servings || 1]);
    }
  }
  const meal = get(`SELECT * FROM meals WHERE id = ?`, [mealId]);
  res.json(meal);
});

// PUT /meals/:id — update meal name and foods list
router.put('/meals/:id', (req, res) => {
  const { name, foods } = req.body;
  if (name) run(`UPDATE meals SET name = ? WHERE id = ?`, [name, req.params.id]);
  if (foods) {
    run(`DELETE FROM meal_foods WHERE meal_id = ?`, [req.params.id]);
    for (const f of foods) {
      run(`INSERT INTO meal_foods (meal_id, food_id, servings) VALUES (?, ?, ?)`, [req.params.id, f.foodId, f.servings || 1]);
    }
  }
  const meal = get(`SELECT * FROM meals WHERE id = ?`, [req.params.id]);
  res.json(meal);
});

// DELETE /meals/:id — delete meal
router.delete('/meals/:id', (req, res) => {
  run(`DELETE FROM meal_foods WHERE meal_id = ?`, [req.params.id]);
  run(`DELETE FROM meals WHERE id = ?`, [req.params.id]);
  res.json({ ok: true });
});

// ─── Daily Log ──────────────────────────────────────────────────────────────

// GET /log/history?days=N — aggregated daily totals for trend charts (must be before GET /log)
router.get('/log/history', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const rows = all(`
    SELECT date, SUM(calories) as calories, SUM(protein) as protein, SUM(carbs) as carbs, SUM(fat) as fat
    FROM daily_log
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date
    ORDER BY date ASC
  `, [days]);

  // Build a full date range, fill missing days with zeros
  const result = [];
  const rowMap = {};
  for (const r of rows) rowMap[r.date] = r;
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const entry = rowMap[dateStr];
    result.push({
      date: dateStr,
      calories: entry ? Math.round(entry.calories) : 0,
      protein: entry ? Math.round(entry.protein) : 0,
      carbs: entry ? Math.round(entry.carbs) : 0,
      fat: entry ? Math.round(entry.fat) : 0,
    });
  }

  const targets = get(`SELECT * FROM nutrition_targets WHERE id = 1`);
  res.json({ days: result, targets: targets || { calories: 2500, protein: 180, carbs: 250, fat: 80 } });
});

// GET /log?date=YYYY-MM-DD — day's entries + totals
router.get('/log', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const entries = all(`SELECT * FROM daily_log WHERE date = ? ORDER BY logged_at ASC`, [date]);
  const totals = {
    calories: entries.reduce((s, e) => s + e.calories, 0),
    protein: entries.reduce((s, e) => s + e.protein, 0),
    carbs: entries.reduce((s, e) => s + e.carbs, 0),
    fat: entries.reduce((s, e) => s + e.fat, 0),
  };
  res.json({ date, entries, totals });
});

// POST /log/meal — log a meal (expands meal_foods, snapshots macros)
router.post('/log/meal', (req, res) => {
  const { mealId, servings, date } = req.body;
  const logDate = date || new Date().toISOString().split('T')[0];
  const mealServings = servings || 1;
  const meal = get(`SELECT * FROM meals WHERE id = ?`, [mealId]);
  if (!meal) return res.status(404).json({ error: 'Meal not found' });

  const foods = all(`
    SELECT mf.servings, f.name, f.calories, f.protein, f.carbs, f.fat, f.serving_size
    FROM meal_foods mf
    JOIN foods f ON f.id = mf.food_id
    WHERE mf.meal_id = ?
  `, [mealId]);

  let totalCal = 0, totalPro = 0, totalCarb = 0, totalFat = 0;
  for (const f of foods) {
    const ratio = (f.serving_size || 100) / 100 * f.servings * mealServings;
    totalCal += f.calories * ratio;
    totalPro += f.protein * ratio;
    totalCarb += f.carbs * ratio;
    totalFat += f.fat * ratio;
  }

  const result = run(
    `INSERT INTO daily_log (date, meal_id, name, servings, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [logDate, mealId, meal.name, mealServings, totalCal, totalPro, totalCarb, totalFat]
  );
  const entry = get(`SELECT * FROM daily_log WHERE id = ?`, [result.lastInsertRowid]);
  res.json(entry);
});

// POST /log/food — log a single food (grams-based, macros are per 100g)
router.post('/log/food', (req, res) => {
  const { foodId, grams, date } = req.body;
  const logDate = date || new Date().toISOString().split('T')[0];
  const g = grams || 100;
  const food = get(`SELECT * FROM foods WHERE id = ?`, [foodId]);
  if (!food) return res.status(404).json({ error: 'Food not found' });

  const ratio = g / 100;
  const cal = food.calories * ratio;
  const pro = food.protein * ratio;
  const carb = food.carbs * ratio;
  const fat = food.fat * ratio;

  const result = run(
    `INSERT INTO daily_log (date, food_id, name, servings, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [logDate, foodId, food.name, g, cal, pro, carb, fat]
  );
  const entry = get(`SELECT * FROM daily_log WHERE id = ?`, [result.lastInsertRowid]);
  res.json(entry);
});

// POST /log/copy-day — copy all entries from one date to another
router.post('/log/copy-day', (req, res) => {
  const { sourceDate, targetDate } = req.body;
  if (!sourceDate || !targetDate) return res.status(400).json({ error: 'sourceDate and targetDate required' });
  const entries = all(`SELECT * FROM daily_log WHERE date = ? ORDER BY logged_at ASC`, [sourceDate]);
  if (entries.length === 0) return res.json({ copied: 0, entries: [] });
  const copied = [];
  for (const e of entries) {
    const result = run(
      `INSERT INTO daily_log (date, food_id, meal_id, name, servings, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [targetDate, e.food_id, e.meal_id, e.name, e.servings, e.calories, e.protein, e.carbs, e.fat]
    );
    copied.push(get(`SELECT * FROM daily_log WHERE id = ?`, [result.lastInsertRowid]));
  }
  res.json({ copied: copied.length, entries: copied });
});

// PUT /log/:id — update servings and recalculate macros
router.put('/log/:id', (req, res) => {
  const { servings } = req.body;
  if (servings == null || servings <= 0) return res.status(400).json({ error: 'Valid servings required' });
  const entry = get(`SELECT * FROM daily_log WHERE id = ?`, [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  let cal, pro, carb, fat;
  if (entry.food_id) {
    const food = get(`SELECT * FROM foods WHERE id = ?`, [entry.food_id]);
    if (!food) return res.status(404).json({ error: 'Food not found' });
    const ratio = servings / 100;
    cal = food.calories * ratio;
    pro = food.protein * ratio;
    carb = food.carbs * ratio;
    fat = food.fat * ratio;
  } else if (entry.meal_id) {
    const foods = all(`
      SELECT mf.servings, f.calories, f.protein, f.carbs, f.fat, f.serving_size
      FROM meal_foods mf JOIN foods f ON f.id = mf.food_id
      WHERE mf.meal_id = ?
    `, [entry.meal_id]);
    cal = 0; pro = 0; carb = 0; fat = 0;
    for (const f of foods) {
      const r = (f.serving_size || 100) / 100 * f.servings * servings;
      cal += f.calories * r;
      pro += f.protein * r;
      carb += f.carbs * r;
      fat += f.fat * r;
    }
  } else {
    return res.status(400).json({ error: 'Cannot edit this entry' });
  }

  run(`UPDATE daily_log SET servings = ?, calories = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?`,
    [servings, cal, pro, carb, fat, req.params.id]);
  const updated = get(`SELECT * FROM daily_log WHERE id = ?`, [req.params.id]);
  res.json(updated);
});

// DELETE /log/:id — remove log entry
router.delete('/log/:id', (req, res) => {
  run(`DELETE FROM daily_log WHERE id = ?`, [req.params.id]);
  res.json({ ok: true });
});

// ─── Targets ────────────────────────────────────────────────────────────────

// GET /targets — current targets
router.get('/targets', (req, res) => {
  const targets = get(`SELECT * FROM nutrition_targets WHERE id = 1`);
  res.json(targets);
});

// PUT /targets — update targets
router.put('/targets', (req, res) => {
  const { calories, protein, carbs, fat } = req.body;
  run(
    `UPDATE nutrition_targets SET calories = ?, protein = ?, carbs = ?, fat = ? WHERE id = 1`,
    [calories || 2500, protein || 180, carbs || 250, fat || 80]
  );
  const targets = get(`SELECT * FROM nutrition_targets WHERE id = 1`);
  res.json(targets);
});

// ─── Phase Helpers ──────────────────────────────────────────────────────────

function getActivePhase(dateStr) {
  const d = dateStr || new Date().toISOString().split('T')[0];
  const row = get(`SELECT phase_type FROM phases WHERE start_date <= ? AND end_date > ? ORDER BY start_date DESC LIMIT 1`, [d, d]);
  return row ? row.phase_type : 'maintain';
}

function getStabilizationStatus(dateStr) {
  const d = dateStr || new Date().toISOString().split('T')[0];
  // Find the phase that covers today
  const currentPhase = get(`SELECT * FROM phases WHERE start_date <= ? AND end_date > ? ORDER BY start_date DESC LIMIT 1`, [d, d]);
  if (!currentPhase) return { in_stabilization: false };

  // Find the previous phase (ends at or before current phase start)
  const prevPhase = get(`SELECT * FROM phases WHERE end_date <= ? ORDER BY end_date DESC LIMIT 1`, [currentPhase.start_date]);

  // If no previous phase, or same type, no stabilization
  if (!prevPhase || prevPhase.phase_type === currentPhase.phase_type) return { in_stabilization: false };

  // Check if within 10 days of phase boundary
  const boundaryDate = new Date(currentPhase.start_date);
  const today = new Date(d);
  const daysSinceBoundary = Math.floor((today - boundaryDate) / 86400000);

  if (daysSinceBoundary < 10) {
    return { in_stabilization: true, days_remaining: 10 - daysSinceBoundary };
  }
  return { in_stabilization: false };
}

function recalculateTargets() {
  const profile = get(`SELECT * FROM user_profile WHERE id = 1`);
  const weight = get(`SELECT weight_kg FROM body_weight ORDER BY logged_at DESC LIMIT 1`);
  if (!weight) return;
  const phase = getActivePhase();
  const targets = calculateTargets(profile, weight.weight_kg, phase);
  run(
    `UPDATE nutrition_targets SET calories=?, protein=?, carbs=?, fat=? WHERE id=1`,
    [targets.calories, targets.protein, targets.carbs, targets.fat]
  );
}

// ─── Profile ───────────────────────────────────────────────────────────────

// GET /profile — user profile + latest weight + active phase
router.get('/profile', (req, res) => {
  const profile = get(`SELECT * FROM user_profile WHERE id = 1`);
  const weight = get(`SELECT weight_kg FROM body_weight ORDER BY logged_at DESC LIMIT 1`);
  const phase = getActivePhase();
  res.json({ ...profile, phase, current_weight_kg: weight ? weight.weight_kg : null });
});

// PUT /profile — update profile and auto-recalculate targets (no phase/protein_per_kg)
router.put('/profile', (req, res) => {
  const { gender, age, height_cm, activity_level } = req.body;
  run(
    `UPDATE user_profile SET gender=?, age=?, height_cm=?, activity_level=? WHERE id=1`,
    [gender || 'male', age || 25, height_cm || 175, activity_level || 'moderate']
  );
  recalculateTargets();
  const profile = get(`SELECT * FROM user_profile WHERE id = 1`);
  const weight = get(`SELECT weight_kg FROM body_weight ORDER BY logged_at DESC LIMIT 1`);
  const phase = getActivePhase();
  res.json({ ...profile, phase, current_weight_kg: weight ? weight.weight_kg : null });
});

// ─── Phases CRUD ────────────────────────────────────────────────────────────

// GET /phases — all phases ordered by start_date + active phase
router.get('/phases', (req, res) => {
  const phases = all(`SELECT * FROM phases ORDER BY start_date ASC`);
  const activePhase = getActivePhase();
  const stabilization = getStabilizationStatus();
  res.json({ phases, active_phase: activePhase, stabilization });
});

// POST /phases — create phase (validates no overlap)
router.post('/phases', (req, res) => {
  const { phase_type, start_date, end_date } = req.body;
  if (!phase_type || !start_date || !end_date) {
    return res.status(400).json({ error: 'phase_type, start_date, and end_date are required' });
  }
  if (!['cut', 'maintain', 'bulk'].includes(phase_type)) {
    return res.status(400).json({ error: 'phase_type must be cut, maintain, or bulk' });
  }
  if (start_date >= end_date) {
    return res.status(400).json({ error: 'start_date must be before end_date' });
  }
  // Check for overlap
  const overlap = get(`SELECT id FROM phases WHERE start_date < ? AND end_date > ?`, [end_date, start_date]);
  if (overlap) {
    return res.status(400).json({ error: 'Phase overlaps with an existing phase' });
  }
  const result = run(
    `INSERT INTO phases (phase_type, start_date, end_date) VALUES (?, ?, ?)`,
    [phase_type, start_date, end_date]
  );
  recalculateTargets();
  const phase = get(`SELECT * FROM phases WHERE id = ?`, [result.lastInsertRowid]);
  res.json(phase);
});

// PUT /phases/:id — update phase (validates no overlap excluding self)
router.put('/phases/:id', (req, res) => {
  const { phase_type, start_date, end_date } = req.body;
  if (!phase_type || !start_date || !end_date) {
    return res.status(400).json({ error: 'phase_type, start_date, and end_date are required' });
  }
  if (start_date >= end_date) {
    return res.status(400).json({ error: 'start_date must be before end_date' });
  }
  // Check for overlap excluding self
  const overlap = get(`SELECT id FROM phases WHERE start_date < ? AND end_date > ? AND id != ?`, [end_date, start_date, req.params.id]);
  if (overlap) {
    return res.status(400).json({ error: 'Phase overlaps with an existing phase' });
  }
  run(
    `UPDATE phases SET phase_type=?, start_date=?, end_date=? WHERE id=?`,
    [phase_type, start_date, end_date, req.params.id]
  );
  recalculateTargets();
  const phase = get(`SELECT * FROM phases WHERE id = ?`, [req.params.id]);
  res.json(phase);
});

// DELETE /phases/:id — delete phase
router.delete('/phases/:id', (req, res) => {
  run(`DELETE FROM phases WHERE id = ?`, [req.params.id]);
  recalculateTargets();
  res.json({ ok: true });
});

// ─── Adaptive TDEE ─────────────────────────────────────────────────────────

const ACTIVITY_MULTIPLIERS = { sedentary: 1.2, light: 1.375, moderate: 1.55, very_active: 1.725, extra_active: 1.9 };
const PHASE_MULTIPLIERS = { cut: 0.80, maintain: 1.0, bulk: 1.15 };

function calculateBMR(gender, weight_kg, height_cm, age) {
  const base = (10 * weight_kg) + (6.25 * height_cm) - (5 * age);
  return gender === 'female' ? base - 161 : base + 5;
}

function calculateTargets(profile, weight_kg, phase) {
  const bmr = calculateBMR(profile.gender, weight_kg, profile.height_cm, profile.age);
  const activityMult = ACTIVITY_MULTIPLIERS[profile.activity_level] || 1.55;
  const phaseMult = PHASE_MULTIPLIERS[phase] || 1.0;
  const calories = Math.round(bmr * activityMult * phaseMult);
  const protein = Math.round(weight_kg * 2.2);
  const fat = Math.round((calories * 0.25) / 9);
  const carbCals = calories - (protein * 4) - (fat * 9);
  const carbs = Math.max(0, Math.round(carbCals / 4));
  return { calories, protein, carbs, fat };
}

// GET /adaptive-tdee — full calculation breakdown
router.get('/adaptive-tdee', (req, res) => {
  const profile = get(`SELECT * FROM user_profile WHERE id = 1`);
  const weightEntry = get(`SELECT weight_kg FROM body_weight ORDER BY logged_at DESC LIMIT 1`);

  if (!weightEntry) {
    return res.json({ data_status: 'no_weight', weight_trend: null });
  }

  const weight_kg = weightEntry.weight_kg;
  const phase = getActivePhase();
  const stabilization = getStabilizationStatus();
  const bmr = calculateBMR(profile.gender, weight_kg, profile.height_cm, profile.age);
  const activityMult = ACTIVITY_MULTIPLIERS[profile.activity_level] || 1.55;
  const phaseMult = PHASE_MULTIPLIERS[phase] || 1.0;
  const base_tdee = Math.round(bmr * activityMult);
  const formula_calories = Math.round(base_tdee * phaseMult);

  // Weight trend: 7d avg vs previous 7d avg
  const avg7 = get(`SELECT AVG(weight_kg) as avg_weight, COUNT(*) as count FROM body_weight WHERE logged_at >= datetime('now', '-7 days')`);
  const avg7prev = get(`SELECT AVG(weight_kg) as avg_weight, COUNT(*) as count FROM body_weight WHERE logged_at >= datetime('now', '-14 days') AND logged_at < datetime('now', '-7 days')`);
  const weight_trend = {
    current: weight_kg,
    avg_7d: avg7?.avg_weight ? Math.round(avg7.avg_weight * 10) / 10 : null,
    avg_prev_7d: avg7prev?.avg_weight ? Math.round(avg7prev.avg_weight * 10) / 10 : null,
    weekly_change_kg: null,
    weekly_change_pct: null,
  };
  if (avg7?.avg_weight && avg7prev?.avg_weight) {
    weight_trend.weekly_change_kg = Math.round((avg7.avg_weight - avg7prev.avg_weight) * 100) / 100;
    weight_trend.weekly_change_pct = Math.round(((avg7.avg_weight - avg7prev.avg_weight) / avg7prev.avg_weight) * 10000) / 100;
  }

  // If in stabilization, skip adaptive inference
  if (stabilization.in_stabilization) {
    const protein_g = Math.round(weight_kg * 2.2);
    const fat_g = Math.round((formula_calories * 0.25) / 9);
    const carbs_g = Math.max(0, Math.round((formula_calories - protein_g * 4 - fat_g * 9) / 4));

    return res.json({
      bmr: Math.round(bmr),
      base_tdee,
      activity_multiplier: activityMult,
      phase,
      phase_multiplier: phaseMult,
      formula_calories,
      inferred_tdee: null,
      adaptive_calories: null,
      final_calories: formula_calories,
      protein_g,
      fat_g,
      carbs_g,
      weight_trend,
      data_status: 'stabilization',
      stabilization,
    });
  }

  // Adaptive TDEE inference: need ≥7 days of calorie logs + ≥2 weeks of weight data
  let inferred_tdee = null;
  let adaptive_calories = null;
  let data_status = 'formula_only';

  const calorieLogs = all(`
    SELECT date, SUM(calories) as total_cal
    FROM daily_log
    WHERE date >= date('now', '-7 days')
    GROUP BY date
  `);
  const hasEnoughCalories = calorieLogs.length >= 7;
  const hasEnoughWeight = (avg7?.count || 0) >= 2 && (avg7prev?.count || 0) >= 2;

  if (hasEnoughCalories && hasEnoughWeight && avg7?.avg_weight && avg7prev?.avg_weight) {
    const avg_daily_intake = calorieLogs.reduce((s, d) => s + d.total_cal, 0) / calorieLogs.length;
    const weight_change_kg = avg7.avg_weight - avg7prev.avg_weight;
    // 7700 kcal ≈ 1 kg body mass. Daily surplus/deficit from weight change:
    const daily_surplus = (weight_change_kg * 7700) / 7;
    inferred_tdee = Math.round(avg_daily_intake - daily_surplus);
    adaptive_calories = Math.round(inferred_tdee * phaseMult);
    data_status = 'adaptive';
  }

  const final_calories = adaptive_calories || formula_calories;
  const protein_g = Math.round(weight_kg * 2.2);
  const fat_g = Math.round((final_calories * 0.25) / 9);
  const carbs_g = Math.max(0, Math.round((final_calories - protein_g * 4 - fat_g * 9) / 4));

  res.json({
    bmr: Math.round(bmr),
    base_tdee,
    activity_multiplier: activityMult,
    phase,
    phase_multiplier: phaseMult,
    formula_calories,
    inferred_tdee,
    adaptive_calories,
    final_calories,
    protein_g,
    fat_g,
    carbs_g,
    weight_trend,
    data_status,
    stabilization,
  });
});

module.exports = router;
