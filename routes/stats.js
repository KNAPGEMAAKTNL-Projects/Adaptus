const express = require('express');
const { get, all } = require('../db');
const router = express.Router();

router.get('/summary', (req, res) => {
  const totals = get(`
    SELECT
      COUNT(DISTINCT ws.id) as total_workouts,
      COALESCE(SUM(sl.weight_kg * sl.reps), 0) as total_volume,
      COUNT(sl.id) as total_sets
    FROM workout_sessions ws
    LEFT JOIN set_logs sl ON sl.workout_session_id = ws.id
    WHERE ws.completed_at IS NOT NULL
  `);

  const prs = all(`
    SELECT exercise_name, MAX(weight_kg) as max_weight
    FROM set_logs
    GROUP BY exercise_name
    ORDER BY exercise_name ASC
  `);

  res.json({
    totalWorkouts: totals.total_workouts || 0,
    totalSets: totals.total_sets || 0,
    totalVolume: Math.round(totals.total_volume || 0),
    prs,
  });
});

router.get('/week-summary', (req, res) => {
  const cycle = parseInt(req.query.cycle);
  const week = parseInt(req.query.week);

  const stats = get(`
    SELECT
      COUNT(DISTINCT ws.id) as workouts_completed,
      COALESCE(SUM(sl.weight_kg * sl.reps), 0) as total_volume,
      COUNT(sl.id) as total_sets
    FROM workout_sessions ws
    LEFT JOIN set_logs sl ON sl.workout_session_id = ws.id
    WHERE ws.cycle = ? AND ws.week_number = ? AND ws.completed_at IS NOT NULL
  `, [cycle, week]);

  const prsThisWeek = all(`
    SELECT sl.exercise_name, sl.weight_kg, sl.reps
    FROM set_logs sl
    JOIN workout_sessions ws ON ws.id = sl.workout_session_id
    WHERE ws.cycle = ? AND ws.week_number = ?
      AND sl.weight_kg = (
        SELECT MAX(s2.weight_kg) FROM set_logs s2 WHERE s2.exercise_name = sl.exercise_name
      )
      AND NOT EXISTS (
        SELECT 1 FROM set_logs s3
        JOIN workout_sessions w3 ON w3.id = s3.workout_session_id
        WHERE s3.exercise_name = sl.exercise_name
          AND s3.weight_kg >= sl.weight_kg
          AND NOT (w3.cycle = ? AND w3.week_number = ?)
      )
    GROUP BY sl.exercise_name
  `, [cycle, week, cycle, week]);

  const skippedCount = get(`
    SELECT COUNT(DISTINCT ws.id) as cnt
    FROM workout_sessions ws
    WHERE ws.cycle = ? AND ws.week_number = ? AND ws.skipped_at IS NOT NULL
  `, [cycle, week]);

  res.json({
    workoutsCompleted: stats.workouts_completed || 0,
    workoutsSkipped: skippedCount?.cnt || 0,
    totalWorkouts: 5,
    totalSets: stats.total_sets || 0,
    totalVolume: Math.round(stats.total_volume || 0),
    prsThisWeek,
  });
});

router.get('/streak', (req, res) => {
  const weeks = all(`
    SELECT cycle, week_number, COUNT(DISTINCT workout_template_id) as completed
    FROM workout_sessions
    WHERE completed_at IS NOT NULL
    GROUP BY cycle, week_number
    ORDER BY cycle DESC, week_number DESC
  `);

  let streak = 0;
  for (const w of weeks) {
    if (w.completed >= 5) {
      streak++;
    } else {
      break;
    }
  }
  res.json({ streak });
});

module.exports = router;
