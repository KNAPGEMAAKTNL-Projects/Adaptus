const express = require('express');
const path = require('path');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/program', require('./routes/program'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/workouts', require('./routes/workouts'));
app.use('/api/sets', require('./routes/sets'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/weight', require('./routes/weight'));
app.use('/api/nutrition', require('./routes/nutrition'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Adaptus running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
