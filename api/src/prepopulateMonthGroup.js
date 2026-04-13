const helpers = require('./utils/prepopulateHelpers');

async function prePopulateMonthGroup(month, year, options = {}) {
    const sundays = options.sundays || await helpers.getSundaysInMonth(month, year);
    const peoplePool = options.peoplePool || await helpers.getAllPeople(options.roleId);
    let rankedPositions = options.rankedPositions || await helpers.getAllPositions(options.roleId);
    rankedPositions = rankedPositions.slice().sort((a, b) => a.rank - b.rank);

    const warn = options.warn || console.warn;
    const trace = typeof options.trace === 'function' ? options.trace : null;
    const globalMinAssignments = Math.max(0, Number.isInteger(options.globalMinAssignments) ? options.globalMinAssignments : 0);
    const globalMaxAssignments = Math.max(globalMinAssignments, Number.isInteger(options.globalMaxAssignments) ? options.globalMaxAssignments : globalMinAssignments);

    const assignments = cloneAssignments(options.initialAssignments);
    const dayPersonIds = new Map();
    const assignedWeeksByPerson = new Map(peoplePool.map((person) => [person.id, new Set()]));
    const dayRotationIndex = new Map(sundays.map((sunday) => [sunday, 0]));
    const initialAssignedWeeks = options.initialAssignedWeeks || {};

    peoplePool.forEach((person) => {
        const seededWeeks = initialAssignedWeeks[person.id] || [];
        seededWeeks.forEach((weekDate) => assignedWeeksByPerson.get(person.id).add(weekDate));
    });

    for (const sunday of sundays) {
        const dayAssignments = assignments[sunday] || [];
        assignments[sunday] = dayAssignments;
        dayPersonIds.set(sunday, new Set(dayAssignments.map((entry) => entry.personId)));
        for (const entry of dayAssignments) {
            assignedWeeksByPerson.get(entry.personId)?.add(sunday);
        }
    }

    emitTrace(trace, 'group-setup', {
        month,
        year,
        sundays,
        globalMinAssignments,
        globalMaxAssignments,
        positions: rankedPositions.map((position) => ({
            id: position.id,
            name: position.name,
            rank: position.rank,
            minAssignments: getPositionMinAssignments(position),
            maxAssignments: getPositionMaxAssignments(position),
            allowsMultipleAssignments: !!position.allows_multiple_assignments,
            priorityList: position.priority_list || [],
            everyoneElseIndex: getEveryoneElseIndex(position),
        })),
    });

    for (const position of rankedPositions) {
        const minimum = getPositionMinAssignments(position);
        for (const sunday of sundays) {
            while (countAssignmentsForPosition(assignments[sunday], position.id) < minimum) {
                const selection = selectCandidateForGroupDay({
                    sunday,
                    position,
                    sundays,
                    peoplePool,
                    assignments,
                    assignedWeeksByPerson,
                    dayPersonIds,
                });

                emitTrace(trace, 'group-position-minimum-attempt', {
                    sunday,
                    positionId: position.id,
                    positionName: position.name,
                    targetMinimum: minimum,
                    currentCount: countAssignmentsForPosition(assignments[sunday], position.id),
                    selection,
                });

                if (!selection.selected) {
                    if (position.is_required) {
                        warn(`Could not reach minimum ${minimum} for ${position.name} on ${sunday}`);
                    }
                    break;
                }

                addAssignment(assignments, dayPersonIds, assignedWeeksByPerson, sunday, position.id, selection.selected.id);
            }
        }
    }

    fillToGlobalTarget({
        phase: 'group-global-minimum',
        target: globalMinAssignments,
        sundays,
        rankedPositions,
        peoplePool,
        assignments,
        assignedWeeksByPerson,
        dayPersonIds,
        dayRotationIndex,
        trace,
    });

    fillToGlobalTarget({
        phase: 'group-global-maximum',
        target: globalMaxAssignments,
        sundays,
        rankedPositions,
        peoplePool,
        assignments,
        assignedWeeksByPerson,
        dayPersonIds,
        dayRotationIndex,
        trace,
    });

    emitTrace(trace, 'group-complete', { assignments });

    return assignments;
}

function cloneAssignments(initialAssignments = {}) {
    return Object.fromEntries(
        Object.entries(initialAssignments).map(([date, entries]) => [
            date,
            Array.isArray(entries)
                ? entries.map((entry) => ({ positionId: entry.positionId, personId: entry.personId }))
                : [],
        ]),
    );
}

function fillToGlobalTarget({
    phase,
    target,
    sundays,
    rankedPositions,
    peoplePool,
    assignments,
    assignedWeeksByPerson,
    dayPersonIds,
    dayRotationIndex,
    trace,
}) {
    if (target <= 0 || rankedPositions.length === 0) {
        return;
    }

    let progress = true;
    while (progress) {
        progress = false;
        let remaining = false;

        for (const sunday of sundays) {
            if (assignments[sunday].length >= target) {
                continue;
            }

            remaining = true;
            const assigned = assignNextRoundRobin({
                sunday,
                sundays,
                rankedPositions,
                peoplePool,
                assignments,
                assignedWeeksByPerson,
                dayPersonIds,
                dayRotationIndex,
                trace,
                phase,
                target,
            });

            if (assigned) {
                progress = true;
            }
        }

        if (!remaining) {
            break;
        }
    }
}

