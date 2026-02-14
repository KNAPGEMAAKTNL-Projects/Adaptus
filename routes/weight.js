const express = require('express');
const { get, all, run } = require('../db');
const router = express.Router();

router.post('/', (req, res) => {
  const { weightKg } = req.body;
  const result = run('INSERT INTO body_weight (weight_kg) VALUES (?)', [weightKg]);
  const entry = get('SELECT * FROM body_weight WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(entry);
});

router.get('/latest', (req, res) => {
  const entry = get('SELECT * FROM body_weight ORDER BY logged_at DESC LIMIT 1');
  res.json(entry || null);
});

router.get('/summary', (req, res) => {
  const latest = get('SELECT * FROM body_weight ORDER BY logged_at DESC LIMIT 1');
  const avg7 = get(`
    SELECT AVG(weight_kg) as avg_weight, COUNT(*) as count
    FROM body_weight
    WHERE logged_at >= datetime('now', '-7 days')
  `);
  const avg7prev = get(`
    SELECT AVG(weight_kg) as avg_weight
    FROM body_weight
    WHERE logged_at >= datetime('now', '-14 days')
      AND logged_at < datetime('now', '-7 days')
  `);

  let trend = null;
  if (avg7?.avg_weight && avg7prev?.avg_weight) {
    const diff = avg7.avg_weight - avg7prev.avg_weight;
    if (diff > 0.2) trend = 'up';
    else if (diff < -0.2) trend = 'down';
    else trend = 'stable';
  }

  res.json({
    current: latest ? latest.weight_kg : null,
    currentDate: latest ? latest.logged_at : null,
    avg7day: avg7?.avg_weight ? Math.round(avg7.avg_weight * 10) / 10 : null,
    entries7day: avg7?.count || 0,
    trend,
  });
});

router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  const entries = all('SELECT * FROM body_weight ORDER BY logged_at DESC LIMIT ?', [limit]);
  res.json(entries.reverse());
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM body_weight WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ deleted: true });
});

module.exports = router;
