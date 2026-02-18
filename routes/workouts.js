const express = require('express');
const path = require('path');
const { get, all, run } = require('../db');
const router = express.Router();
const program = require(path.join(__dirname, '..', 'training-program.json'));

router.post('/', (req, res) => {
  const { cycle, weekNumber, workoutTemplateId, workoutName } = req.body;
  const result = run(
    'INSERT INTO workout_sessions (cycle, week_number, workout_template_id, workout_name) VALUES (?, ?, ?, ?)',
    [cycle, weekNumber, workoutTemplateId, workoutName]
  );
  const session = get('SELECT * FROM workout_sessions WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(session);
});

router.put('/:id/complete', (req, res) => {
  run("UPDATE workout_sessions SET completed_at = datetime('now') WHERE id = ?", [parseInt(req.params.id)]);
  const session = get('SELECT * FROM workout_sessions WHERE id = ?', [parseInt(req.params.id)]);
  res.json(session);
});

router.get('/recent', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const sessions = all('SELECT * FROM workout_sessions ORDER BY started_at DESC LIMIT ?', [limit]);
  res.json(sessions);
});

router.get('/status', (req, res) => {
  const cycle = parseInt(req.query.cycle);
  const week = parseInt(req.query.week);
  const completed = all(
    'SELECT workout_template_id, started_at, completed_at FROM workout_sessions WHERE cycle = ? AND week_number = ? AND completed_at IS NOT NULL',
    [cycle, week]
  );
  const skipped = all(
    'SELECT workout_template_id FROM workout_sessions WHERE cycle = ? AND week_number = ? AND skipped_at IS NOT NULL',
    [cycle, week]
  );
  res.json({
    completed: completed.map(s => s.workout_template_id),
    completedDetails: completed.map(s => ({
      templateId: s.workout_template_id,
      duration: s.started_at && s.completed_at ? Math.round((new Date(s.completed_at + 'Z') - new Date(s.started_at + 'Z')) / 60000) : null,
      completedAt: s.completed_at,
    })),
    skipped: skipped.map(s => s.workout_template_id),
  });
});

// Keep old endpoint for backwards compat
router.get('/completed', (req, res) => {
  const cycle = parseInt(req.query.cycle);
  const week = parseInt(req.query.week);
  const sessions = all(
    'SELECT workout_template_id FROM workout_sessions WHERE cycle = ? AND week_number = ? AND completed_at IS NOT NULL',
    [cycle, week]
  );
  res.json(sessions.map(s => s.workout_template_id));
});

router.put('/skip', (req, res) => {
  const { cycle, weekNumber, workoutTemplateId, workoutName } = req.body;
  const result = run(
    `INSERT INTO workout_sessions (cycle, week_number, workout_template_id, workout_name, skipped_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    [cycle, weekNumber, workoutTemplateId, workoutName]
  );
  const session = get('SELECT * FROM workout_sessions WHERE id = ?', [result.lastInsertRowid]);
  res.json(session);
});

router.put('/:id/unskip', (req, res) => {
  const id = parseInt(req.params.id);
  run('DELETE FROM workout_sessions WHERE id = ? AND skipped_at IS NOT NULL', [id]);
  res.json({ unskipped: true });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  run('DELETE FROM set_logs WHERE workout_session_id = ?', [id]);
  run('DELETE FROM workout_sessions WHERE id = ?', [id]);
  res.json({ deleted: true });
});

router.get('/first-incomplete-week', (req, res) => {
  const cycle = parseInt(req.query.cycle);
  for (let w = 1; w <= 12; w++) {
    const weekData = program.weeks.find(pw => pw.weekNumber === w);
    if (!weekData) continue;
    const totalWorkouts = weekData.workouts.length;
    const done = get(
      `SELECT COUNT(DISTINCT workout_template_id) as cnt FROM workout_sessions
       WHERE cycle = ? AND week_number = ?
       AND (completed_at IS NOT NULL OR skipped_at IS NOT NULL)`,
      [cycle, w]
    );
    if (done.cnt < totalWorkouts) {
      return res.json({ week: w });
    }
  }
  res.json({ week: 12 });
});

router.get('/active', (req, res) => {
  const session = get('SELECT * FROM workout_sessions WHERE completed_at IS NULL AND skipped_at IS NULL ORDER BY started_at DESC LIMIT 1');
  res.json(session || null);
});

module.exports = router;
