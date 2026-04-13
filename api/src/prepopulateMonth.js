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
    const trace = typeof options.trace === 'function' ? options.trace : null;
    const peopleById = new Map(peoplePool.map((person) => [person.id, person]));
    const positionsById = new Map(rankedPositions.map((position) => [position.id, position]));
    peoplePool.forEach(p => { workCounts[p.id] = initialWorkCounts[p.id] || 0; });

    emitTrace(trace, 'setup', {
        month,
        year,
        sundays,
        people: peoplePool.map((person) => ({
            id: person.id,
            name: person.name,
            normalWeeks: person.normal_weeks,
            maxWeeks: person.max_weeks,
            qualifiedPositions: person.qualified_positions,
        })),
        positions: rankedPositions.map((position) => ({
            id: position.id,
            name: position.name,
            rank: position.rank,
            isRequired: position.is_required,
            canBeDoubledUp: position.can_be_doubled_up,
            priorityList: position.priority_list || [],
            everyoneElseIndex: getEveryoneElseIndex(position),
        })),
        initialAssignments: Object.fromEntries(
            Object.entries(assignments).map(([date, dayAssignments]) => [date, summarizeAssignments(dayAssignments, peopleById, positionsById)])
        ),
        initialWorkCounts,
    });

    // 2. PHASE 1: FILL STANDARD ROLES (Top-Down by Rank)
    for (const position of rankedPositions) {
        if (position.can_be_doubled_up) continue; // Handle in Phase 2
        for (const sunday of sundays) {
            const weekNum = helpers.getWeekNumber(sunday);
            if (!assignments[sunday]) assignments[sunday] = {};
            if (assignments[sunday][position.id]) {
                emitTrace(trace, 'standard-skip-preassigned', {
                    sunday,
                    weekNum,
                    positionId: position.id,
                    positionName: position.name,
                    currentAssignment: summarizeAssignments(assignments[sunday], peopleById, positionsById),
                });
                continue;
            }

            const alreadyAssignedIds = Object.values(assignments[sunday]);
            const candidateDetails = peoplePool.map((person) => {
                const isNormalWeek = person.normal_weeks.includes(weekNum);
                const blockedOut = isBlockedOut(person, sunday);
                const underMax = workCounts[person.id] < person.max_weeks;
                const qualified = isQualified(person, position);
                const alreadyAssignedToday = alreadyAssignedIds.includes(person.id);
                return {
                    id: person.id,
                    name: person.name,
                    isNormalWeek,
                    blockedOut,
                    underMax,
                    qualified,
                    alreadyAssignedToday,
                    currentWorkCount: workCounts[person.id],
                    maxWeeks: person.max_weeks,
                    tier: getEveryoneElseTier(person.id, position),
                    passed: isNormalWeek && !blockedOut && underMax && qualified && !alreadyAssignedToday,
                };
            });
            const candidates = candidateDetails
                .filter((detail) => detail.passed)
                .map((detail) => peopleById.get(detail.id));

            emitTrace(trace, 'standard-candidate-scan', {
                sunday,
                weekNum,
                positionId: position.id,
                positionName: position.name,
                currentAssignments: summarizeAssignments(assignments[sunday], peopleById, positionsById),
                candidateDetails,
            });

            if (candidates.length === 0) {
                if (position.is_required) {
                    warn(`Could not fill required position ${position.name} on ${sunday}`);
                }
                emitTrace(trace, 'standard-no-candidates', {
                    sunday,
                    weekNum,
                    positionId: position.id,
                    positionName: position.name,
                    isRequired: position.is_required,
                });
                continue;
            }

            const selection = selectByScarcity(candidates, position, sundays, workCounts, assignments);
            emitTrace(trace, 'standard-selection', {
                sunday,
                weekNum,
                positionId: position.id,
                positionName: position.name,
                chosenTier: selection.tierName,
                scoredCandidates: selection.scoredCandidates,
                selectedPersonId: selection.selected.id,
                selectedPersonName: selection.selected.name,
            });

            assignments[sunday][position.id] = selection.selected.id;
            workCounts[selection.selected.id]++;
            emitTrace(trace, 'standard-assigned', {
                sunday,
                weekNum,
                positionId: position.id,
                positionName: position.name,
                assignedPersonId: selection.selected.id,
                assignedPersonName: selection.selected.name,
                updatedWorkCount: workCounts[selection.selected.id],
                dayAssignments: summarizeAssignments(assignments[sunday], peopleById, positionsById),
            });
        }
    }

    // 3. PHASE 2: FILL DOUBLE-UP ROLES
    for (const position of rankedPositions) {
        if (!position.can_be_doubled_up) continue;
        for (const sunday of sundays) {
            if (!assignments[sunday]) assignments[sunday] = {};
            if (assignments[sunday][position.id]) {
                emitTrace(trace, 'double-up-skip-preassigned', {
                    sunday,
                    positionId: position.id,
                    positionName: position.name,
                    currentAssignment: summarizeAssignments(assignments[sunday], peopleById, positionsById),
                });
                continue;
            }
            const alreadyWorking = Object.values(assignments[sunday]);
            const candidateDetails = peoplePool.map((person) => {
                const alreadyWorkingToday = alreadyWorking.includes(person.id);
                const qualified = isQualified(person, position);
                return {
                    id: person.id,
                    name: person.name,
                    alreadyWorkingToday,
                    qualified,
                    tier: getEveryoneElseTier(person.id, position),
                    passed: alreadyWorkingToday && qualified,
                };
            });
            const candidates = candidateDetails
                .filter((detail) => detail.passed)
                .map((detail) => peopleById.get(detail.id));

            emitTrace(trace, 'double-up-candidate-scan', {
                sunday,
                positionId: position.id,
                positionName: position.name,
                currentAssignments: summarizeAssignments(assignments[sunday], peopleById, positionsById),
                candidateDetails,
            });

            if (candidates.length === 0) {
                emitTrace(trace, 'double-up-no-candidates', {
                    sunday,
                    positionId: position.id,
                    positionName: position.name,
                });
                continue;
            }

            const selection = selectByPriorityList(candidates, position);
            emitTrace(trace, 'double-up-selection', {
                sunday,
                positionId: position.id,
                positionName: position.name,
                chosenTier: selection.tierName,
                sortedCandidates: selection.sortedCandidates,
                selectedPersonId: selection.selected.id,
                selectedPersonName: selection.selected.name,
            });
            if (selection.selected) {
                assignments[sunday][position.id] = selection.selected.id;
                emitTrace(trace, 'double-up-assigned', {
                    sunday,
                    positionId: position.id,
                    positionName: position.name,
                    assignedPersonId: selection.selected.id,
                    assignedPersonName: selection.selected.name,
                    dayAssignments: summarizeAssignments(assignments[sunday], peopleById, positionsById),
                });
            }
        }
    }

    emitTrace(trace, 'complete', {
        assignments: Object.fromEntries(
            Object.entries(assignments).map(([date, dayAssignments]) => [date, summarizeAssignments(dayAssignments, peopleById, positionsById)])
        ),
        workCounts,
    });

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

