const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'adaptus.db');

let db = null;
let dirty = false;

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  dirty = false;
}

// Auto-save every 30 seconds, but only if something changed
setInterval(() => { if (dirty) save(); }, 30000);

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS user_progress (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_cycle INTEGER NOT NULL DEFAULT 1,
      current_week INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`INSERT OR IGNORE INTO user_progress (id, current_cycle, current_week) VALUES (1, 1, 1)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS workout_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle INTEGER NOT NULL,
      week_number INTEGER NOT NULL,
      workout_template_id TEXT NOT NULL,
      workout_name TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      notes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS set_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_session_id INTEGER NOT NULL,
      exercise_id TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      set_number INTEGER NOT NULL,
      weight_kg REAL NOT NULL,
      reps INTEGER NOT NULL,
      is_last_set INTEGER NOT NULL DEFAULT 0,
      target_rpe TEXT,
      substitution_used TEXT,
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workout_session_id) REFERENCES workout_sessions(id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_name ON set_logs(exercise_name, logged_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_set_logs_session ON set_logs(workout_session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_workout_sessions_template ON workout_sessions(workout_template_id, started_at DESC)`);

  // Migration: add skipped_at column
  try {
    db.run(`ALTER TABLE workout_sessions ADD COLUMN skipped_at TEXT`);
  } catch (e) {
    // Column already exists
  }

  save();
  return db;
}

// Helper: run a query and return all rows as objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a query and return first row as object
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

// Helper: run an insert/update/delete and return lastInsertRowid
function run(sql, params = []) {
  db.run(sql, params);
  const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0];
  dirty = true;
  save();
  return { lastInsertRowid: lastId };
}

module.exports = { initDb, all, get, run, save };
