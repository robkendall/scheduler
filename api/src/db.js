require("dotenv").config();

const bcrypt = require("bcrypt");
const { Pool } = require("pg");

function shouldUseSsl() {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  const explicit = String(process.env.DATABASE_SSL || "").toLowerCase();

  if (sslMode === "require" || explicit === "true") {
    return true;
  }

  const databaseUrl = String(process.env.DATABASE_URL || "");
  return databaseUrl.includes("sslmode=require");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
});

const SUNDAY_SQL = "((EXTRACT(DOW FROM track_date)::int + 7) % 7)";

async function ensureColumn(table, column, definition) {
  await pool.query(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition};`,
  );
}

async function initializeSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("users", "username", "TEXT");
  await ensureColumn("users", "is_admin", "BOOLEAN NOT NULL DEFAULT FALSE");

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_username_key'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
      END IF;
    END
    $$;
  `);

  // --- Roles ---

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("roles", "external_source", "TEXT");
  await ensureColumn("roles", "external_role_kind", "TEXT");
  await ensureColumn("roles", "external_role_id", "TEXT");
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS roles_external_mapping_idx
    ON roles(external_source, external_role_kind, external_role_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
  `);

  await pool.query(`
    INSERT INTO roles (name)
    VALUES ('Production'), ('Kids'), ('Worship')
    ON CONFLICT (name) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      include_in_auto_schedule BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("people", "include_in_auto_schedule", "BOOLEAN NOT NULL DEFAULT TRUE");
  await ensureColumn("people", "role_id", "INTEGER REFERENCES roles(id) ON DELETE CASCADE");
  await ensureColumn("people", "external_source", "TEXT");
  await ensureColumn("people", "external_person_id", "TEXT");
  await ensureColumn("people", "max_weeks_per_month", "INTEGER NOT NULL DEFAULT 3");
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS people_external_mapping_idx
    ON people(role_id, external_source, external_person_id);
  `);

  await pool.query(`
    UPDATE people
    SET include_in_auto_schedule = TRUE
    WHERE include_in_auto_schedule IS DISTINCT FROM TRUE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS normal_weeks (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 5),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS normal_weeks_unique_person_week
    ON normal_weeks(person_id, week_number);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_out (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CHECK (start_date <= end_date)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS blocked_out_person_idx
    ON blocked_out(person_id, start_date, end_date);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS positions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT TRUE,
      priority INTEGER NOT NULL CHECK (priority >= 1),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("positions", "required", "BOOLEAN NOT NULL DEFAULT TRUE");
  await ensureColumn("positions", "role_id", "INTEGER REFERENCES roles(id) ON DELETE CASCADE");
  await ensureColumn("positions", "external_source", "TEXT");
  await ensureColumn("positions", "external_position_id", "TEXT");
  await ensureColumn("positions", "soft_deleted", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn("positions", "deleted_at", "TIMESTAMP");
  await ensureColumn("positions", "ignore_import", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn("positions", "can_double_up", "BOOLEAN NOT NULL DEFAULT FALSE");

  await pool.query(`
    UPDATE positions
    SET can_double_up = FALSE
    WHERE can_double_up IS NULL OR can_double_up != FALSE;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS positions_external_mapping_idx
    ON positions(role_id, external_source, external_position_id);
  `);

  // Replace global positions name unique with per-role unique
  await pool.query(`ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_name_key`);
  await pool.query(`DROP INDEX IF EXISTS positions_name_role_idx`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS positions_name_role_idx
    ON positions(name, role_id)
    WHERE soft_deleted = FALSE;
  `);

  await pool.query(`
    UPDATE positions
    SET required = TRUE
    WHERE required IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS person_positions (
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      rank_order INTEGER NOT NULL CHECK (rank_order >= 1),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (person_id, position_id)
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS person_positions_unique_rank
    ON person_positions(person_id, rank_order);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS person_positions_position_idx
    ON person_positions(position_id, person_id, rank_order);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS position_person_order (
      id SERIAL PRIMARY KEY,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
      rank_order INTEGER NOT NULL CHECK (rank_order >= 1),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pos_person_order_person_idx
    ON position_person_order(position_id, person_id)
    WHERE person_id IS NOT NULL;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pos_person_order_everyone_else_idx
    ON position_person_order(position_id)
    WHERE person_id IS NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS positions_priority_idx
    ON positions(priority, id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule (
      id SERIAL PRIMARY KEY,
      track_date DATE NOT NULL,
      week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 5),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("schedule", "role_id", "INTEGER REFERENCES roles(id) ON DELETE CASCADE");

  await pool.query(`
    UPDATE people
    SET role_id = (SELECT id FROM roles WHERE name = 'Production' LIMIT 1)
    WHERE role_id IS NULL;
  `);

  await pool.query(`
    UPDATE positions
    SET role_id = (SELECT id FROM roles WHERE name = 'Production' LIMIT 1)
    WHERE role_id IS NULL;
  `);

  await pool.query(`
    UPDATE schedule
    SET role_id = (SELECT id FROM roles WHERE name = 'Production' LIMIT 1)
    WHERE role_id IS NULL;
  `);

  await pool.query(`ALTER TABLE people ALTER COLUMN role_id SET NOT NULL`);
  await pool.query(`ALTER TABLE positions ALTER COLUMN role_id SET NOT NULL`);
  await pool.query(`ALTER TABLE schedule ALTER COLUMN role_id SET NOT NULL`);

  // Replace global track_date unique with per-role unique
  await pool.query(`ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_track_date_key`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS schedule_track_date_role_idx
    ON schedule(track_date, role_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS schedule_track_date_idx
    ON schedule (track_date);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS people_schedule (
      id SERIAL PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (schedule_id, position_id),
      UNIQUE (schedule_id, person_id, position_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS people_schedule_schedule_idx
    ON people_schedule(schedule_id, position_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS people_schedule_person_idx
    ON people_schedule(person_id, schedule_id);
  `);

  await pool.query(`
    ALTER TABLE schedule
    DROP CONSTRAINT IF EXISTS schedule_track_date_is_sunday;
  `);

  await pool.query(`
    ALTER TABLE schedule
    ADD CONSTRAINT schedule_track_date_is_sunday
    CHECK (${SUNDAY_SQL} = 0);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL PRIMARY KEY,
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  // Scheduler auth uses username/password; tolerate stray deacons columns.
  await ensureColumn("users", "username", "TEXT");
  await ensureColumn("users", "email", "TEXT");
  await ensureColumn("users", "name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("users", "type", "TEXT NOT NULL DEFAULT 'Other'");

  // Backfill missing usernames from email (or a deterministic fallback) so login works.
  await pool.query(`
    UPDATE users
    SET username = COALESCE(NULLIF(SPLIT_PART(email, '@', 1), ''), CONCAT('user', id))
    WHERE username IS NULL OR username = ''
  `);

  await pool.query(`ALTER TABLE users ALTER COLUMN username SET NOT NULL`);

  // Email should be optional in scheduler because user APIs only manage username.
  await pool.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`);

  const seedPasswordHash = await bcrypt.hash("asdf", 10);

  await pool.query(
    `INSERT INTO users (username, password_hash, is_admin)
         VALUES ($1, $2, $3)
         ON CONFLICT (username)
         DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            is_admin = EXCLUDED.is_admin`,
    ["rob", seedPasswordHash, true],
  );
}

initializeSchema().catch((error) => {
  console.error("Database schema initialization failed:", error);
  process.exit(1);
});

module.exports = pool;
