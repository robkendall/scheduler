// scheduler/api/src/prepopulateMonth.js
// Implements the PrePopulateMonth algorithm as described

const helpers = require('./utils/prepopulateHelpers');

/**
 * Pre-populate assignments for a given month and year.
 * @param {number} month - 1-based month (1=January)
 * @param {number} year
 * @returns {Object} assignments - { [sundayDate]: { [positionId]: personId } }
 */
async function prePopulateMonth(month, year) {
    // 1. SETUP
    const sundays = await helpers.getSundaysInMonth(month, year);
    const peoplePool = await helpers.getAllPeople();
    let rankedPositions = await helpers.getAllPositions();
    rankedPositions = rankedPositions.sort((a, b) => a.rank - b.rank);

    const assignments = {};
    const workCounts = {};
    peoplePool.forEach(p => { workCounts[p.id] = 0; });

    // 2. PHASE 1: FILL STANDARD ROLES (Top-Down by Rank)
    for (const position of rankedPositions) {
        if (position.can_be_doubled_up) continue; // Handle in Phase 2
        for (const sunday of sundays) {
            const weekNum = helpers.getWeekNumber(sunday);
            if (!assignments[sunday]) assignments[sunday] = {};
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
                    console.warn(`Could not fill required position ${position.name} on ${sunday}`);
                }
                continue;
            }
            // Scarcity logic
            const bestPerson = rankByScarcity(candidates, position, sundays, workCounts, assignments, weekNum);
            assignments[sunday][position.id] = bestPerson.id;
            workCounts[bestPerson.id]++;
        }
    }

    // 3. PHASE 2: FILL DOUBLE-UP ROLES
    for (const position of rankedPositions) {
        if (!position.can_be_doubled_up) continue;
        for (const sunday of sundays) {
            if (!assignments[sunday]) assignments[sunday] = {};
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

// --- Helper Functions ---
function isBlockedOut(person, date) {
    // person.block_outs: [{ start: Date, end: Date }]
    if (!person.block_outs) return false;
    return person.block_outs.some(range => new Date(date) >= new Date(range.start) && new Date(date) <= new Date(range.end));
}

function isQualified(person, position) {
    return person.qualified_positions.includes(position.id);
}

function rankByScarcity(candidates, position, sundays, workCounts, assignments, weekNum) {
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
