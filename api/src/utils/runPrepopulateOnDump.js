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

(async () => {
    // Example: April 2026
    const month = 4;
    const year = 2026;
    const assignments = await prePopulateMonth(month, year);
    const sundays = Object.keys(assignments);
    const allPositions = dump.positions;
    const allPeople = dump.people;
    const output = {};
    let pretty = '';
    for (const sunday of sundays) {
        const day = assignments[sunday];
        // Track unfilled positions
        const dayOutput = { assignments: {}, unfilled: [], eligible_but_unassigned: [], available_but_no_fit: [] };
        pretty += `\n${sunday}:\n`;
        // 1. Show all positions, mark unfilled as 'Empty'
        for (const pos of allPositions) {
            const personId = day[pos.id];
            let person = allPeople.find(p => p.id == personId);
            if (!personId) {
                dayOutput.assignments[pos.name] = 'Empty';
                dayOutput.unfilled.push(pos.name);
                pretty += `  ${pos.name}: Empty\n`;
            } else {
                dayOutput.assignments[pos.name] = person ? person.name : personId;
                pretty += `  ${pos.name}: ${person ? person.name : personId}\n`;
            }
        }
        // 2. Find eligible but unassigned
        // A person is eligible if they pass hard filters for any position, but are not assigned anywhere that day
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
                dayOutput.eligible_but_unassigned.push(person.name);
            } else if (available) {
                dayOutput.available_but_no_fit.push(person.name);
            }
        }
        if (dayOutput.eligible_but_unassigned.length)
            pretty += `  Eligible but unassigned: ${dayOutput.eligible_but_unassigned.join(', ')}\n`;
        if (dayOutput.available_but_no_fit.length)
            pretty += `  Available but no open fit: ${dayOutput.available_but_no_fit.join(', ')}\n`;
        output[sunday] = dayOutput;
    }
    fs.writeFileSync(
        path.join(__dirname, 'prepopulateMonthOutput.json'),
        JSON.stringify(output, null, 2)
    );
    fs.writeFileSync(
        path.join(__dirname, 'prepopulateMonthOutput.txt'),
        pretty.trim() + '\n'
    );
    console.log('Wrote prepopulateMonthOutput.json and prepopulateMonthOutput.txt');
})();
