require("dotenv").config();

const bcrypt = require("bcrypt");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const pool = require("./db");
const { makePlanningCenterClient } = require("./planningCenter");
const { prePopulateMonth } = require("./prepopulateMonth");
const { prePopulateMonthGroup } = require("./prepopulateMonthGroup");
const requireAuth = require("./middleware/auth");

const app = express();
app.set("trust proxy", true);
const PORT = Number(process.env.PORT || process.env.API_PORT || 3002);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (IS_PRODUCTION && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production.");
}

const corsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    return next();
  });
}

app.use(express.json());
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
    }),
    secret: SESSION_SECRET || "scheduler-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: process.env.SESSION_COOKIE_SAMESITE || "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  }),
);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function parseRoleExternalMapping(payload) {
  const hasExternalSource = Object.prototype.hasOwnProperty.call(payload || {}, "externalSource");
  const hasExternalRoleKind = Object.prototype.hasOwnProperty.call(payload || {}, "externalRoleKind");
  const hasExternalRoleId = Object.prototype.hasOwnProperty.call(payload || {}, "externalRoleId");
  const externalFieldsProvided = hasExternalSource || hasExternalRoleKind || hasExternalRoleId;

  const externalSource = normalizeOptionalText(payload.externalSource)?.toLowerCase() || null;
  const externalRoleKind = normalizeOptionalText(payload.externalRoleKind)?.toLowerCase() || null;
  const externalRoleId = normalizeOptionalText(payload.externalRoleId) || null;

  const providedCount = [hasExternalSource, hasExternalRoleKind, hasExternalRoleId].filter(Boolean).length;
  if (providedCount !== 0 && providedCount !== 3) {
    throw new Error("externalSource, externalRoleKind, and externalRoleId must be provided together.");
  }

  if (providedCount === 3) {
    const populatedCount = [externalSource, externalRoleKind, externalRoleId].filter(Boolean).length;
    if (populatedCount !== 3) {
      throw new Error("externalSource, externalRoleKind, and externalRoleId cannot be blank.");
    }
  }

  return {
    externalFieldsProvided,
    externalSource,
    externalRoleKind,
    externalRoleId,
  };
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseOptionalBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return null;
}

function parseApplyStrategy(value) {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "single_apply" || normalized === "group_apply") {
    return normalized;
  }
  return null;
}

function parseRoleApplySettings(payload) {
  const hasApplyStrategy = Object.prototype.hasOwnProperty.call(payload || {}, "applyStrategy");
  const hasGlobalMinAssignments = Object.prototype.hasOwnProperty.call(payload || {}, "globalMinAssignments");
  const hasGlobalMaxAssignments = Object.prototype.hasOwnProperty.call(payload || {}, "globalMaxAssignments");

  const applyStrategy = hasApplyStrategy ? parseApplyStrategy(payload.applyStrategy) : null;
  const globalMinAssignments = hasGlobalMinAssignments ? parseNonNegativeInt(payload.globalMinAssignments) : null;
  const globalMaxAssignments = hasGlobalMaxAssignments ? parseNonNegativeInt(payload.globalMaxAssignments) : null;

  if (hasApplyStrategy && !applyStrategy) {
    throw new Error("applyStrategy must be Single Apply or Group Apply.");
  }

  if (hasGlobalMinAssignments && globalMinAssignments === null) {
    throw new Error("globalMinAssignments must be a non-negative integer.");
  }

  if (hasGlobalMaxAssignments && globalMaxAssignments === null) {
    throw new Error("globalMaxAssignments must be a non-negative integer.");
  }

  const effectiveMin = globalMinAssignments ?? 1;
  const effectiveMax = globalMaxAssignments ?? effectiveMin;
  if ((hasGlobalMinAssignments || hasGlobalMaxAssignments) && effectiveMax < effectiveMin) {
    throw new Error("globalMaxAssignments must be greater than or equal to globalMinAssignments.");
  }

  return {
    applyFieldsProvided: hasApplyStrategy || hasGlobalMinAssignments || hasGlobalMaxAssignments,
    applyStrategy,
    globalMinAssignments,
    globalMaxAssignments,
  };
}

function weekNumberFromSunday(dateValue) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  return Math.floor((date.getUTCDate() - 1) / 7) + 1;
}

function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return null;
  }

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthZeroBased = Number(monthText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthZeroBased) || monthZeroBased < 0 || monthZeroBased > 11) {
    return null;
  }

  const first = new Date(Date.UTC(year, monthZeroBased, 1));
  const last = new Date(Date.UTC(year, monthZeroBased + 1, 0));

  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
    year,
    monthZeroBased,
  };
}

function sundayDatesForMonth(year, monthZeroBased) {
  const dates = [];
  const cursor = new Date(Date.UTC(year, monthZeroBased, 1));

  while (cursor.getUTCMonth() === monthZeroBased) {
    if (cursor.getUTCDay() === 0) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

async function refreshSessionUser(req) {
  const result = await pool.query(
    "SELECT id, username, is_admin FROM users WHERE id = $1",
    [req.session.userId],
  );

  const user = result.rows[0] || null;
  if (!user) {
    return null;
  }

  req.session.userName = user.username;
  req.session.userIsAdmin = user.is_admin;
  return user;
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await refreshSessionUser(req);
  if (!user?.is_admin) {
    return res.status(403).json({ error: "Admin access required." });
  }

  return next();
}

function handleServerError(res, context, error) {
  console.error(`${context}:`, error);
  return res.status(500).json({ error: `${context}.` });
}

// Validates roleId and checks access. Returns the numeric roleId or null (having already sent a response).
async function resolveRoleId(req, res) {
  const raw = req.query.roleId ?? req.body.roleId;
  const roleId = parsePositiveInt(raw);
  if (!roleId) {
    res.status(400).json({ error: "roleId is required." });
    return null;
  }

  if (req.session.userIsAdmin) {
    return roleId;
  }

  try {
    const access = await pool.query(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2",
      [req.session.userId, roleId],
    );
    if (access.rows.length === 0) {
      res.status(403).json({ error: "Access denied to this role." });
      return null;
    }
    return roleId;
  } catch (error) {
    handleServerError(res, "Role access check failed", error);
    return null;
  }
}

async function ensureRoleAccess(roleId, req, res) {
  if (req.session.userIsAdmin) {
    return true;
  }

  try {
    const access = await pool.query(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2",
      [req.session.userId, roleId],
    );
    if (access.rows.length === 0) {
      res.status(403).json({ error: "Access denied to this role." });
      return false;
    }
    return true;
  } catch (error) {
    handleServerError(res, "Role access check failed", error);
    return false;
  }
}

async function hasRoleScopedRecord(query, params) {
  const result = await pool.query(query, params);
  return result.rows.length > 0;
}

async function ensurePersonInRole(personId, roleId, res) {
  const ok = await hasRoleScopedRecord(
    "SELECT 1 FROM people WHERE id = $1 AND role_id = $2",
    [personId, roleId],
  );

  if (!ok) {
    res.status(404).json({ error: "Person not found." });
    return false;
  }

  return true;
}

async function ensurePositionInRole(positionId, roleId, res) {
  const ok = await hasRoleScopedRecord(
    "SELECT 1 FROM positions WHERE id = $1 AND role_id = $2 AND soft_deleted = FALSE",
    [positionId, roleId],
  );

  if (!ok) {
    res.status(404).json({ error: "Position not found." });
    return false;
  }

  return true;
}

async function ensureScheduleInRole(scheduleId, roleId, res) {
  const ok = await hasRoleScopedRecord(
    "SELECT 1 FROM schedule WHERE id = $1 AND role_id = $2",
    [scheduleId, roleId],
  );

  if (!ok) {
    res.status(404).json({ error: "Schedule row not found." });
    return false;
  }

  return true;
}

async function ensureAssignmentInRole(assignmentId, roleId, res) {
  const ok = await hasRoleScopedRecord(
    `SELECT 1
     FROM people_schedule ps
     JOIN schedule s ON s.id = ps.schedule_id
     WHERE ps.id = $1 AND s.role_id = $2`,
    [assignmentId, roleId],
  );

  if (!ok) {
    res.status(404).json({ error: "People schedule assignment not found." });
    return false;
  }

  return true;
}

async function getPositionCapacityForSchedule(client, scheduleId, positionId, roleId, excludedAssignmentId = null) {
  const result = await client.query(
    `SELECT pos.name,
            pos.allows_multiple_assignments,
            pos.max_assignments,
            COUNT(ps.id) FILTER (WHERE $4::int IS NULL OR ps.id <> $4)::int AS assigned_count
     FROM positions pos
     JOIN schedule s ON s.id = $1 AND s.role_id = $3
     LEFT JOIN people_schedule ps ON ps.schedule_id = s.id AND ps.position_id = pos.id
     WHERE pos.id = $2 AND pos.role_id = $3 AND pos.soft_deleted = FALSE
     GROUP BY pos.id, pos.name, pos.allows_multiple_assignments, pos.max_assignments`,
    [scheduleId, positionId, roleId, excludedAssignmentId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    name: row.name,
    allowsMultipleAssignments: !!row.allows_multiple_assignments,
    maxAssignments: Number.isInteger(row.max_assignments) ? row.max_assignments : 1,
    assignedCount: row.assigned_count,
  };
}

app.get("/api/health", async (_req, res) => {
  const result = await pool.query("SELECT NOW() AS now");
  res.json({
    status: "ok",
    service: "scheduler-api",
    time: result.rows[0].now,
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({ ok: true });
  } catch (_error) {
    return res.status(503).json({ ok: false, error: "database unavailable" });
  }
});

app.get("/api/me", async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const user = await refreshSessionUser(req);
  if (!user) {
    req.session.destroy(() => { });
    return res.json({ user: null });
  }

  try {
    const rolesResult = user.is_admin
      ? await pool.query("SELECT id, name, apply_strategy, global_min_assignments, global_max_assignments FROM roles ORDER BY name ASC")
      : await pool.query(
        `SELECT r.id, r.name, r.apply_strategy, r.global_min_assignments, r.global_max_assignments
           FROM roles r
           JOIN user_roles ur ON ur.role_id = r.id
           WHERE ur.user_id = $1
           ORDER BY r.name ASC`,
        [user.id],
      );

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.is_admin,
        roles: rolesResult.rows,
      },
    });
  } catch (error) {
    return handleServerError(res, "Failed to load user roles", error);
  }
});

