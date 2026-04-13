// scheduler/api/src/utils/runPrepopulateOnDump.js
// Script to run prepopulateMonth on the current datadump and output results
const fs = require('fs');
const path = require('path');
const { prePopulateMonth } = require('../prepopulateMonth');

// Load the dump
const dumpPath = path.join(__dirname, 'prepopulateDataDump.json');
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

// Patch helpers to use dump data instead of DB
const helpers = require('./prepopulateHelpers');
helpers.getAllPeople = async () => dump.people;
helpers.getAllPositions = async () => dump.positions;

function findConsistencyWarnings(people, positions) {
    const warnings = [];
    const peopleById = new Map(people.map((person) => [person.id, person]));

    for (const position of positions) {
        for (const personId of position.priority_list || []) {
            const person = peopleById.get(personId);
            if (!person) {
                warnings.push(`Priority list mismatch: ${position.name} references missing person ${personId}.`);
                continue;
            }
            if (!person.qualified_positions.includes(position.id)) {
                warnings.push(`Priority list mismatch: ${person.name} is ordered for ${position.name} but is not qualified for position ${position.id}.`);
            }
        }
    }

    return warnings;
}

function formatTraceEntry(entry) {
    const headerParts = [entry.event];
    if (entry.positionName) headerParts.push(entry.positionName);
    if (entry.sunday) headerParts.push(entry.sunday);
    return `[${headerParts.join(' | ')}]\n${JSON.stringify(entry, null, 2)}`;
}

(async () => {
    // Example: April 2026
    const month = 4;
    const year = 2026;
    const runAt = new Date().toISOString();
    const allPositions = dump.positions;
    const allPeople = dump.people;
    const output = {};
    const traceEntries = [];
    const runtimeWarnings = [];
    const consistencyWarnings = findConsistencyWarnings(allPeople, allPositions);
    const assignments = await prePopulateMonth(month, year, {
        trace: (entry) => traceEntries.push(entry),
        warn: (message) => {
            runtimeWarnings.push(message);
            traceEntries.push({ event: 'warning', message });
            console.warn(message);
        },
    });
    const sundays = Object.keys(assignments);
    let pretty = `Last run: ${runAt}\n`;
    if (consistencyWarnings.length > 0) {
        pretty += `\nConsistency warnings:\n`;
        consistencyWarnings.forEach((warning) => {
            pretty += `  - ${warning}\n`;
        });
    }
    if (runtimeWarnings.length > 0) {
        pretty += `\nRuntime warnings:\n`;
        runtimeWarnings.forEach((warning) => {
            pretty += `  - ${warning}\n`;
        });
    }
    for (const sunday of sundays) {
        const day = assignments[sunday];
        // Track unfilled positions
        const dayOutput = {
            assignments: {},
            unfilled: [],
            month_end_eligible_unassigned: [],
            month_end_available_no_open_fit: [],
        };
        pretty += `\n${sunday}:\n`;
        // 1. Show all positions, mark unfilled as 'Empty'
        for (const pos of allPositions) {
            const displayName = pos.is_required ? `${pos.name}*` : pos.name;
            const personId = day[pos.id];
            let person = allPeople.find(p => p.id == personId);
            if (!personId) {
                dayOutput.assignments[pos.name] = 'Empty';
                dayOutput.unfilled.push(pos.name);
                pretty += `  ${displayName}: Empty\n`;
            } else {
                dayOutput.assignments[pos.name] = person ? person.name : personId;
                pretty += `  ${displayName}: ${person ? person.name : personId}\n`;
            }
        }
        // 2. Month-end diagnostics (after full month assignment exists)
        // This intentionally uses full-month totals for max_weeks checks.
        const assignedIds = Object.values(day).filter(Boolean);
        const weekNum = helpers.getWeekNumber(sunday);
        for (const person of allPeople) {
            if (assignedIds.includes(person.id)) continue;
            // Check if eligible for any position
            let eligible = false;
            let available = false;
            for (const pos of allPositions) {
                // Hard filters
                const isNormalWeek = person.normal_weeks.includes(weekNum);
                const isBlocked = person.block_outs.some(range => new Date(sunday) >= new Date(range.start) && new Date(sunday) <= new Date(range.end));
                const underMax = (Object.values(assignments).reduce((acc, d) => acc + (Object.values(d).includes(person.id) ? 1 : 0), 0) < person.max_weeks);
                const qualified = person.qualified_positions.includes(pos.id);
                if (isNormalWeek && !isBlocked && underMax) available = true;
                if (isNormalWeek && !isBlocked && underMax && qualified && !assignedIds.includes(person.id)) eligible = true;
            }
            if (eligible) {
                dayOutput.month_end_eligible_unassigned.push(person.name);
            } else if (available) {
                dayOutput.month_end_available_no_open_fit.push(person.name);
            }
        }
        if (dayOutput.month_end_eligible_unassigned.length)
            pretty += `  Month-end eligible but unassigned: ${dayOutput.month_end_eligible_unassigned.join(', ')}\n`;
        if (dayOutput.month_end_available_no_open_fit.length)
            pretty += `  Month-end available but no open fit: ${dayOutput.month_end_available_no_open_fit.join(', ')}\n`;
        output[sunday] = dayOutput;
    }
    fs.writeFileSync(
        path.join(__dirname, 'prepopulateMonthOutput.json'),
        JSON.stringify(output, null, 2)
    );
    fs.writeFileSync(
        path.join(__dirname, 'prepopulateMonthTrace.json'),
        JSON.stringify({
            runAt,
            consistencyWarnings,
            runtimeWarnings,
            traceEntries,
        }, null, 2)
    );
    fs.writeFileSync(
        path.join(__dirname, 'prepopulateMonthTrace.txt'),
        [`Last run: ${runAt}`]
            .concat(
                consistencyWarnings.length > 0
                    ? ['', 'Consistency warnings:', ...consistencyWarnings.map((warning) => `- ${warning}`)]
                    : [],
                runtimeWarnings.length > 0
                    ? ['', 'Runtime warnings:', ...runtimeWarnings.map((warning) => `- ${warning}`)]
                    : [],
                ['', 'Trace:', ...traceEntries.map(formatTraceEntry)]
            )
            .join('\n\n') + '\n'
    );
    fs.writeFileSync(
        path.join(__dirname, 'prepopulateMonthOutput.txt'),
        pretty.trim() + '\n'
    );
    console.log('Wrote prepopulateMonthOutput.json, prepopulateMonthOutput.txt, prepopulateMonthTrace.json, and prepopulateMonthTrace.txt');
})();
