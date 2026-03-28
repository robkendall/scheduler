// scheduler/api/src/utils/prepopulateHelpers.js
// Stubs for test and real use. Replace with DB queries in production.

/**
 * Returns all Sundays in a given month/year as ISO date strings.
 * @param {number} month - 1-based
 * @param {number} year
 * @returns {string[]} Array of ISO date strings
 */
function getSundaysInMonth(month, year) {
    const sundays = [];
    const d = new Date(year, month - 1, 1);
    // Find first Sunday
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    while (d.getMonth() === month - 1) {
        sundays.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 7);
    }
    return sundays;
}

/**
 * Returns week number in month (1-based)
 * @param {string|Date} date
 * @returns {number}
 */
function getWeekNumber(date) {
    const d = new Date(date);
    return Math.floor((d.getDate() - 1) / 7) + 1;
}

/**
 * Returns all people (stub for DB)
 */
async function getAllPeople() {
    // Only return people for role_id 3
    const pool = require('../db');
    const peopleRows = (await pool.query(`
        SELECT p.id, p.name, p.max_weeks_per_month, p.include_in_auto_schedule
        FROM people p
        WHERE p.include_in_auto_schedule = TRUE AND p.role_id = 3
        ORDER BY p.id
    `)).rows;
    if (peopleRows.length === 0) return [];
    const ids = peopleRows.map(p => p.id).join(',');
    const normalWeeksRows = (await pool.query(`
        SELECT person_id, week_number FROM normal_weeks WHERE person_id IN (${ids})
    `)).rows;
    const qualifiedRows = (await pool.query(`
        SELECT person_id, position_id FROM person_positions WHERE person_id IN (${ids})
    `)).rows;
    const blockOutRows = (await pool.query(`
        SELECT person_id, start_date, end_date FROM blocked_out WHERE person_id IN (${ids})
    `)).rows;
    // Compose
    return peopleRows.map(p => ({
        id: p.id,
        name: p.name,
        normal_weeks: normalWeeksRows.filter(nw => nw.person_id === p.id).map(nw => nw.week_number),
        max_weeks: p.max_weeks_per_month,
        qualified_positions: qualifiedRows.filter(q => q.person_id === p.id).map(q => q.position_id),
        block_outs: blockOutRows.filter(b => b.person_id === p.id).map(b => ({ start: b.start_date, end: b.end_date })),
    }));
}

/**
 * Returns all positions (stub for DB)
 */
async function getAllPositions() {
    // Only return positions for role_id 3
    const pool = require('../db');
    const posRows = (await pool.query(`
        SELECT id, name, required, priority, can_double_up FROM positions WHERE soft_deleted = FALSE AND role_id = 3 ORDER BY priority
    `)).rows;
    if (posRows.length === 0) return [];
    const ids = posRows.map(p => p.id).join(',');
    const orderRows = (await pool.query(`
        SELECT position_id, person_id, rank_order FROM position_person_order WHERE position_id IN (${ids}) ORDER BY position_id, rank_order
    `)).rows;
    return posRows.map(pos => {
        const priorityList = orderRows.filter(o => o.position_id === pos.id && o.person_id !== null).sort((a, b) => a.rank_order - b.rank_order).map(o => o.person_id);
        return {
            id: pos.id,
            name: pos.name,
            rank: pos.priority,
            is_required: pos.required,
            can_be_doubled_up: pos.can_double_up,
            priority_list: priorityList.length > 0 ? priorityList : undefined,
        };
    });
}

module.exports = {
    getSundaysInMonth,
    getWeekNumber,
    getAllPeople,
    getAllPositions,
};