app.post("/api/login", async (req, res) => {
  const username = normalizeText(req.body.username).toLowerCase();
  const password = String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash, is_admin FROM users WHERE LOWER(username) = $1",
      [username],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    req.session.userId = user.id;
    req.session.userName = user.username;
    req.session.userIsAdmin = user.is_admin;

    const rolesResult = user.is_admin
      ? await pool.query("SELECT id, name, apply_strategy, global_min_assignments, global_max_assignments FROM roles ORDER BY name ASC")
      : await pool.query(
        `SELECT r.id, r.name, r.apply_strategy, r.global_min_assignments, r.global_max_assignments
           FROM roles r
           JOIN user_roles ur ON ur.role_id = r.id
           WHERE ur.user_id = $1
           ORDER BY r.name ASC`,
        [user.id],
      );

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.is_admin,
        roles: rolesResult.rows,
      },
    });
  } catch (error) {
    return handleServerError(res, "Login failed", error);
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("connect.sid");
    return res.json({ ok: true });
  });
});

app.get("/api/dashboard", requireAuth, async (req, res) => {
  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const [peopleCount, positionCount, scheduleCount, nextEntries] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM people WHERE role_id = $1", [roleId]),
      pool.query("SELECT COUNT(*)::int AS count FROM positions WHERE role_id = $1 AND soft_deleted = FALSE", [roleId]),
      pool.query("SELECT COUNT(*)::int AS count FROM schedule WHERE role_id = $1", [roleId]),
      pool.query(
        `SELECT s.id, s.track_date, s.week_number,
                COUNT(ps.id)::int AS assignment_count
         FROM schedule s
         LEFT JOIN people_schedule ps ON ps.schedule_id = s.id
         WHERE s.track_date >= CURRENT_DATE AND s.role_id = $1
         GROUP BY s.id
         ORDER BY s.track_date ASC
         LIMIT 6`,
        [roleId],
      ),
    ]);

    return res.json({
      counts: {
        people: peopleCount.rows[0].count,
        positions: positionCount.rows[0].count,
        schedules: scheduleCount.rows[0].count,
      },
      upcoming: nextEntries.rows,
    });
  } catch (error) {
    return handleServerError(res, "Failed to load dashboard", error);
  }
});

app.get("/api/users", requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, is_admin, created_at
       FROM users
       ORDER BY username ASC`,
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load users", error);
  }
});

app.get("/api/users/:id", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, is_admin, created_at
       FROM users
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load user", error);
  }
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const username = normalizeText(req.body.username).toLowerCase();
  const password = String(req.body.password || "");
  const isAdmin = Boolean(req.body.isAdmin);

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, is_admin)
       VALUES ($1, $2, $3)
       RETURNING id, username, is_admin, created_at`,
      [username, passwordHash, isAdmin],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Username already exists." });
    }

    return handleServerError(res, "Failed to create user", error);
  }
});

app.put("/api/users/:id", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const username = normalizeText(req.body.username).toLowerCase();
  const password = String(req.body.password || "");
  const hasPassword = Boolean(password);
  const isAdmin = Boolean(req.body.isAdmin);

  if (!id || !username) {
    return res.status(400).json({ error: "Valid ID and username are required." });
  }

  try {
    let result;
    if (hasPassword) {
      const passwordHash = await bcrypt.hash(password, 10);
      result = await pool.query(
        `UPDATE users
         SET username = $1,
             is_admin = $2,
             password_hash = $3
         WHERE id = $4
         RETURNING id, username, is_admin, created_at`,
        [username, isAdmin, passwordHash, id],
      );
    } else {
      result = await pool.query(
        `UPDATE users
         SET username = $1,
             is_admin = $2
         WHERE id = $3
         RETURNING id, username, is_admin, created_at`,
        [username, isAdmin, id],
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    if (req.session.userId === id) {
      req.session.userName = result.rows[0].username;
      req.session.userIsAdmin = result.rows[0].is_admin;
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Username already exists." });
    }

    return handleServerError(res, "Failed to update user", error);
  }
});

app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  if (req.session.userId === id) {
    return res.status(400).json({ error: "You cannot delete your own account." });
  }

  try {
    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete user", error);
  }
});

// --- Planning Center admin ---

function getPlanningCenterClient() {
  return makePlanningCenterClient({
    appId: process.env.PCO_APP_ID || process.env.PCO_CLIENT_ID,
    secret: process.env.PCO_SECRET || process.env.PCO_CLIENT_SECRET,
    authToken: process.env.PCO_AUTH_TOKEN,
  });
}

async function loadPlanningCenterMappedRole(roleId) {
  const roleResult = await pool.query(
    `SELECT id, name, external_source, external_role_kind, external_role_id
     FROM roles
     WHERE id = $1`,
    [roleId],
  );

  const role = roleResult.rows[0] || null;
  if (!role) {
    const error = new Error("Role not found.");
    error.status = 404;
    throw error;
  }

  if (role.external_source !== "planning_center" || role.external_role_kind !== "services_team" || !role.external_role_id) {
    const error = new Error("Role must be mapped to Planning Center Services Team (externalSource=planning_center, externalRoleKind=services_team, externalRoleId=<team id>)."
    );
    error.status = 400;
    throw error;
  }

  return role;
}

function planningCenterBlockoutKey(personId, externalBlockoutId, externalBlockoutDateId) {
  return `${personId}:${externalBlockoutId || ""}:${externalBlockoutDateId || ""}`;
}

function planningCenterBlockoutRangeKey(personId, startDate, endDate) {
  return `${personId}:${startDate}:${endDate}`;
}

