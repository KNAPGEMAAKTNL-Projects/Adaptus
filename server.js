const express = require('express');
const path = require('path');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Prevent Cloudflare edge + browser from caching app files
// The service worker handles its own caching with versioned cache names
app.use((req, res, next) => {
  const url = req.path.toLowerCase();
  if (url === '/sw.js' || url === '/' || url === '/index.html' || url === '/app.js' || url === '/styles.css' || url === '/manifest.json') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

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
