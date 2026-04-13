const { prePopulateMonthGroup } = require('./prepopulateMonthGroup');
const utils = require('./utils/prepopulateHelpers');

describe('prePopulateMonthGroup', () => {
    beforeAll(() => {
        jest.spyOn(utils, 'getWeekNumber').mockImplementation((date) => {
            const parsed = new Date(date);
            return Math.floor((parsed.getDate() - 1) / 7) + 1;
        });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    it('fills grouped position minimums before global round robin', async () => {
        const assignments = await prePopulateMonthGroup(1, 2026, {
            sundays: ['2026-01-04'],
            peoplePool: [
                {
                    id: 1,
                    name: 'Leader One',
                    normal_weeks: [1],
                    max_weeks: 1,
                    qualified_positions: [101],
                    block_outs: [],
                },
                {
                    id: 2,
                    name: 'Leader Two',
                    normal_weeks: [1],
                    max_weeks: 1,
                    qualified_positions: [101],
                    block_outs: [],
                },
                {
                    id: 3,
                    name: 'Backup',
                    normal_weeks: [1],
                    max_weeks: 1,
                    qualified_positions: [102],
                    block_outs: [],
                },
            ],
            rankedPositions: [
                {
                    id: 101,
                    name: 'Leader',
                    rank: 1,
                    is_required: true,
                    allows_multiple_assignments: true,
                    min_assignments: 2,
                    max_assignments: 2,
                    priority_list: [1, 2],
                },
                {
                    id: 102,
                    name: 'Backup',
                    rank: 2,
                    is_required: false,
                    allows_multiple_assignments: false,
                    min_assignments: 0,
                    max_assignments: 1,
                    priority_list: [3],
                },
            ],
            globalMinAssignments: 2,
            globalMaxAssignments: 3,
            warn: () => {},
        });

        expect(assignments['2026-01-04']).toEqual([
            { positionId: 101, personId: 1 },
            { positionId: 101, personId: 2 },
            { positionId: 102, personId: 3 },
        ]);
    });

    it('prefers candidates above Everyone Else inside grouped positions', async () => {
        const assignments = await prePopulateMonthGroup(1, 2026, {
            sundays: ['2026-01-04'],
            peoplePool: [
                {
                    id: 1,
                    name: 'Above EE',
                    normal_weeks: [1],
                    max_weeks: 1,
                    qualified_positions: [101],
                    block_outs: [],
                },
                {
                    id: 2,
                    name: 'Below EE',
                    normal_weeks: [1],
                    max_weeks: 1,
                    qualified_positions: [101],
                    block_outs: [],
                },
                {
                    id: 3,
                    name: 'Everyone Else',
                    normal_weeks: [1],
                    max_weeks: 1,
                    qualified_positions: [101],
                    block_outs: [],
                },
            ],
            rankedPositions: [
                {
                    id: 101,
                    name: 'Leader',
                    rank: 1,
                    is_required: true,
                    allows_multiple_assignments: false,
                    min_assignments: 1,
                    max_assignments: 1,
                    priority_list: [1, 2],
                    everyone_else_index: 1,
                },
            ],
            globalMinAssignments: 1,
            globalMaxAssignments: 1,
            warn: () => {},
        });

        expect(assignments['2026-01-04']).toEqual([
            { positionId: 101, personId: 1 },
        ]);
    });
});