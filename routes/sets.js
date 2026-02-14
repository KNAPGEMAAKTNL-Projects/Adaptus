const express = require('express');
const { get, all, run } = require('../db');
const router = express.Router();

router.post('/', (req, res) => {
  const { workoutSessionId, exerciseId, exerciseName, setNumber, weightKg, reps, isLastSet, targetRpe, substitutionUsed } = req.body;
  const result = run(
    `INSERT INTO set_logs (workout_session_id, exercise_id, exercise_name, set_number, weight_kg, reps, is_last_set, target_rpe, substitution_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [workoutSessionId, exerciseId, exerciseName, setNumber, weightKg, reps, isLastSet ? 1 : 0, targetRpe, substitutionUsed || null]
  );
  const set = get('SELECT * FROM set_logs WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(set);
});

router.get('/last-performance/:exerciseName', (req, res) => {
  const exerciseName = req.params.exerciseName;
  const sets = all(
    `SELECT sl.* FROM set_logs sl
     WHERE sl.exercise_name = ?
       AND sl.workout_session_id = (
         SELECT sl2.workout_session_id FROM set_logs sl2
         WHERE sl2.exercise_name = ?
         ORDER BY sl2.logged_at DESC
         LIMIT 1
       )
     ORDER BY sl.set_number ASC`,
    [exerciseName, exerciseName]
  );
  res.json(sets);
});

router.get('/session/:sessionId', (req, res) => {
  const sets = all('SELECT * FROM set_logs WHERE workout_session_id = ? ORDER BY exercise_id, set_number', [parseInt(req.params.sessionId)]);
  res.json(sets);
});

router.get('/pr/:exerciseName', (req, res) => {
  const pr = get(
    `SELECT exercise_name, weight_kg, reps, logged_at
     FROM set_logs
     WHERE exercise_name = ?
     ORDER BY weight_kg DESC, reps DESC
     LIMIT 1`,
    [req.params.exerciseName]
  );
  res.json(pr || null);
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM set_logs WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ deleted: true });
});

module.exports = router;