async function syncPlanningCenterBlockedOutDates(client, roleId, localPersonIdByExternal, blockoutRangesByPerson) {
  const today = new Date().toISOString().slice(0, 10);
  const importedPersonIds = [...new Set([...localPersonIdByExternal.values()])];
  const remoteByKey = new Map();

  for (const [externalPersonId, ranges] of blockoutRangesByPerson.entries()) {
    const personId = localPersonIdByExternal.get(externalPersonId);
    if (!personId) {
      // eslint-disable-next-line no-continue
      continue;
    }

    for (const range of ranges) {
      if (!range?.externalBlockoutId || range.endDate < today) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const key = planningCenterBlockoutKey(personId, range.externalBlockoutId, range.externalBlockoutDateId);
      remoteByKey.set(key, {
        personId,
        startDate: range.startDate,
        endDate: range.endDate,
        externalBlockoutId: range.externalBlockoutId,
        externalBlockoutDateId: range.externalBlockoutDateId || null,
      });
    }
  }

  if (importedPersonIds.length === 0) {
    return {
      futureRemoteRanges: remoteByKey.size,
      inserted: 0,
      updated: 0,
      deleted: 0,
      matchedLegacy: 0,
    };
  }

  const trackedExistingResult = await client.query(
    `SELECT b.id, b.person_id, b.start_date, b.end_date, b.external_blockout_id, b.external_blockout_date_id
     FROM blocked_out b
     JOIN people p ON p.id = b.person_id
     WHERE p.role_id = $1
       AND b.person_id = ANY($2::int[])
       AND b.end_date >= $3
       AND b.external_source = 'planning_center'`,
    [roleId, importedPersonIds, today],
  );
  const trackedByKey = new Map(
    trackedExistingResult.rows.map((row) => [
      planningCenterBlockoutKey(row.person_id, row.external_blockout_id, row.external_blockout_date_id),
      row,
    ]),
  );

  const legacyRowsResult = await client.query(
    `SELECT id, person_id, start_date, end_date
     FROM blocked_out
     WHERE person_id = ANY($1::int[])
       AND end_date >= $2
       AND external_source IS NULL`,
    [importedPersonIds, today],
  );
  const legacyByRangeKey = new Map();
  legacyRowsResult.rows.forEach((row) => {
    const key = planningCenterBlockoutRangeKey(row.person_id, row.start_date, row.end_date);
    if (!legacyByRangeKey.has(key)) {
      legacyByRangeKey.set(key, row);
    }
  });

  let inserted = 0;
  let updated = 0;
  let matchedLegacy = 0;

  for (const [key, remote] of remoteByKey.entries()) {
    const existing = trackedByKey.get(key);
    if (existing) {
      if (existing.start_date !== remote.startDate || existing.end_date !== remote.endDate) {
        await client.query(
          `UPDATE blocked_out
           SET start_date = $1,
               end_date = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [remote.startDate, remote.endDate, existing.id],
        );
        updated += 1;
      }
      // eslint-disable-next-line no-continue
      continue;
    }

    const legacyKey = planningCenterBlockoutRangeKey(remote.personId, remote.startDate, remote.endDate);
    const legacy = legacyByRangeKey.get(legacyKey);
    if (legacy) {
      await client.query(
        `UPDATE blocked_out
         SET external_source = 'planning_center',
             external_blockout_id = $1,
             external_blockout_date_id = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [remote.externalBlockoutId, remote.externalBlockoutDateId, legacy.id],
      );
      matchedLegacy += 1;
      legacyByRangeKey.delete(legacyKey);
      // eslint-disable-next-line no-continue
      continue;
    }

    await client.query(
      `INSERT INTO blocked_out (
         person_id,
         start_date,
         end_date,
         external_source,
         external_blockout_id,
         external_blockout_date_id
       )
       VALUES ($1, $2, $3, 'planning_center', $4, $5)`,
      [remote.personId, remote.startDate, remote.endDate, remote.externalBlockoutId, remote.externalBlockoutDateId],
    );
    inserted += 1;
  }

  const deleteIds = trackedExistingResult.rows
    .filter((row) => !remoteByKey.has(planningCenterBlockoutKey(row.person_id, row.external_blockout_id, row.external_blockout_date_id)))
    .map((row) => row.id);

  if (deleteIds.length > 0) {
    await client.query("DELETE FROM blocked_out WHERE id = ANY($1::int[])", [deleteIds]);
  }

  return {
    futureRemoteRanges: remoteByKey.size,
    inserted,
    updated,
    deleted: deleteIds.length,
    matchedLegacy,
  };
}

app.get("/api/planning-center/health", requireAdmin, async (_req, res) => {
  try {
    const planningCenterClient = getPlanningCenterClient();
    const health = await planningCenterClient.getConnectionHealth();
    return res.json(health);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/planning-center/teams", requireAdmin, async (_req, res) => {
  try {
    const planningCenterClient = getPlanningCenterClient();
    const teams = await planningCenterClient.listTeams();
    return res.json(teams);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/planning-center/service-types", requireAdmin, async (_req, res) => {
  try {
    const planningCenterClient = getPlanningCenterClient();
    const serviceTypes = await planningCenterClient.listServiceTypes();
    return res.json(serviceTypes);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/api/planning-center/teams/:teamId/members", requireAdmin, async (req, res) => {
  const teamId = normalizeText(req.params.teamId);
  if (!teamId) {
    return res.status(400).json({ error: "Team ID is required." });
  }

  try {
    const planningCenterClient = getPlanningCenterClient();
    const members = await planningCenterClient.listTeamMembers(teamId);
    return res.json(members);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// --- Roles ---

app.get("/api/roles", requireAuth, async (req, res) => {
  try {
    const result = req.session.userIsAdmin
      ? await pool.query(
        `SELECT id, name, created_at, external_source, external_role_kind, external_role_id,
                apply_strategy, global_min_assignments, global_max_assignments
         FROM roles
         ORDER BY name ASC`,
      )
      : await pool.query(
        `SELECT r.id, r.name, r.created_at, r.external_source, r.external_role_kind, r.external_role_id,
                r.apply_strategy, r.global_min_assignments, r.global_max_assignments
         FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = $1
         ORDER BY r.name ASC`,
        [req.session.userId],
      );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load roles", error);
  }
});

app.post("/api/roles", requireAdmin, async (req, res) => {
  const name = normalizeText(req.body.name);
  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }

  let mapping;
  try {
    mapping = parseRoleExternalMapping(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let applySettings;
  try {
    applySettings = parseRoleApplySettings(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const result = await pool.query(
      `INSERT INTO roles (
         name,
         external_source,
         external_role_kind,
         external_role_id,
         apply_strategy,
         global_min_assignments,
         global_max_assignments
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, created_at, external_source, external_role_kind, external_role_id,
                 apply_strategy, global_min_assignments, global_max_assignments`,
      [
        name,
        mapping.externalSource,
        mapping.externalRoleKind,
        mapping.externalRoleId,
        applySettings.applyStrategy || "single_apply",
        applySettings.globalMinAssignments ?? 1,
        applySettings.globalMaxAssignments ?? Math.max(applySettings.globalMinAssignments ?? 1, 1),
      ],
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Role name or external mapping already exists." });
    }
    return handleServerError(res, "Failed to create role", error);
  }
});

app.put("/api/roles/:id", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const name = normalizeText(req.body.name);
  if (!id || !name) {
    return res.status(400).json({ error: "Valid ID and name are required." });
  }

  let mapping;
  try {
    mapping = parseRoleExternalMapping(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let applySettings;
  try {
    applySettings = parseRoleApplySettings(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const result = await pool.query(
      `UPDATE roles
       SET name = $1,
           external_source = CASE WHEN $2 THEN $3 ELSE external_source END,
           external_role_kind = CASE WHEN $2 THEN $4 ELSE external_role_kind END,
           external_role_id = CASE WHEN $2 THEN $5 ELSE external_role_id END,
           apply_strategy = COALESCE($6, apply_strategy),
           global_min_assignments = COALESCE($7, global_min_assignments),
           global_max_assignments = COALESCE($8, global_max_assignments)
       WHERE id = $9
       RETURNING id, name, created_at, external_source, external_role_kind, external_role_id,
                 apply_strategy, global_min_assignments, global_max_assignments`,
      [
        name,
        mapping.externalFieldsProvided,
        mapping.externalSource,
        mapping.externalRoleKind,
        mapping.externalRoleId,
        applySettings.applyStrategy,
        applySettings.globalMinAssignments,
        applySettings.globalMaxAssignments,
        id,
      ],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Role not found." });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Role name or external mapping already exists." });
    }
    return handleServerError(res, "Failed to update role", error);
  }
});

app.post("/api/roles/:id/import-planning-center", requireAdmin, async (req, res) => {
  const roleId = parsePositiveInt(req.params.id);
  if (!roleId) {
    return res.status(400).json({ error: "Valid role ID is required." });
  }

  let role;
  try {
    role = await loadPlanningCenterMappedRole(roleId);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return handleServerError(res, "Failed to load role mapping", error);
  }

  let bundle;
  try {
    const planningCenterClient = getPlanningCenterClient();
    bundle = await planningCenterClient.loadTeamBundle(role.external_role_id);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const nextPriorityResult = await client.query(
      "SELECT COALESCE(MAX(priority), 0)::int + 1 AS next_priority FROM positions WHERE role_id = $1 AND soft_deleted = FALSE",
      [role.id],
    );
    let nextImportedPriority = nextPriorityResult.rows[0].next_priority;

    const localPositionIdByExternal = new Map();
    for (const position of bundle.positions) {
      const result = await client.query(
        `WITH upserted AS (
           INSERT INTO positions (
           name,
           required,
           priority,
           role_id,
           external_source,
           external_position_id,
           updated_at
         )
         VALUES ($1, TRUE, $4, $2, 'planning_center', $3, NOW())
         ON CONFLICT (role_id, external_source, external_position_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = NOW()
         WHERE positions.soft_deleted = FALSE
           AND positions.ignore_import = FALSE
         RETURNING id
         )
         SELECT id FROM upserted
         UNION ALL
         SELECT p.id
         FROM positions p
         WHERE p.role_id = $2
           AND p.external_source = 'planning_center'
           AND p.external_position_id = $3
           AND p.soft_deleted = FALSE
           AND p.ignore_import = FALSE
         LIMIT 1`,
        [position.name, role.id, position.id, nextImportedPriority],
      );

      if (result.rows.length > 0) {
        localPositionIdByExternal.set(position.id, result.rows[0].id);
      }

      nextImportedPriority += 1;
    }

    const localPersonIdByExternal = new Map();
    for (const person of bundle.people) {
      const result = await client.query(
        `INSERT INTO people (
           name,
           include_in_auto_schedule,
           role_id,
           external_source,
           external_person_id,
           updated_at
         )
         VALUES ($1, TRUE, $2, 'planning_center', $3, NOW())
         ON CONFLICT (role_id, external_source, external_person_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = NOW()
         RETURNING id`,
        [person.name, role.id, person.id],
      );

      localPersonIdByExternal.set(person.id, result.rows[0].id);
    }

    const localPositionIdByName = new Map();
    for (const position of bundle.positions) {
      const localPositionId = localPositionIdByExternal.get(position.id);
      if (!localPositionId) {
        continue;
      }
      const normalizedName = String(position.name || "").trim().toLowerCase();
      if (normalizedName) {
        localPositionIdByName.set(normalizedName, localPositionId);
      }
    }

    const importedPersonIds = Array.from(localPersonIdByExternal.values());
    const externalPersonIdByLocal = new Map(
      [...localPersonIdByExternal.entries()].map(([ext, local]) => [local, ext]),
    );

    if (importedPersonIds.length > 0) {
      await client.query("DELETE FROM person_positions WHERE person_id = ANY($1::int[])", [importedPersonIds]);
      await client.query("DELETE FROM blocked_out WHERE person_id = ANY($1::int[])", [importedPersonIds]);
    }

    const rankedPositionsByPerson = new Map();
    for (const assignment of bundle.assignments) {
      const personId = localPersonIdByExternal.get(assignment.personId);
      const positionId = localPositionIdByExternal.get(assignment.positionId);
      if (!personId || !positionId) {
        continue;
      }

      if (!rankedPositionsByPerson.has(personId)) {
        rankedPositionsByPerson.set(personId, []);
      }

      const positionsForPerson = rankedPositionsByPerson.get(personId);
      if (!positionsForPerson.includes(positionId)) {
        positionsForPerson.push(positionId);
      }
    }

    let assignmentsInserted = 0;
    for (const [personId, positionIds] of rankedPositionsByPerson.entries()) {
      for (let index = 0; index < positionIds.length; index += 1) {
        await client.query(
          `INSERT INTO person_positions (person_id, position_id, rank_order)
           VALUES ($1, $2, $3)
           ON CONFLICT (person_id, position_id)
           DO UPDATE SET
             rank_order = EXCLUDED.rank_order,
             updated_at = NOW()`,
          [personId, positionIds[index], index + 1],
        );
        assignmentsInserted += 1;
      }
    }

    let blockedOutInserted = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const [externalPersonId, ranges] of bundle.blockoutRangesByPerson.entries()) {
      const personId = localPersonIdByExternal.get(externalPersonId);
      if (!personId) {
        continue;
      }

      for (const range of ranges) {
        if (range.endDate < today) {
          continue;
        }

        await client.query(
          `INSERT INTO blocked_out (
             person_id,
             start_date,
             end_date,
             external_source,
             external_blockout_id,
             external_blockout_date_id
           )
           VALUES ($1, $2, $3, 'planning_center', $4, $5)`,
          [personId, range.startDate, range.endDate, range.externalBlockoutId || null, range.externalBlockoutDateId || null],
        );
        blockedOutInserted += 1;
      }
    }

    let schedulesImported = 0;
    let scheduleAssignmentsImported = 0;
    const scheduleIdByDate = new Map();

    for (const item of (bundle.scheduledAssignments || [])) {
      const localPersonId = localPersonIdByExternal.get(item.personId);
      if (!localPersonId) {
        continue;
      }

      const normalizedPositionName = String(item.positionName || "").trim().toLowerCase();
      const localPositionId = localPositionIdByName.get(normalizedPositionName);
      if (!localPositionId) {
        continue;
      }

      const trackDate = normalizeDate(item.trackDate);
      if (!trackDate) {
        continue;
      }

      // Local schema only stores Sunday rows in schedule.
      const weekday = new Date(`${trackDate}T12:00:00Z`).getUTCDay();
      if (weekday !== 0) {
        continue;
      }

      let scheduleId = scheduleIdByDate.get(trackDate);
      if (!scheduleId) {
        const weekNumber = weekNumberFromSunday(trackDate);
        const scheduleResult = await client.query(
          `INSERT INTO schedule (track_date, week_number, role_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (track_date, role_id)
           DO UPDATE SET
             week_number = EXCLUDED.week_number,
             updated_at = NOW()
           RETURNING id`,
          [trackDate, weekNumber, role.id],
        );
        scheduleId = scheduleResult.rows[0].id;
        scheduleIdByDate.set(trackDate, scheduleId);
        schedulesImported += 1;
      }

      await client.query(
        `INSERT INTO people_schedule (schedule_id, person_id, position_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (schedule_id, position_id)
         DO UPDATE SET
           person_id = EXCLUDED.person_id,
           updated_at = NOW()`,
        [scheduleId, localPersonId, localPositionId],
      );
      scheduleAssignmentsImported += 1;
    }

    // For imported people with no normal_weeks set, infer their typical weeks
    // from their scheduling history so auto-scheduling works out of the box.
    const peopleWithPcoHistory = bundle.scheduledWeeksByPerson?.size ?? 0;
    const pcoWeeksDiscovered = Array.from(bundle.scheduledWeeksByPerson?.values() ?? [])
      .reduce((sum, weeks) => sum + weeks.length, 0);

    let normalWeeksInferred = 0;
    if (importedPersonIds.length > 0) {
      const noWeeksResult = await client.query(
        `SELECT id FROM people
         WHERE id = ANY($1::int[])
           AND NOT EXISTS (
             SELECT 1 FROM normal_weeks nw WHERE nw.person_id = people.id
           )`,
        [importedPersonIds],
      );

      for (const row of noWeeksResult.rows) {
        const historyResult = await client.query(
          `SELECT DISTINCT s.week_number
           FROM people_schedule ps
           JOIN schedule s ON s.id = ps.schedule_id
           WHERE ps.person_id = $1
           ORDER BY s.week_number`,
          [row.id],
        );

        let weekNumbers = historyResult.rows.map((r) => r.week_number);

        // Fall back to PCO scheduling history when no local history exists yet.
        if (weekNumbers.length === 0) {
          const extId = externalPersonIdByLocal.get(row.id);
          const pcoWeeks = extId ? bundle.scheduledWeeksByPerson?.get(extId) : null;
          if (pcoWeeks?.length) {
            weekNumbers = pcoWeeks;
          }
        }

        for (const weekNumber of weekNumbers) {
          await client.query(
            `INSERT INTO normal_weeks (person_id, week_number)
             VALUES ($1, $2)
             ON CONFLICT (person_id, week_number) DO NOTHING`,
            [row.id, weekNumber],
          );
          normalWeeksInferred += 1;
        }
      }
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      roleId: role.id,
      roleName: role.name,
      imported: {
        people: localPersonIdByExternal.size,
        positions: localPositionIdByExternal.size,
        personPositionAssignments: assignmentsInserted,
        blockedOutRanges: blockedOutInserted,
        schedulesImported,
        scheduleAssignmentsImported,
        peopleWithPcoHistory,
        pcoWeeksDiscovered,
        normalWeeksInferred,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Planning Center import failed", error);
  } finally {
    client.release();
  }
});

app.post("/api/roles/:id/sync-planning-center-blockouts", requireAuth, async (req, res) => {
  const roleId = parsePositiveInt(req.params.id);
  if (!roleId) {
    return res.status(400).json({ error: "Valid role ID is required." });
  }

  if (!(await ensureRoleAccess(roleId, req, res))) {
    return;
  }

  let role;
  try {
    role = await loadPlanningCenterMappedRole(roleId);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    return handleServerError(res, "Failed to load role mapping", error);
  }

  let blockoutBundle;
  try {
    const planningCenterClient = getPlanningCenterClient();
    blockoutBundle = await planningCenterClient.loadTeamBlockoutBundle(role.external_role_id);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const localPersonIdByExternal = new Map();
    for (const person of blockoutBundle.people) {
      const result = await client.query(
        `INSERT INTO people (
           name,
           include_in_auto_schedule,
           role_id,
           external_source,
           external_person_id,
           updated_at
         )
         VALUES ($1, TRUE, $2, 'planning_center', $3, NOW())
         ON CONFLICT (role_id, external_source, external_person_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = NOW()
         RETURNING id`,
        [person.name, role.id, person.id],
      );

      localPersonIdByExternal.set(person.id, result.rows[0].id);
    }

    const syncSummary = await syncPlanningCenterBlockedOutDates(
      client,
      role.id,
      localPersonIdByExternal,
      blockoutBundle.blockoutRangesByPerson,
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      roleId: role.id,
      roleName: role.name,
      sync: {
        peopleSeen: blockoutBundle.people.length,
        ...syncSummary,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Planning Center blockout sync failed", error);
  } finally {
    client.release();
  }
});

app.delete("/api/roles/:id", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM roles WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Role not found." });
    }
    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete role", error);
  }
});

// --- User roles ---

app.get("/api/users/:id/roles", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid user ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT r.id, r.name
       FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1
       ORDER BY r.name ASC`,
      [id],
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load user roles", error);
  }
});

app.put("/api/users/:id/roles", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const roleIds = Array.isArray(req.body.roleIds)
    ? req.body.roleIds.map((v) => parsePositiveInt(v)).filter(Boolean)
    : [];

  if (!id) {
    return res.status(400).json({ error: "Valid user ID is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_roles WHERE user_id = $1", [id]);
    for (const roleId of roleIds) {
      await client.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [id, roleId],
      );
    }
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to update user roles", error);
  } finally {
    client.release();
  }
});

app.get("/api/people", requireAuth, async (req, res) => {
  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT id, name, include_in_auto_schedule, max_weeks_per_month, created_at, updated_at
       FROM people
       WHERE role_id = $1
       ORDER BY name ASC`,
      [roleId],
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load people", error);
  }
});

app.get("/api/people/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT id, name, include_in_auto_schedule, max_weeks_per_month, created_at, updated_at
       FROM people
       WHERE id = $1 AND role_id = $2`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Person not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load person", error);
  }
});

app.post("/api/people", requireAuth, async (req, res) => {
  const name = normalizeText(req.body.name);
  const includeInAutoSchedule = true;
  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `INSERT INTO people (name, include_in_auto_schedule, max_weeks_per_month, role_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, include_in_auto_schedule, max_weeks_per_month, created_at, updated_at`,
      [name, includeInAutoSchedule, 3, roleId],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to create person", error);
  }
});

app.put("/api/people/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const name = normalizeText(req.body.name);
  const includeInAutoSchedule = req.body.includeInAutoSchedule !== undefined
    ? Boolean(req.body.includeInAutoSchedule)
    : null;

  if (!id || !name) {
    return res.status(400).json({ error: "Valid ID and name are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  const maxWeeksPerMonth = parsePositiveInt(req.body.maxWeeksPerMonth);

  try {
    const result = await pool.query(
      `UPDATE people
       SET name = $1,
           include_in_auto_schedule = COALESCE($2, include_in_auto_schedule),
           max_weeks_per_month = COALESCE($3, max_weeks_per_month),
           updated_at = NOW()
       WHERE id = $4 AND role_id = $5
       RETURNING id, name, include_in_auto_schedule, max_weeks_per_month, created_at, updated_at`,
      [name, includeInAutoSchedule, maxWeeksPerMonth, id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Person not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to update person", error);
  }
});

app.delete("/api/people/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      "DELETE FROM people WHERE id = $1 AND role_id = $2 RETURNING id",
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Person not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete person", error);
  }
});

app.get("/api/normal-weeks", requireAuth, async (req, res) => {
  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT nw.id, nw.person_id, p.name AS person_name, nw.week_number, nw.created_at, nw.updated_at
       FROM normal_weeks nw
       JOIN people p ON p.id = nw.person_id
       WHERE p.role_id = $1
       ORDER BY p.name ASC, nw.week_number ASC`,
      [roleId],
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load normal weeks", error);
  }
});

app.get("/api/normal-weeks/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT nw.id, nw.person_id, p.name AS person_name, nw.week_number, nw.created_at, nw.updated_at
       FROM normal_weeks nw
       JOIN people p ON p.id = nw.person_id
       WHERE nw.id = $1 AND p.role_id = $2`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Normal week preference not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load normal week preference", error);
  }
});

app.post("/api/normal-weeks", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.body.personId);
  const weekNumber = parsePositiveInt(req.body.weekNumber);

  if (!personId || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid person ID and week number (1-5) are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO normal_weeks (person_id, week_number)
       VALUES ($1, $2)
       RETURNING id, person_id, week_number, created_at, updated_at`,
      [personId, weekNumber],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Person already has this normal week preference." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to create normal week preference", error);
  }
});

app.put("/api/normal-weeks/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const personId = parsePositiveInt(req.body.personId);
  const weekNumber = parsePositiveInt(req.body.weekNumber);

  if (!id || !personId || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid ID, person ID, and week number (1-5) are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE normal_weeks
       SET person_id = $1,
           week_number = $2,
           updated_at = NOW()
       WHERE id = $3
         AND EXISTS (
           SELECT 1 FROM people p WHERE p.id = normal_weeks.person_id AND p.role_id = $4
         )
       RETURNING id, person_id, week_number, created_at, updated_at`,
      [personId, weekNumber, id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Normal week preference not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Person already has this normal week preference." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to update normal week preference", error);
  }
});

app.delete("/api/normal-weeks/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `DELETE FROM normal_weeks nw
       WHERE nw.id = $1
         AND EXISTS (
           SELECT 1 FROM people p WHERE p.id = nw.person_id AND p.role_id = $2
         )
       RETURNING id`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Normal week preference not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete normal week preference", error);
  }
});

app.get("/api/blocked-out", requireAuth, async (req, res) => {
  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT b.id, b.person_id, p.name AS person_name, b.start_date, b.end_date, b.created_at, b.updated_at
       FROM blocked_out b
       JOIN people p ON p.id = b.person_id
       WHERE p.role_id = $1
         AND b.end_date >= CURRENT_DATE
       ORDER BY b.start_date ASC, p.name ASC`,
      [roleId],
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load blocked out dates", error);
  }
});

app.get("/api/blocked-out/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT b.id, b.person_id, p.name AS person_name, b.start_date, b.end_date, b.created_at, b.updated_at
       FROM blocked_out b
       JOIN people p ON p.id = b.person_id
       WHERE b.id = $1 AND p.role_id = $2`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Blocked out entry not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load blocked out entry", error);
  }
});

app.post("/api/blocked-out", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.body.personId);
  const startDate = normalizeDate(req.body.startDate);
  const endDate = normalizeDate(req.body.endDate);

  if (!personId || !startDate || !endDate) {
    return res.status(400).json({ error: "Valid person ID, start date, and end date are required." });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: "Start date must be on or before end date." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO blocked_out (person_id, start_date, end_date)
       VALUES ($1, $2, $3)
       RETURNING id, person_id, start_date, end_date, created_at, updated_at`,
      [personId, startDate, endDate],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to create blocked out entry", error);
  }
});

