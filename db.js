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

  db.run(`
    CREATE TABLE IF NOT EXISTS body_weight (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weight_kg REAL NOT NULL,
      logged_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_body_weight_date ON body_weight(logged_at DESC)`);

  // Migration: add skipped_at column
  try {
    db.run(`ALTER TABLE workout_sessions ADD COLUMN skipped_at TEXT`);
  } catch (e) {
    // Column already exists
  }

  // Migration: add assistance_kg column for assisted exercises
  try {
    db.run(`ALTER TABLE set_logs ADD COLUMN assistance_kg REAL`);
  } catch (e) {
    // Column already exists
  }

  // Migration: add barcode column to foods
  try {
    db.run(`ALTER TABLE foods ADD COLUMN barcode TEXT`);
  } catch (e) {
    // Column already exists
  }

  // ─── Nutrition tables ───────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      calories REAL NOT NULL DEFAULT 0,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      serving_size REAL NOT NULL DEFAULT 100,
      serving_unit TEXT NOT NULL DEFAULT 'g',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS meal_foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meal_id INTEGER NOT NULL,
      food_id INTEGER NOT NULL,
      servings REAL NOT NULL DEFAULT 1,
      FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
      FOREIGN KEY (food_id) REFERENCES foods(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL DEFAULT (date('now')),
      meal_id INTEGER,
      food_id INTEGER,
      name TEXT NOT NULL,
      servings REAL NOT NULL DEFAULT 1,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meal_id) REFERENCES meals(id),
      FOREIGN KEY (food_id) REFERENCES foods(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_daily_log_date ON daily_log(date DESC)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS nutrition_targets (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      calories REAL NOT NULL DEFAULT 2500,
      protein REAL NOT NULL DEFAULT 180,
      carbs REAL NOT NULL DEFAULT 250,
      fat REAL NOT NULL DEFAULT 80
    )
  `);
  db.run(`INSERT OR IGNORE INTO nutrition_targets (id) VALUES (1)`);

  // ─── User profile (adaptive TDEE) ────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      gender TEXT NOT NULL DEFAULT 'male',
      age INTEGER NOT NULL DEFAULT 28,
      height_cm REAL NOT NULL DEFAULT 183,
      activity_level TEXT NOT NULL DEFAULT 'moderate',
      phase TEXT NOT NULL DEFAULT 'maintain',
      protein_per_kg REAL NOT NULL DEFAULT 2.0
    )
  `);
  db.run(`INSERT OR IGNORE INTO user_profile (id) VALUES (1)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS tdee_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      avg_calories REAL,
      avg_weight REAL,
      prev_avg_weight REAL,
      inferred_tdee REAL,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ─── Phases (calendar-based) ──────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase_type TEXT NOT NULL CHECK (phase_type IN ('cut', 'maintain', 'bulk')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (start_date < end_date)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_phases_dates ON phases(start_date, end_date)`);

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