function getEveryoneElseIndex(position) {
    if (!Array.isArray(position.priority_list) || !Number.isInteger(position.everyone_else_index)) {
        return null;
    }

    return Math.max(0, Math.min(position.everyone_else_index, position.priority_list.length));
}

function getPriorityScore(personId, position) {
    let priorityScore = position.priority_list ? position.priority_list.indexOf(personId) : 9999;
    if (priorityScore === -1) priorityScore = 9999;
    return priorityScore;
}

function summarizeAssignments(dayAssignments, peopleById, positionsById) {
    return Object.entries(dayAssignments)
        .map(([positionId, personId]) => ({
            positionId: Number(positionId),
            positionName: positionsById.get(Number(positionId))?.name || String(positionId),
            personId,
            personName: peopleById.get(personId)?.name || String(personId),
        }))
        .sort((left, right) => left.positionId - right.positionId);
}

function emitTrace(trace, event, payload) {
    if (!trace) return;
    trace({ event, ...payload });
}

function narrowCandidatesByEveryoneElseTier(candidates, position) {
    const everyoneElseIndex = getEveryoneElseIndex(position);
    if (everyoneElseIndex === null) {
        return { tierCandidates: candidates, tierName: 'no-divider' };
    }

    const aboveIds = new Set(position.priority_list.slice(0, everyoneElseIndex));
    const belowIds = new Set(position.priority_list.slice(everyoneElseIndex));

    const aboveEveryoneElse = candidates.filter((candidate) => aboveIds.has(candidate.id));
    if (aboveEveryoneElse.length > 0) {
        return { tierCandidates: aboveEveryoneElse, tierName: 'above-everyone-else' };
    }

    const everyoneElse = candidates.filter((candidate) => !aboveIds.has(candidate.id) && !belowIds.has(candidate.id));
    if (everyoneElse.length > 0) {
        return { tierCandidates: everyoneElse, tierName: 'everyone-else' };
    }

    const belowEveryoneElse = candidates.filter((candidate) => belowIds.has(candidate.id));
    if (belowEveryoneElse.length > 0) {
        return { tierCandidates: belowEveryoneElse, tierName: 'below-everyone-else' };
    }

    return { tierCandidates: candidates, tierName: 'fallback-all' };
}

function getEveryoneElseTier(personId, position) {
    const everyoneElseIndex = getEveryoneElseIndex(position);
    if (everyoneElseIndex === null) {
        return 'no-divider';
    }

    const priorityIndex = position.priority_list.indexOf(personId);
    if (priorityIndex === -1) {
        return 'everyone-else';
    }
    if (priorityIndex < everyoneElseIndex) {
        return 'above-everyone-else';
    }
    return 'below-everyone-else';
}

function selectByScarcity(candidates, position, sundays, workCounts, assignments) {
    const { tierCandidates, tierName } = narrowCandidatesByEveryoneElseTier(candidates, position);

    // Scarcity: prefer people who have fewer eligible weeks left in the month.
    // If a position defines an Everyone Else divider, only the best available tier
    // (above EE, then EE, then below EE) participates in scarcity scoring.
    const scoredCandidates = tierCandidates
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
            let priorityScore = getPriorityScore(p.id, position);
            return {
                id: p.id,
                name: p.name,
                scarcityScore,
                priorityScore,
                eligibleSundays,
                tier: getEveryoneElseTier(p.id, position),
                person: p,
            };
        })
        .sort((a, b) => a.scarcityScore - b.scarcityScore || a.priorityScore - b.priorityScore);

    return {
        selected: scoredCandidates[0].person,
        tierName,
        scoredCandidates: scoredCandidates.map(({ person, ...entry }) => entry),
    };
}

function selectByPriorityList(candidates, position) {
    const { tierCandidates, tierName } = narrowCandidatesByEveryoneElseTier(candidates, position);
    const sortedCandidates = tierCandidates
        .slice()
        .map((person) => ({
            id: person.id,
            name: person.name,
            priorityScore: getPriorityScore(person.id, position),
            tier: getEveryoneElseTier(person.id, position),
            person,
        }))
        .sort((a, b) => a.priorityScore - b.priorityScore);

    return {
        selected: sortedCandidates[0]?.person,
        tierName,
        sortedCandidates: sortedCandidates.map(({ person, ...entry }) => entry),
    };
}

module.exports = { prePopulateMonth };