app.put("/api/blocked-out/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const personId = parsePositiveInt(req.body.personId);
  const startDate = normalizeDate(req.body.startDate);
  const endDate = normalizeDate(req.body.endDate);

  if (!id || !personId || !startDate || !endDate) {
    return res.status(400).json({ error: "Valid ID, person ID, start date, and end date are required." });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: "Start date must be on or before end date." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE blocked_out
       SET person_id = $1,
           start_date = $2,
           end_date = $3,
           updated_at = NOW()
       WHERE id = $4
         AND EXISTS (
           SELECT 1 FROM people p WHERE p.id = blocked_out.person_id AND p.role_id = $5
         )
       RETURNING id, person_id, start_date, end_date, created_at, updated_at`,
      [personId, startDate, endDate, id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Blocked out entry not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to update blocked out entry", error);
  }
});

app.delete("/api/blocked-out/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `DELETE FROM blocked_out b
       WHERE b.id = $1
         AND EXISTS (
           SELECT 1 FROM people p WHERE p.id = b.person_id AND p.role_id = $2
         )
       RETURNING id`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Blocked out entry not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete blocked out entry", error);
  }
});

app.get("/api/positions", requireAuth, async (req, res) => {
  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT id, name, required, priority, can_double_up,
              allows_multiple_assignments, min_assignments, max_assignments,
              created_at, updated_at
       FROM positions
       WHERE role_id = $1 AND soft_deleted = FALSE
       ORDER BY priority ASC, name ASC`,
      [roleId],
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load positions", error);
  }
});

