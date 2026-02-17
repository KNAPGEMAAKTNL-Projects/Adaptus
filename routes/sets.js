const express = require('express');
const { get, all, run } = require('../db');
const router = express.Router();

router.post('/', (req, res) => {
  const { workoutSessionId, exerciseId, exerciseName, setNumber, weightKg, reps, isLastSet, targetRpe, substitutionUsed, assistanceKg } = req.body;
  const result = run(
    `INSERT INTO set_logs (workout_session_id, exercise_id, exercise_name, set_number, weight_kg, reps, is_last_set, target_rpe, substitution_used, assistance_kg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [workoutSessionId, exerciseId, exerciseName, setNumber, weightKg, reps, isLastSet ? 1 : 0, targetRpe, substitutionUsed || null, assistanceKg || null]
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

router.get('/e1rm/:exerciseName', (req, res) => {
  const exerciseName = req.params.exerciseName;
  const sets = all(
    `SELECT weight_kg, reps, logged_at FROM set_logs WHERE exercise_name = ?`,
    [exerciseName]
  );
  if (!sets || sets.length === 0) return res.json(null);

  let best = null;
  for (const s of sets) {
    const e1rm = s.weight_kg * (1 + s.reps / 30);
    if (!best || e1rm > best.estimated1rm) {
      best = { estimated1rm: Math.round(e1rm * 10) / 10, fromWeight: s.weight_kg, fromReps: s.reps, loggedAt: s.logged_at };
    }
  }
  res.json(best);
});

router.get('/exercise-history/:exerciseName', (req, res) => {
  const exerciseName = req.params.exerciseName;
  const sessions = all(
    `SELECT sl.workout_session_id, ws.started_at as date, ws.cycle, ws.week_number,
            MAX(sl.weight_kg) as maxWeight,
            SUM(sl.weight_kg * sl.reps) as totalVolume
     FROM set_logs sl
     JOIN workout_sessions ws ON ws.id = sl.workout_session_id
     WHERE sl.exercise_name = ?
     GROUP BY sl.workout_session_id
     ORDER BY ws.started_at ASC`,
    [exerciseName]
  );

  const result = sessions.map(s => {
    const sets = all(
      `SELECT set_number, weight_kg, reps, assistance_kg, logged_at FROM set_logs
       WHERE workout_session_id = ? AND exercise_name = ?
       ORDER BY set_number ASC`,
      [s.workout_session_id, exerciseName]
    );
    let bestE1rm = 0;
    for (const set of sets) {
      const e1rm = set.weight_kg * (1 + set.reps / 30);
      if (e1rm > bestE1rm) bestE1rm = e1rm;
    }
    return {
      date: s.date,
      cycle: s.cycle,
      weekNumber: s.week_number,
      maxWeight: s.maxWeight,
      bestE1rm: Math.round(bestE1rm * 10) / 10,
      totalVolume: Math.round(s.totalVolume),
      sets,
    };
  });

  res.json(result);
});

router.put('/:id', (req, res) => {
  const { weightKg, reps, assistanceKg } = req.body;
  run(
    `UPDATE set_logs SET weight_kg = ?, reps = ?, assistance_kg = ? WHERE id = ?`,
    [weightKg, reps, assistanceKg || null, parseInt(req.params.id)]
  );
  const set = get('SELECT * FROM set_logs WHERE id = ?', [parseInt(req.params.id)]);
  res.json(set);
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM set_logs WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ deleted: true });
});

module.exports = router;
