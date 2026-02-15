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

  const duration = get(`
    SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) as avg_duration_minutes
    FROM workout_sessions
    WHERE completed_at IS NOT NULL
  `);

  const prs = all(`
    SELECT exercise_name, MAX(weight_kg) as max_weight
    FROM set_logs
    GROUP BY exercise_name
    ORDER BY exercise_name ASC
  `);

  // Compute estimated 1RM per exercise
  for (const pr of prs) {
    const allSets = all(`SELECT weight_kg, reps FROM set_logs WHERE exercise_name = ?`, [pr.exercise_name]);
    let maxE1rm = 0;
    for (const s of allSets) {
      const e1rm = s.weight_kg * (1 + s.reps / 30);
      if (e1rm > maxE1rm) maxE1rm = e1rm;
    }
    pr.estimated_1rm = Math.round(maxE1rm * 10) / 10;
  }

  res.json({
    totalWorkouts: totals.total_workouts || 0,
    totalSets: totals.total_sets || 0,
    totalVolume: Math.round(totals.total_volume || 0),
    avgDuration: duration.avg_duration_minutes ? Math.round(duration.avg_duration_minutes) : null,
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

  const weekDuration = get(`
    SELECT SUM((julianday(completed_at) - julianday(started_at)) * 24 * 60) as total_duration_minutes
    FROM workout_sessions
    WHERE cycle = ? AND week_number = ? AND completed_at IS NOT NULL
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

  let prevCycle = cycle;
  let prevWeek = week - 1;
  if (prevWeek < 1) { prevCycle = cycle - 1; prevWeek = 12; }

  const prevStats = prevCycle >= 1 ? get(`
    SELECT COALESCE(SUM(sl.weight_kg * sl.reps), 0) as total_volume
    FROM workout_sessions ws
    LEFT JOIN set_logs sl ON sl.workout_session_id = ws.id
    WHERE ws.cycle = ? AND ws.week_number = ? AND ws.completed_at IS NOT NULL
  `, [prevCycle, prevWeek]) : null;

  res.json({
    workoutsCompleted: stats.workouts_completed || 0,
    workoutsSkipped: skippedCount?.cnt || 0,
    totalWorkouts: 5,
    totalSets: stats.total_sets || 0,
    totalVolume: Math.round(stats.total_volume || 0),
    totalDuration: weekDuration.total_duration_minutes ? Math.round(weekDuration.total_duration_minutes) : null,
    prevWeekVolume: prevStats ? Math.round(prevStats.total_volume || 0) : null,
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

router.get('/exercises', (req, res) => {
  const exercises = all(`
    SELECT
      exercise_name,
      COUNT(*) as total_sets,
      MAX(weight_kg) as best_weight,
      MAX(logged_at) as last_logged
    FROM set_logs
    GROUP BY exercise_name
    ORDER BY MAX(logged_at) DESC
  `);

  for (const ex of exercises) {
    const sets = all(`SELECT weight_kg, reps FROM set_logs WHERE exercise_name = ?`, [ex.exercise_name]);
    let maxE1rm = 0;
    for (const s of sets) {
      const e1rm = s.weight_kg * (1 + s.reps / 30);
      if (e1rm > maxE1rm) maxE1rm = e1rm;
    }
    ex.best_e1rm = Math.round(maxE1rm * 10) / 10;
  }

  res.json(exercises);
});

router.get('/recent-prs', (req, res) => {
  const prs = all(`
    SELECT sl.exercise_name, sl.weight_kg, sl.reps, MAX(sl.logged_at) as logged_at
    FROM set_logs sl
    WHERE sl.weight_kg = (
      SELECT MAX(s2.weight_kg) FROM set_logs s2 WHERE s2.exercise_name = sl.exercise_name
    )
    GROUP BY sl.exercise_name
    ORDER BY MAX(sl.logged_at) DESC
    LIMIT 3
  `);
  res.json(prs);
});

router.get('/estimate-duration/:templateId', (req, res) => {
  const exerciseNames = (req.query.exercises || '').split(',').map(decodeURIComponent).filter(Boolean);
  const setCounts = (req.query.sets || '').split(',').map(Number);

  if (exerciseNames.length === 0) return res.json({ estimatedMinutes: null });

  let totalSeconds = 0;
  const FALLBACK_SECONDS_PER_SET = 180;
  const TRANSITION_SECONDS = 90;

  for (let i = 0; i < exerciseNames.length; i++) {
    const name = exerciseNames[i];
    const sets = setCounts[i] || 3;

    const rows = all(`
      SELECT sl.workout_session_id, sl.set_number, sl.logged_at
      FROM set_logs sl
      JOIN workout_sessions ws ON ws.id = sl.workout_session_id
      WHERE sl.exercise_name = ? AND ws.completed_at IS NOT NULL
      ORDER BY sl.workout_session_id DESC, sl.set_number ASC
      LIMIT 50
    `, [name]);

    if (rows.length < 2) {
      totalSeconds += sets * FALLBACK_SECONDS_PER_SET + TRANSITION_SECONDS;
      continue;
    }

    const sessions = {};
    for (const r of rows) {
      if (!sessions[r.workout_session_id]) sessions[r.workout_session_id] = [];
      sessions[r.workout_session_id].push(r.logged_at);
    }

    const intervals = [];
    for (const sid of Object.keys(sessions)) {
      const timestamps = sessions[sid];
      for (let j = 1; j < timestamps.length; j++) {
        const diff = (new Date(timestamps[j]) - new Date(timestamps[j - 1])) / 1000;
        if (diff > 0 && diff < 600) intervals.push(diff);
      }
    }

    const avgPerSet = intervals.length > 0
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : FALLBACK_SECONDS_PER_SET;

    totalSeconds += sets * avgPerSet + TRANSITION_SECONDS;
  }

  res.json({ estimatedMinutes: Math.round(totalSeconds / 60) });
});

module.exports = router;