app.get("/api/positions/:id(\\d+)", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT id, name, required, priority, can_double_up,
              allows_multiple_assignments, min_assignments, max_assignments,
              created_at, updated_at
       FROM positions
       WHERE id = $1 AND role_id = $2 AND soft_deleted = FALSE`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Position not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load position", error);
  }
});

app.post("/api/positions", requireAuth, async (req, res) => {
  const name = normalizeText(req.body.name);
  const required = parseOptionalBoolean(req.body.required);
  const canDoubleUp = parseOptionalBoolean(req.body.canDoubleUp);
  const allowsMultipleAssignments = parseOptionalBoolean(req.body.allowsMultipleAssignments);
  const minAssignments = req.body.minAssignments === undefined ? null : parseNonNegativeInt(req.body.minAssignments);
  const maxAssignments = req.body.maxAssignments === undefined ? null : parseNonNegativeInt(req.body.maxAssignments);

  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }

  if (req.body.minAssignments !== undefined && minAssignments === null) {
    return res.status(400).json({ error: "minAssignments must be a non-negative integer." });
  }

  if (req.body.maxAssignments !== undefined && maxAssignments === null) {
    return res.status(400).json({ error: "maxAssignments must be a non-negative integer." });
  }

  const effectiveRequired = required === null ? true : required;
  const effectiveAllowsMultiple = allowsMultipleAssignments === null ? false : allowsMultipleAssignments;
  const effectiveMinAssignments = minAssignments ?? (effectiveRequired ? 1 : 0);
  const effectiveMaxAssignments = maxAssignments ?? (effectiveAllowsMultiple ? Math.max(effectiveMinAssignments, 2) : 1);

  if (effectiveMaxAssignments < effectiveMinAssignments) {
    return res.status(400).json({ error: "maxAssignments must be greater than or equal to minAssignments." });
  }

  if (!effectiveAllowsMultiple && effectiveMaxAssignments > 1) {
    return res.status(400).json({ error: "Enable multiple assignments to allow more than one person on a position." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const priorityResult = await pool.query(
      "SELECT COALESCE(MAX(priority), 0)::int + 1 AS next_priority FROM positions WHERE role_id = $1 AND soft_deleted = FALSE",
      [roleId],
    );
    const nextPriority = priorityResult.rows[0].next_priority;

    const result = await pool.query(
      `INSERT INTO positions (
         name,
         required,
         priority,
         can_double_up,
         role_id,
         allows_multiple_assignments,
         min_assignments,
         max_assignments
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, required, priority, can_double_up,
                 allows_multiple_assignments, min_assignments, max_assignments,
                 created_at, updated_at`,
      [name, effectiveRequired, nextPriority, canDoubleUp === null ? false : canDoubleUp, roleId, effectiveAllowsMultiple, effectiveMinAssignments, effectiveMaxAssignments],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position name already exists." });
    }

    return handleServerError(res, "Failed to create position", error);
  }
});

app.put("/api/positions/:id(\\d+)", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const name = req.body.name === undefined ? null : normalizeText(req.body.name);
  const priority = parsePositiveInt(req.body.priority);
  const required = parseOptionalBoolean(req.body.required);
  const canDoubleUp = parseOptionalBoolean(req.body.canDoubleUp);
  const allowsMultipleAssignments = parseOptionalBoolean(req.body.allowsMultipleAssignments);
  const minAssignments = req.body.minAssignments === undefined ? null : parseNonNegativeInt(req.body.minAssignments);
  const maxAssignments = req.body.maxAssignments === undefined ? null : parseNonNegativeInt(req.body.maxAssignments);

  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  if (req.body.name !== undefined && !name) {
    return res.status(400).json({ error: "Name cannot be blank." });
  }

  if (req.body.minAssignments !== undefined && minAssignments === null) {
    return res.status(400).json({ error: "minAssignments must be a non-negative integer." });
  }

  if (req.body.maxAssignments !== undefined && maxAssignments === null) {
    return res.status(400).json({ error: "maxAssignments must be a non-negative integer." });
  }

  if (name === null && !priority && required === null && canDoubleUp === null && allowsMultipleAssignments === null && minAssignments === null && maxAssignments === null) {
    return res.status(400).json({ error: "At least one field to update is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const currentResult = await pool.query(
      `SELECT required, allows_multiple_assignments, min_assignments, max_assignments
       FROM positions
       WHERE id = $1 AND role_id = $2 AND soft_deleted = FALSE`,
      [id, roleId],
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: "Position not found." });
    }

    const current = currentResult.rows[0];
    const nextRequired = required === null ? current.required : required;
    const nextAllowsMultiple = allowsMultipleAssignments === null ? current.allows_multiple_assignments : allowsMultipleAssignments;
    const nextMinAssignments = minAssignments === null ? current.min_assignments : minAssignments;
    const nextMaxAssignments = maxAssignments === null ? current.max_assignments : maxAssignments;

    if (nextMaxAssignments < nextMinAssignments) {
      return res.status(400).json({ error: "maxAssignments must be greater than or equal to minAssignments." });
    }

    if (!nextAllowsMultiple && nextMaxAssignments > 1) {
      return res.status(400).json({ error: "Enable multiple assignments to allow more than one person on a position." });
    }

    const result = await pool.query(
      `UPDATE positions
       SET name = COALESCE($1, name),
           priority = COALESCE($2, priority),
           required = COALESCE($3, required),
           can_double_up = COALESCE($4, can_double_up),
           allows_multiple_assignments = COALESCE($5, allows_multiple_assignments),
           min_assignments = COALESCE($6, min_assignments),
           max_assignments = COALESCE($7, max_assignments),
           updated_at = NOW()
       WHERE id = $8 AND role_id = $9 AND soft_deleted = FALSE
       RETURNING id, name, required, priority, can_double_up,
                 allows_multiple_assignments, min_assignments, max_assignments,
                 created_at, updated_at`,
      [name, priority, required, canDoubleUp, allowsMultipleAssignments, minAssignments, maxAssignments, id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Position not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position name already exists." });
    }

    return handleServerError(res, "Failed to update position", error);
  }
});

app.put("/api/positions/reorder", requireAuth, async (req, res) => {
  const orderedPositionIds = Array.isArray(req.body.orderedPositionIds)
    ? req.body.orderedPositionIds.map((value) => parsePositiveInt(value)).filter(Boolean)
    : [];

  if (orderedPositionIds.length === 0) {
    return res.status(400).json({ error: "orderedPositionIds is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      "SELECT id FROM positions WHERE role_id = $1 AND soft_deleted = FALSE ORDER BY priority ASC, id ASC",
      [roleId],
    );
    const existingIds = existingResult.rows.map((row) => row.id);

    const sameLength = existingIds.length === orderedPositionIds.length;
    const sameSet = sameLength && existingIds.every((id) => orderedPositionIds.includes(id));

    if (!sameSet) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "orderedPositionIds must include all positions exactly once." });
    }

    for (let index = 0; index < orderedPositionIds.length; index += 1) {
      await client.query(
        `UPDATE positions
         SET priority = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [index + 1, orderedPositionIds[index]],
      );
    }

    await client.query("COMMIT");

    const updated = await pool.query(
      `SELECT id, name, required, priority, can_double_up,
              allows_multiple_assignments, min_assignments, max_assignments,
              created_at, updated_at
       FROM positions
       WHERE role_id = $1 AND soft_deleted = FALSE
       ORDER BY priority ASC, id ASC`,
      [roleId],
    );
    return res.json(updated.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to reorder positions", error);
  } finally {
    client.release();
  }
});

