const express = require('express');
const { get, run } = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const row = get('SELECT current_cycle, current_week, updated_at FROM user_progress WHERE id = 1');
  res.json({ cycle: row.current_cycle, week: row.current_week, updatedAt: row.updated_at });
});

router.put('/', (req, res) => {
  const { cycle, week } = req.body;
  run("UPDATE user_progress SET current_cycle = ?, current_week = ?, updated_at = datetime('now') WHERE id = 1", [cycle, week]);
  res.json({ cycle, week });
});

module.exports = router;
