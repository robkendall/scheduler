// scheduler/api/src/prepopulateMonth.js
// Implements the PrePopulateMonth algorithm as described

const helpers = require('./utils/prepopulateHelpers');

/**
 * Pre-populate assignments for a given month and year.
 * @param {number} month - 1-based month (1=January)
 * @param {number} year
 * @param {Object} [options]
 * @returns {Object} assignments - { [sundayDate]: { [positionId]: personId } }
 */
async function prePopulateMonth(month, year, options = {}) {
    // 1. SETUP
    const sundays = options.sundays || await helpers.getSundaysInMonth(month, year);
    const peoplePool = options.peoplePool || await helpers.getAllPeople(options.roleId);
    let rankedPositions = options.rankedPositions || await helpers.getAllPositions(options.roleId);
    rankedPositions = rankedPositions.slice().sort((a, b) => a.rank - b.rank);

    const assignments = cloneAssignments(options.initialAssignments);
    const workCounts = {};
    const initialWorkCounts = options.initialWorkCounts || {};
    const warn = options.warn || console.warn;
    peoplePool.forEach(p => { workCounts[p.id] = initialWorkCounts[p.id] || 0; });

    // 2. PHASE 1: FILL STANDARD ROLES (Top-Down by Rank)
    for (const position of rankedPositions) {
        if (position.can_be_doubled_up) continue; // Handle in Phase 2
        for (const sunday of sundays) {
            const weekNum = helpers.getWeekNumber(sunday);
            if (!assignments[sunday]) assignments[sunday] = {};
            if (assignments[sunday][position.id]) continue;
            // HARD FILTERS
            let candidates = peoplePool.filter(p =>
                p.normal_weeks.includes(weekNum) &&
                !isBlockedOut(p, sunday) &&
                workCounts[p.id] < p.max_weeks &&
                isQualified(p, position) &&
                !Object.values(assignments[sunday]).includes(p.id)
            );
            if (candidates.length === 0) {
                if (position.is_required) {
                    warn(`Could not fill required position ${position.name} on ${sunday}`);
                }
                continue;
            }
            // Scarcity logic
            const bestPerson = rankByScarcity(candidates, position, sundays, workCounts, assignments);
            assignments[sunday][position.id] = bestPerson.id;
            workCounts[bestPerson.id]++;
        }
    }

    // 3. PHASE 2: FILL DOUBLE-UP ROLES
    for (const position of rankedPositions) {
        if (!position.can_be_doubled_up) continue;
        for (const sunday of sundays) {
            if (!assignments[sunday]) assignments[sunday] = {};
            if (assignments[sunday][position.id]) continue;
            const alreadyWorking = Object.values(assignments[sunday]);
            const candidates = peoplePool.filter(p =>
                alreadyWorking.includes(p.id) &&
                isQualified(p, position)
            );
            if (candidates.length === 0) continue;
            const bestPerson = rankByPriorityList(candidates, position);
            if (bestPerson) {
                assignments[sunday][position.id] = bestPerson.id;
            }
        }
    }
    return assignments;
}

function cloneAssignments(initialAssignments = {}) {
    return Object.fromEntries(
        Object.entries(initialAssignments).map(([date, dayAssignments]) => [date, { ...dayAssignments }])
    );
}

// --- Helper Functions ---
function isBlockedOut(person, date) {
    // person.block_outs: [{ start: Date, end: Date }]
    if (!person.block_outs) return false;
    const day = toYmdLocal(date);
    return person.block_outs.some(range => {
        const startDay = toYmdLocal(range.start);
        const endDay = toYmdLocal(range.end);
        return day >= startDay && day <= endDay;
    });
}

function toYmdLocal(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    const d = new Date(value);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function isQualified(person, position) {
    return person.qualified_positions.includes(position.id);
}

function rankByScarcity(candidates, position, sundays, workCounts, assignments) {
    // Scarcity: prefer people who have fewer eligible weeks left in the month
    // Also use position.priority_list if available
    // Lower scarcity score = more scarce = higher priority
    return candidates
        .map(p => {
            // How many other Sundays this month could this person work for this position?
            const eligibleSundays = sundays.filter(sunday => {
                const w = helpers.getWeekNumber(sunday);
                return p.normal_weeks.includes(w) &&
                    !isBlockedOut(p, sunday) &&
                    workCounts[p.id] < p.max_weeks &&
                    isQualified(p, position) &&
                    !Object.values(assignments[sunday] || {}).includes(p.id);
            });
            // Lower = more scarce
            let scarcityScore = eligibleSundays.length;
            // Position-specific priority list
            let priorityScore = position.priority_list ? position.priority_list.indexOf(p.id) : 9999;
            if (priorityScore === -1) priorityScore = 9999;
            return { p, scarcityScore, priorityScore };
        })
        .sort((a, b) => a.scarcityScore - b.scarcityScore || a.priorityScore - b.priorityScore)[0].p;
}

function rankByPriorityList(candidates, position) {
    if (!position.priority_list) return candidates[0];
    const sorted = candidates.slice().sort((a, b) => {
        let aIdx = position.priority_list.indexOf(a.id);
        let bIdx = position.priority_list.indexOf(b.id);
        if (aIdx === -1) aIdx = 9999;
        if (bIdx === -1) bIdx = 9999;
        return aIdx - bIdx;
    });
    return sorted[0];
}

module.exports = { prePopulateMonth };