// --- Position people order ---

app.get("/api/positions/:id(\\d+)/people-order", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Valid position ID is required." });

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const posCheck = await pool.query(
      "SELECT id FROM positions WHERE id = $1 AND role_id = $2 AND soft_deleted = FALSE",
      [id, roleId],
    );
    if (posCheck.rows.length === 0) {
      return res.status(404).json({ error: "Position not found." });
    }

    const result = await pool.query(
      `SELECT ppo.id, ppo.person_id, ppo.rank_order, p.name AS person_name
       FROM position_person_order ppo
       LEFT JOIN people p ON p.id = ppo.person_id
       WHERE ppo.position_id = $1
       ORDER BY ppo.rank_order ASC`,
      [id],
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load position people order", error);
  }
});

app.put("/api/positions/:id(\\d+)/people-order", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Valid position ID is required." });

  const items = Array.isArray(req.body.items) ? req.body.items : [];

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const posCheck = await client.query(
      "SELECT id FROM positions WHERE id = $1 AND role_id = $2 AND soft_deleted = FALSE",
      [id, roleId],
    );
    if (posCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Position not found." });
    }

    await client.query("DELETE FROM position_person_order WHERE position_id = $1", [id]);

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const personId = item.personId ? parsePositiveInt(item.personId) : null;
      await client.query(
        `INSERT INTO position_person_order (position_id, person_id, rank_order)
         VALUES ($1, $2, $3)`,
        [id, personId, index + 1],
      );
    }

    await client.query("COMMIT");

    const result = await pool.query(
      `SELECT ppo.id, ppo.person_id, ppo.rank_order, p.name AS person_name
       FROM position_person_order ppo
       LEFT JOIN people p ON p.id = ppo.person_id
       WHERE ppo.position_id = $1
       ORDER BY ppo.rank_order ASC`,
      [id],
    );

    return res.json(result.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to save position people order", error);
  } finally {
    client.release();
  }
});

app.get("/api/people-positions", requireAuth, async (req, res) => {
  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT pp.person_id, pp.position_id, pp.rank_order,
              p.name AS person_name,
              pos.name AS position_name,
              pp.created_at, pp.updated_at
       FROM person_positions pp
       JOIN people p ON p.id = pp.person_id
       JOIN positions pos ON pos.id = pp.position_id
      WHERE p.role_id = $1 AND pos.soft_deleted = FALSE
       ORDER BY p.name ASC, pp.rank_order ASC`,
      [roleId],
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load people positions", error);
  }
});

app.get("/api/people/:id/positions", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  if (!personId) {
    return res.status(400).json({ error: "Valid person ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT pp.person_id, pp.position_id, pp.rank_order,
              pos.name AS position_name,
              pp.created_at, pp.updated_at
       FROM person_positions pp
       JOIN positions pos ON pos.id = pp.position_id
       JOIN people p ON p.id = pp.person_id
      WHERE pp.person_id = $1 AND p.role_id = $2 AND pos.role_id = $2 AND pos.soft_deleted = FALSE
       ORDER BY pp.rank_order ASC`,
      [personId, roleId],
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load person positions", error);
  }
});

app.post("/api/people/:id/positions", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  const positionId = parsePositiveInt(req.body.positionId);

  if (!personId || !positionId) {
    return res.status(400).json({ error: "Valid person ID and position ID are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  if (!(await ensurePositionInRole(positionId, roleId, res))) {
    return;
  }

  try {
    const rankResult = await pool.query(
      "SELECT COALESCE(MAX(rank_order), 0)::int + 1 AS next_rank FROM person_positions WHERE person_id = $1",
      [personId],
    );

    const result = await pool.query(
      `INSERT INTO person_positions (person_id, position_id, rank_order)
       VALUES ($1, $2, $3)
       RETURNING person_id, position_id, rank_order, created_at, updated_at`,
      [personId, positionId, rankResult.rows[0].next_rank],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position already assigned to this person." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Person or position does not exist." });
    }

    return handleServerError(res, "Failed to assign position to person", error);
  }
});

app.put("/api/people/:id/positions/reorder", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  const orderedPositionIds = Array.isArray(req.body.orderedPositionIds)
    ? req.body.orderedPositionIds.map((value) => parsePositiveInt(value)).filter(Boolean)
    : [];

  if (!personId || orderedPositionIds.length === 0) {
    return res.status(400).json({ error: "Valid person ID and orderedPositionIds are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `SELECT pp.position_id
       FROM person_positions pp
       JOIN positions pos ON pos.id = pp.position_id
       WHERE pp.person_id = $1 AND pos.role_id = $2 AND pos.soft_deleted = FALSE
       ORDER BY pp.rank_order ASC`,
      [personId, roleId],
    );
    const existingIds = existingResult.rows.map((row) => row.position_id);

    const sameLength = existingIds.length === orderedPositionIds.length;
    const sameSet = sameLength && existingIds.every((id) => orderedPositionIds.includes(id));

    if (!sameSet) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "orderedPositionIds must include all assigned positions exactly once." });
    }

    const maxRankResult = await client.query(
      "SELECT COALESCE(MAX(rank_order), 0)::int AS max_rank FROM person_positions WHERE person_id = $1",
      [personId],
    );
    const tempOffset = maxRankResult.rows[0].max_rank + orderedPositionIds.length + 100;

    // Shift all current ranks out of the target range first so unique(person_id, rank_order)
    // cannot conflict during sequential final updates.
    await client.query(
      `UPDATE person_positions
       SET rank_order = rank_order + $1,
           updated_at = NOW()
       WHERE person_id = $2`,
      [tempOffset, personId],
    );

    for (let index = 0; index < orderedPositionIds.length; index += 1) {
      await client.query(
        `UPDATE person_positions
         SET rank_order = $1,
             updated_at = NOW()
         WHERE person_id = $2 AND position_id = $3`,
        [index + 1, personId, orderedPositionIds[index]],
      );
    }

    await client.query("COMMIT");

    const updated = await pool.query(
      `SELECT pp.person_id, pp.position_id, pp.rank_order, pos.name AS position_name
       FROM person_positions pp
       JOIN positions pos ON pos.id = pp.position_id
       WHERE pp.person_id = $1 AND pos.soft_deleted = FALSE
       ORDER BY pp.rank_order ASC`,
      [personId],
    );

    return res.json(updated.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to reorder person positions", error);
  } finally {
    client.release();
  }
});

app.delete("/api/people/:id/positions/:positionId", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  const positionId = parsePositiveInt(req.params.positionId);

  if (!personId || !positionId) {
    return res.status(400).json({ error: "Valid person ID and position ID are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  if (!(await ensurePositionInRole(positionId, roleId, res))) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const deleted = await client.query(
      `DELETE FROM person_positions
       WHERE person_id = $1 AND position_id = $2
       RETURNING person_id, position_id`,
      [personId, positionId],
    );

    if (deleted.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Person position assignment not found." });
    }

    const remaining = await client.query(
      "SELECT position_id FROM person_positions WHERE person_id = $1 ORDER BY rank_order ASC",
      [personId],
    );

    for (let index = 0; index < remaining.rows.length; index += 1) {
      await client.query(
        `UPDATE person_positions
         SET rank_order = $1,
             updated_at = NOW()
         WHERE person_id = $2 AND position_id = $3`,
        [index + 1, personId, remaining.rows[index].position_id],
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to remove person position assignment", error);
  } finally {
    client.release();
  }
});

app.delete("/api/positions/:id(\\d+)", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM people_schedule
       WHERE position_id = $1`,
      [id],
    );

    const result = await client.query(
      `UPDATE positions
       SET soft_deleted = TRUE,
           ignore_import = TRUE,
           deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND role_id = $2 AND soft_deleted = FALSE
       RETURNING id`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Position not found." });
    }

    const remaining = await client.query(
      "SELECT id FROM positions WHERE role_id = $1 AND soft_deleted = FALSE ORDER BY priority ASC, id ASC",
      [roleId],
    );
    for (let index = 0; index < remaining.rows.length; index += 1) {
      await client.query(
        `UPDATE positions
         SET priority = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [index + 1, remaining.rows[index].id],
      );
    }

    await client.query("COMMIT");

    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to delete position", error);
  } finally {
    client.release();
  }
});

app.get("/api/schedule", requireAuth, async (req, res) => {
  const month = normalizeText(req.query.month);

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const values = [roleId];
    let whereClause = "WHERE s.role_id = $1";

    if (month) {
      const bounds = monthBounds(month);
      if (!bounds) {
        return res.status(400).json({ error: "Month must be in YYYY-MM format." });
      }
      values.push(bounds.start, bounds.end);
      whereClause += ` AND s.track_date BETWEEN $${values.length - 1} AND $${values.length}`;
    }

    const result = await pool.query(
      `SELECT s.id, s.track_date, s.week_number, s.created_at, s.updated_at,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'id', ps.id,
                    'personId', ps.person_id,
                    'personName', p.name,
                    'positionId', ps.position_id,
                    'positionName', pos.name,
                    'priority', pos.priority
                  )
                  ORDER BY pos.priority ASC, pos.name ASC, ps.id ASC
                ) FILTER (WHERE ps.id IS NOT NULL),
                '[]'::json
              ) AS assignments
       FROM schedule s
       LEFT JOIN people_schedule ps ON ps.schedule_id = s.id
       LEFT JOIN people p ON p.id = ps.person_id
       LEFT JOIN positions pos ON pos.id = ps.position_id
       ${whereClause}
       GROUP BY s.id
       ORDER BY s.track_date ASC`,
      values,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load schedule", error);
  }
});

app.get("/api/schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT id, track_date, week_number, created_at, updated_at
       FROM schedule
       WHERE id = $1 AND role_id = $2`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Schedule row not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load schedule row", error);
  }
});

