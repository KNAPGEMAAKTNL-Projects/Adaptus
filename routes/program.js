const express = require('express');
const path = require('path');
const router = express.Router();

const program = require(path.join(__dirname, '..', 'training-program.json'));

router.get('/', (req, res) => {
  res.json(program);
});

router.get('/week/:weekNumber', (req, res) => {
  const week = program.weeks.find(w => w.weekNumber === parseInt(req.params.weekNumber));
  if (!week) return res.status(404).json({ error: 'Week not found' });
  res.json(week);
});

router.get('/week/:weekNumber/workout/:templateId', (req, res) => {
  const week = program.weeks.find(w => w.weekNumber === parseInt(req.params.weekNumber));
  if (!week) return res.status(404).json({ error: 'Week not found' });
  const workout = week.workouts.find(wo => wo.templateId === req.params.templateId);
  if (!workout) return res.status(404).json({ error: 'Workout not found' });
  res.json(workout);
});

module.exports = router;