function assignNextRoundRobin({
    sunday,
    sundays,
    rankedPositions,
    peoplePool,
    assignments,
    assignedWeeksByPerson,
    dayPersonIds,
    dayRotationIndex,
    trace,
    phase,
    target,
}) {
    const startIndex = dayRotationIndex.get(sunday) || 0;

    for (let offset = 0; offset < rankedPositions.length; offset += 1) {
        const index = (startIndex + offset) % rankedPositions.length;
        const position = rankedPositions[index];

        if (countAssignmentsForPosition(assignments[sunday], position.id) >= getPositionMaxAssignments(position)) {
            continue;
        }

        const selection = selectCandidateForGroupDay({
            sunday,
            position,
            sundays,
            peoplePool,
            assignments,
            assignedWeeksByPerson,
            dayPersonIds,
        });

        emitTrace(trace, `${phase}-attempt`, {
            sunday,
            target,
            currentTotal: assignments[sunday].length,
            positionId: position.id,
            positionName: position.name,
            selection,
        });

        if (!selection.selected) {
            continue;
        }

        addAssignment(assignments, dayPersonIds, assignedWeeksByPerson, sunday, position.id, selection.selected.id);
        dayRotationIndex.set(sunday, (index + 1) % rankedPositions.length);

        emitTrace(trace, `${phase}-assigned`, {
            sunday,
            target,
            positionId: position.id,
            positionName: position.name,
            personId: selection.selected.id,
            personName: selection.selected.name,
            currentTotal: assignments[sunday].length,
        });

        return true;
    }

    emitTrace(trace, `${phase}-stalled`, {
        sunday,
        target,
        currentTotal: assignments[sunday].length,
    });

    return false;
}

function addAssignment(assignments, dayPersonIds, assignedWeeksByPerson, sunday, positionId, personId) {
    assignments[sunday].push({ positionId, personId });
    dayPersonIds.get(sunday).add(personId);
    if (!assignedWeeksByPerson.has(personId)) {
        assignedWeeksByPerson.set(personId, new Set());
    }
    assignedWeeksByPerson.get(personId).add(sunday);
}

function countAssignmentsForPosition(dayAssignments, positionId) {
    return dayAssignments.filter((entry) => entry.positionId === positionId).length;
}

function selectCandidateForGroupDay({ sunday, position, sundays, peoplePool, assignments, assignedWeeksByPerson, dayPersonIds }) {
    const weekNum = helpers.getWeekNumber(sunday);
    const candidateDetails = peoplePool.map((person) => {
        const isNormalWeek = person.normal_weeks.includes(weekNum);
        const blockedOut = isBlockedOut(person, sunday);
        const alreadyAssignedToday = dayPersonIds.get(sunday)?.has(person.id) || false;
        const assignedWeeks = assignedWeeksByPerson.get(person.id) || new Set();
        const underMaxWeeks = assignedWeeks.size < person.max_weeks;
        const qualified = isQualified(person, position);

        return {
            id: person.id,
            name: person.name,
            isNormalWeek,
            blockedOut,
            alreadyAssignedToday,
            underMaxWeeks,
            qualified,
            tier: getEveryoneElseTier(person.id, position),
            passed: isNormalWeek && !blockedOut && !alreadyAssignedToday && underMaxWeeks && qualified,
        };
    });

    const candidates = candidateDetails
        .filter((detail) => detail.passed)
        .map((detail) => peoplePool.find((person) => person.id === detail.id));

    if (candidates.length === 0) {
        return {
            candidateDetails,
            selected: null,
            chosenTier: null,
            scoredCandidates: [],
        };
    }

    const { tierCandidates, tierName } = narrowCandidatesByEveryoneElseTier(candidates, position);
    const scoredCandidates = tierCandidates
        .map((person) => {
            const eligibleSundays = sundays.filter((candidateSunday) => {
                const candidateWeekNum = helpers.getWeekNumber(candidateSunday);
                const assignedWeeks = assignedWeeksByPerson.get(person.id) || new Set();
                const alreadyAssigned = assignments[candidateSunday].some((entry) => entry.personId === person.id);

                return person.normal_weeks.includes(candidateWeekNum)
                    && !isBlockedOut(person, candidateSunday)
                    && !alreadyAssigned
                    && assignedWeeks.size < person.max_weeks
                    && isQualified(person, position);
            });

            return {
                id: person.id,
                name: person.name,
                scarcityScore: eligibleSundays.length,
                priorityScore: getPriorityScore(person.id, position),
                eligibleSundays,
                tier: getEveryoneElseTier(person.id, position),
                person,
            };
        })
        .sort((left, right) => left.scarcityScore - right.scarcityScore || left.priorityScore - right.priorityScore);

    return {
        candidateDetails,
        selected: scoredCandidates[0].person,
        chosenTier: tierName,
        scoredCandidates: scoredCandidates.map(({ person, ...entry }) => entry),
    };
}

function getPositionMinAssignments(position) {
    const minimum = Number.isInteger(position.min_assignments) ? position.min_assignments : (position.is_required ? 1 : 0);
    return Math.max(0, Math.min(minimum, getPositionMaxAssignments(position)));
}

function getPositionMaxAssignments(position) {
    const rawMax = Number.isInteger(position.max_assignments) ? position.max_assignments : 1;
    if (position.allows_multiple_assignments) {
        return Math.max(1, rawMax);
    }
    return 1;
}

function isBlockedOut(person, date) {
    if (!person.block_outs) return false;
    const day = toYmdLocal(date);
    return person.block_outs.some((range) => {
        const startDay = toYmdLocal(range.start);
        const endDay = toYmdLocal(range.end);
        return day >= startDay && day <= endDay;
    });
}

function toYmdLocal(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    const date = new Date(value);
    const yearValue = date.getFullYear();
    const monthValue = String(date.getMonth() + 1).padStart(2, '0');
    const dayValue = String(date.getDate()).padStart(2, '0');
    return `${yearValue}-${monthValue}-${dayValue}`;
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

function emitTrace(trace, event, payload) {
    if (!trace) return;
    trace({ event, ...payload });
}

module.exports = { prePopulateMonthGroup };
