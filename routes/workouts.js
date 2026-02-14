const express = require('express');
const { get, all, run } = require('../db');
const router = express.Router();

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
    'SELECT workout_template_id FROM workout_sessions WHERE cycle = ? AND week_number = ? AND completed_at IS NOT NULL',
    [cycle, week]
  );
  const skipped = all(
    'SELECT workout_template_id FROM workout_sessions WHERE cycle = ? AND week_number = ? AND skipped_at IS NOT NULL',
    [cycle, week]
  );
  res.json({
    completed: completed.map(s => s.workout_template_id),
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

router.get('/active', (req, res) => {
  const session = get('SELECT * FROM workout_sessions WHERE completed_at IS NULL AND skipped_at IS NULL ORDER BY started_at DESC LIMIT 1');
  res.json(session || null);
});

module.exports = router;