app.post("/api/schedule", requireAuth, async (req, res) => {
  const trackDate = normalizeDate(req.body.trackDate);
  const weekNumber = parsePositiveInt(req.body.weekNumber) || (trackDate ? weekNumberFromSunday(trackDate) : null);

  if (!trackDate || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid track date and week number (1-5) are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `INSERT INTO schedule (track_date, week_number, role_id)
       VALUES ($1, $2, $3)
       RETURNING id, track_date, week_number, created_at, updated_at`,
      [trackDate, weekNumber, roleId],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Schedule already exists for this date." });
    }

    if (error.code === "23514") {
      return res.status(400).json({ error: "Track date must be a Sunday and week number must be 1-5." });
    }

    return handleServerError(res, "Failed to create schedule row", error);
  }
});

app.put("/api/schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const trackDate = normalizeDate(req.body.trackDate);
  const weekNumber = parsePositiveInt(req.body.weekNumber) || (trackDate ? weekNumberFromSunday(trackDate) : null);

  if (!id || !trackDate || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid ID, track date, and week number (1-5) are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `UPDATE schedule
       SET track_date = $1,
           week_number = $2,
           updated_at = NOW()
       WHERE id = $3 AND role_id = $4
       RETURNING id, track_date, week_number, created_at, updated_at`,
      [trackDate, weekNumber, id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Schedule row not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Schedule already exists for this date." });
    }

    if (error.code === "23514") {
      return res.status(400).json({ error: "Track date must be a Sunday and week number must be 1-5." });
    }

    return handleServerError(res, "Failed to update schedule row", error);
  }
});

app.delete("/api/schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      "DELETE FROM schedule WHERE id = $1 AND role_id = $2 RETURNING id",
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Schedule row not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete schedule row", error);
  }
});

app.delete("/api/schedule", requireAuth, async (req, res) => {
  const month = normalizeText(req.query.month);
  const bounds = monthBounds(month);

  if (!bounds) {
    return res.status(400).json({ error: "Month must be in YYYY-MM format." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `DELETE FROM schedule
       WHERE track_date BETWEEN $1 AND $2 AND role_id = $3
       RETURNING id`,
      [bounds.start, bounds.end, roleId],
    );

    return res.json({ ok: true, deletedScheduleRows: result.rows.length, month });
  } catch (error) {
    return handleServerError(res, "Failed to clear month schedule", error);
  }
});

app.delete("/api/schedule/:id/assignments", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensureScheduleInRole(id, roleId, res))) {
    return;
  }

  try {
    await pool.query("DELETE FROM people_schedule WHERE schedule_id = $1", [id]);
    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to clear schedule assignments", error);
  }
});

app.get("/api/people-schedule", requireAuth, async (req, res) => {
  const scheduleId = parsePositiveInt(req.query.scheduleId);

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const values = [roleId];
    let whereClause = "WHERE s.role_id = $1";

    if (scheduleId) {
      values.push(scheduleId);
      whereClause += ` AND ps.schedule_id = $${values.length}`;
    }

    const result = await pool.query(
      `SELECT ps.id, ps.schedule_id, s.track_date, s.week_number,
              ps.person_id, p.name AS person_name,
              ps.position_id, pos.name AS position_name, pos.priority,
              ps.created_at, ps.updated_at
       FROM people_schedule ps
       JOIN schedule s ON s.id = ps.schedule_id
       JOIN people p ON p.id = ps.person_id
       JOIN positions pos ON pos.id = ps.position_id
       ${whereClause}
       ORDER BY s.track_date ASC, pos.priority ASC, p.name ASC`,
      values,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load people schedule", error);
  }
});

app.get("/api/people-schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  try {
    const result = await pool.query(
      `SELECT ps.id, ps.schedule_id, ps.person_id, ps.position_id,
              s.track_date, s.week_number,
              p.name AS person_name,
              pos.name AS position_name,
              pos.priority,
              ps.created_at, ps.updated_at
       FROM people_schedule ps
       JOIN schedule s ON s.id = ps.schedule_id
       JOIN people p ON p.id = ps.person_id
       JOIN positions pos ON pos.id = ps.position_id
       WHERE ps.id = $1 AND s.role_id = $2`,
      [id, roleId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "People schedule assignment not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load people schedule assignment", error);
  }
});

app.post("/api/people-schedule", requireAuth, async (req, res) => {
  const scheduleId = parsePositiveInt(req.body.scheduleId);
  const personId = parsePositiveInt(req.body.personId);
  const positionId = parsePositiveInt(req.body.positionId);

  if (!scheduleId || !personId || !positionId) {
    return res.status(400).json({ error: "Schedule ID, person ID, and position ID are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensureScheduleInRole(scheduleId, roleId, res))) {
    return;
  }

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  if (!(await ensurePositionInRole(positionId, roleId, res))) {
    return;
  }

  try {
    const capacity = await getPositionCapacityForSchedule(pool, scheduleId, positionId, roleId);
    if (!capacity) {
      return res.status(404).json({ error: "Position not found." });
    }

    if (capacity.assignedCount >= Math.max(1, capacity.maxAssignments)) {
      return res.status(409).json({
        error: capacity.allowsMultipleAssignments
          ? "Position is already full for this schedule."
          : "Position is already assigned for this schedule.",
      });
    }

    const result = await pool.query(
      `INSERT INTO people_schedule (schedule_id, person_id, position_id)
       VALUES ($1, $2, $3)
       RETURNING id, schedule_id, person_id, position_id, created_at, updated_at`,
      [scheduleId, personId, positionId],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position is already assigned for this schedule." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Schedule, person, or position does not exist." });
    }

    return handleServerError(res, "Failed to create people schedule assignment", error);
  }
});

app.put("/api/people-schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const scheduleId = parsePositiveInt(req.body.scheduleId);
  const personId = parsePositiveInt(req.body.personId);
  const positionId = parsePositiveInt(req.body.positionId);

  if (!id || !scheduleId || !personId || !positionId) {
    return res.status(400).json({ error: "Valid ID, schedule ID, person ID, and position ID are required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensureAssignmentInRole(id, roleId, res))) {
    return;
  }

  if (!(await ensureScheduleInRole(scheduleId, roleId, res))) {
    return;
  }

  if (!(await ensurePersonInRole(personId, roleId, res))) {
    return;
  }

  if (!(await ensurePositionInRole(positionId, roleId, res))) {
    return;
  }

  try {
    const capacity = await getPositionCapacityForSchedule(pool, scheduleId, positionId, roleId, id);
    if (!capacity) {
      return res.status(404).json({ error: "Position not found." });
    }

    if (capacity.assignedCount >= Math.max(1, capacity.maxAssignments)) {
      return res.status(409).json({
        error: capacity.allowsMultipleAssignments
          ? "Position is already full for this schedule."
          : "Position is already assigned for this schedule.",
      });
    }

    const result = await pool.query(
      `UPDATE people_schedule
       SET schedule_id = $1,
           person_id = $2,
           position_id = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, schedule_id, person_id, position_id, created_at, updated_at`,
      [scheduleId, personId, positionId, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "People schedule assignment not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position is already assigned for this schedule." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Schedule, person, or position does not exist." });
    }

    return handleServerError(res, "Failed to update people schedule assignment", error);
  }
});

app.delete("/api/people-schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  if (!(await ensureAssignmentInRole(id, roleId, res))) {
    return;
  }

  try {
    const result = await pool.query("DELETE FROM people_schedule WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "People schedule assignment not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete people schedule assignment", error);
  }
});

app.post("/api/schedule/prepopulate", requireAuth, async (req, res) => {
  const month = normalizeText(req.body.month);
  const bounds = monthBounds(month);

  if (!bounds) {
    return res.status(400).json({ error: "Month must be in YYYY-MM format." });
  }

  const sundayDates = sundayDatesForMonth(bounds.year, bounds.monthZeroBased);
  if (sundayDates.length === 0) {
    return res.status(400).json({ error: "No Sundays found for that month." });
  }

  const roleId = await resolveRoleId(req, res);
  if (!roleId) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roleResult = await client.query(
      `SELECT apply_strategy, global_min_assignments, global_max_assignments
       FROM roles
       WHERE id = $1`,
      [roleId],
    );

    if (roleResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Role not found." });
    }

    const roleSettings = roleResult.rows[0];
    const applyStrategy = roleSettings.apply_strategy || "single_apply";

    const [peopleResult, positionsResult, normalWeeksResult, blockedResult, personPositionsResult, positionPeopleOrderResult] = await Promise.all([
      client.query("SELECT id, name, max_weeks_per_month FROM people WHERE include_in_auto_schedule = TRUE AND role_id = $1 ORDER BY id ASC", [roleId]),
      client.query(
        `SELECT id, name, required, priority, can_double_up,
                allows_multiple_assignments, min_assignments, max_assignments
         FROM positions
         WHERE role_id = $1 AND soft_deleted = FALSE
         ORDER BY priority ASC, id ASC`,
        [roleId],
      ),
      client.query(
        `SELECT nw.person_id, nw.week_number
         FROM normal_weeks nw
         JOIN people p ON p.id = nw.person_id
         WHERE p.role_id = $1`,
        [roleId],
      ),
      client.query(
        `SELECT b.person_id, b.start_date, b.end_date
         FROM blocked_out b
         JOIN people p ON p.id = b.person_id
         WHERE p.role_id = $1`,
        [roleId],
      ),
      client.query(
        `SELECT pp.person_id, pp.position_id, pp.rank_order
         FROM person_positions pp
         JOIN people p ON p.id = pp.person_id
         JOIN positions pos ON pos.id = pp.position_id
         WHERE p.role_id = $1 AND pos.role_id = $1`,
        [roleId],
      ),
      client.query(
        `SELECT ppo.position_id, ppo.person_id, ppo.rank_order
         FROM position_person_order ppo
         JOIN positions pos ON pos.id = ppo.position_id
         WHERE pos.role_id = $1
         ORDER BY ppo.position_id ASC, ppo.rank_order ASC`,
        [roleId],
      ),
    ]);

    const people = peopleResult.rows;
    const positions = positionsResult.rows;
    // Map: positionId -> can_double_up
    const canDoubleUpByPosition = new Map();
    positions.forEach((pos) => {
      canDoubleUpByPosition.set(pos.id, !!pos.can_double_up);
    });
    const positionsById = new Map(positions.map((position) => [position.id, position]));

    if (people.length === 0 || positions.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "People and positions must exist before pre-populating schedule." });
    }

    const weeksByPerson = new Map();
    normalWeeksResult.rows.forEach((row) => {
      if (!weeksByPerson.has(row.person_id)) {
        weeksByPerson.set(row.person_id, new Set());
      }
      weeksByPerson.get(row.person_id).add(row.week_number);
    });

    const blockedByPerson = new Map();
    blockedResult.rows.forEach((row) => {
      if (!blockedByPerson.has(row.person_id)) {
        blockedByPerson.set(row.person_id, []);
      }
      blockedByPerson.get(row.person_id).push(row);
    });

    const qualifiedPositionsByPerson = new Map();
    personPositionsResult.rows.forEach((row) => {
      if (!qualifiedPositionsByPerson.has(row.person_id)) {
        qualifiedPositionsByPerson.set(row.person_id, []);
      }
      qualifiedPositionsByPerson.get(row.person_id).push(row.position_id);
    });

    // Position-level people order: for each position, ordered list with null = "Everyone Else"
    const personOrderByPosition = new Map();
    positionPeopleOrderResult.rows.forEach((row) => {
      if (!personOrderByPosition.has(row.position_id)) {
        personOrderByPosition.set(row.position_id, []);
      }
      personOrderByPosition.get(row.position_id).push(row);
    });

    const existingSchedulesResult = await client.query(
      `SELECT id, track_date, week_number
       FROM schedule
       WHERE track_date BETWEEN $1 AND $2 AND role_id = $3`,
      [bounds.start, bounds.end, roleId],
    );

    const scheduleByDate = new Map();
    existingSchedulesResult.rows.forEach((row) => {
      scheduleByDate.set(row.track_date, row);
    });

    for (const date of sundayDates) {
      if (!scheduleByDate.has(date)) {
        const insertResult = await client.query(
          `INSERT INTO schedule (track_date, week_number, role_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (track_date, role_id) DO UPDATE SET week_number = EXCLUDED.week_number
           RETURNING id, track_date, week_number`,
          [date, weekNumberFromSunday(date), roleId],
        );
        scheduleByDate.set(date, insertResult.rows[0]);
      }
    }

    const scheduleIds = [...scheduleByDate.values()].map((row) => row.id);
    const existingAssignmentsResult = await client.query(
      `SELECT ps.id, ps.schedule_id, ps.person_id, ps.position_id, s.track_date
       FROM people_schedule ps
       JOIN schedule s ON s.id = ps.schedule_id
       WHERE ps.schedule_id = ANY($1::int[])`,
      [scheduleIds],
    );

    const assignedBySchedule = new Map();
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const initialAssignmentsByDate = {};
    const initialWorkCounts = {};
    const initialAssignedWeeks = {};

    existingAssignmentsResult.rows.forEach((row) => {
      if (!initialAssignedWeeks[row.person_id]) {
        initialAssignedWeeks[row.person_id] = [];
      }
      if (!initialAssignedWeeks[row.person_id].includes(row.track_date)) {
        initialAssignedWeeks[row.person_id].push(row.track_date);
      }

      if (!initialAssignmentsByDate[row.track_date]) {
        initialAssignmentsByDate[row.track_date] = applyStrategy === "group_apply" ? [] : {};
      }

      if (applyStrategy === "group_apply") {
        initialAssignmentsByDate[row.track_date].push({
          positionId: row.position_id,
          personId: row.person_id,
        });
      } else {
        initialAssignmentsByDate[row.track_date][row.position_id] = row.person_id;
      }

      if (!canDoubleUpByPosition.get(row.position_id)) {
        initialWorkCounts[row.person_id] = (initialWorkCounts[row.person_id] || 0) + 1;
      }

      if (!assignedBySchedule.has(row.schedule_id)) {
        assignedBySchedule.set(row.schedule_id, {
          personIds: new Set(),
          positionIds: new Set(),
          assignmentKeys: new Set(),
        });
      }
      assignedBySchedule.get(row.schedule_id).personIds.add(row.person_id);
      assignedBySchedule.get(row.schedule_id).positionIds.add(row.position_id);
      assignedBySchedule.get(row.schedule_id).assignmentKeys.add(`${row.position_id}:${row.person_id}`);
    });

    const createdAssignments = [];

    const transformedPeople = people.map((person) => ({
      id: person.id,
      name: person.name,
      normal_weeks: [...(weeksByPerson.get(person.id) || [])],
      max_weeks: person.max_weeks_per_month,
      qualified_positions: qualifiedPositionsByPerson.get(person.id) || [],
      block_outs: (blockedByPerson.get(person.id) || []).map((row) => ({
        start: row.start_date,
        end: row.end_date,
      })),
    }));

    const transformedPositions = positions.map((position) => {
      const positionOrder = personOrderByPosition.get(position.id) || [];
      const everyoneElseRow = positionOrder.find((item) => item.person_id === null);
      const priorityList = positionOrder
        .filter((item) => item.person_id !== null)
        .map((item) => item.person_id);

      return {
        id: position.id,
        name: position.name,
        rank: position.priority,
        is_required: position.required,
        can_be_doubled_up: !!position.can_double_up,
        allows_multiple_assignments: !!position.allows_multiple_assignments,
        min_assignments: position.min_assignments,
        max_assignments: position.max_assignments,
        priority_list: priorityList,
        everyone_else_index: everyoneElseRow
          ? positionOrder.filter((item) => item.person_id !== null && item.rank_order < everyoneElseRow.rank_order).length
          : undefined,
      };
    });

    const computedAssignments = applyStrategy === "group_apply"
      ? await prePopulateMonthGroup(bounds.monthZeroBased + 1, bounds.year, {
        sundays: sundayDates,
        peoplePool: transformedPeople,
        rankedPositions: transformedPositions,
        initialAssignments: initialAssignmentsByDate,
        initialAssignedWeeks,
        globalMinAssignments: roleSettings.global_min_assignments,
        globalMaxAssignments: roleSettings.global_max_assignments,
        roleId,
        warn: (message) => console.warn(message),
      })
      : await prePopulateMonth(bounds.monthZeroBased + 1, bounds.year, {
        sundays: sundayDates,
        peoplePool: transformedPeople,
        rankedPositions: transformedPositions,
        initialAssignments: initialAssignmentsByDate,
        initialWorkCounts,
        roleId,
        warn: (message) => console.warn(message),
      });

    for (const date of sundayDates) {
      const schedule = scheduleByDate.get(date);
      const assigned = assignedBySchedule.get(schedule.id) || {
        personIds: new Set(),
        positionIds: new Set(),
        assignmentKeys: new Set(),
      };

      if (!assignedBySchedule.has(schedule.id)) {
        assignedBySchedule.set(schedule.id, assigned);
      }

      const rawDayAssignments = computedAssignments[date] || (applyStrategy === "group_apply" ? [] : {});
      const dayAssignments = applyStrategy === "group_apply"
        ? rawDayAssignments.map((entry) => ({ positionId: Number(entry.positionId), personId: Number(entry.personId) }))
        : Object.entries(rawDayAssignments).map(([positionIdText, personId]) => ({
          positionId: Number(positionIdText),
          personId: Number(personId),
        }));

      for (const { positionId, personId } of dayAssignments) {
        const assignmentKey = `${positionId}:${personId}`;
        if (applyStrategy !== "group_apply" && assigned.positionIds.has(positionId)) {
          continue;
        }
        if (assigned.assignmentKeys.has(assignmentKey)) {
          continue;
        }

        const selectedPerson = peopleById.get(personId);
        const selectedPosition = positionsById.get(positionId);
        if (!selectedPerson) {
          // Defensive guard if the person vanished mid-transaction.
          // This should not happen in normal flow.
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!selectedPosition) {
          // Defensive guard if the position vanished mid-transaction.
          // eslint-disable-next-line no-continue
          continue;
        }

        const insertAssignmentResult = await client.query(
          `INSERT INTO people_schedule (schedule_id, person_id, position_id)
           VALUES ($1, $2, $3)
           RETURNING id, schedule_id, person_id, position_id`,
          [schedule.id, selectedPerson.id, positionId],
        );

        assigned.personIds.add(selectedPerson.id);
        assigned.positionIds.add(positionId);
        assigned.assignmentKeys.add(assignmentKey);

        createdAssignments.push({
          ...insertAssignmentResult.rows[0],
          trackDate: date,
          weekNumber: schedule.week_number,
          personName: selectedPerson.name,
          positionName: selectedPosition.name,
          positionPriority: selectedPosition.priority,
        });
      }
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      month,
      schedulesTouched: sundayDates.length,
      assignmentsCreated: createdAssignments.length,
      createdAssignments,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to pre-populate schedule", error);
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`scheduler-api running on http://localhost:${PORT}`);
});
