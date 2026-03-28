// scheduler/api/src/prepopulateMonth.test.js
// Test cases for prePopulateMonth
const { prePopulateMonth } = require('./prepopulateMonth');

// --- Mock Data Setup ---
// These helpers would normally query the DB, but here we mock them for test data
const utils = require('./utils/prepopulateHelpers');

describe('prePopulateMonth', () => {
    beforeAll(() => {
        // Mock getSundaysInMonth for March 2026 (1, 8, 15, 22, 29)
        jest.spyOn(utils, 'getSundaysInMonth').mockResolvedValue([
            '2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29',
        ]);
        // Mock getWeekNumber
        jest.spyOn(utils, 'getWeekNumber').mockImplementation(date => {
            const d = new Date(date);
            return Math.floor((d.getDate() - 1) / 7) + 1;
        });
        // Mock getAllPeople
        jest.spyOn(utils, 'getAllPeople').mockResolvedValue([
            {
                id: 1,
                name: 'Alice',
                normal_weeks: [1, 3, 5],
                max_weeks: 2,
                qualified_positions: [101, 102],
                block_outs: [{ start: '2026-03-15', end: '2026-03-15' }],
            },
            {
                id: 2,
                name: 'Bob',
                normal_weeks: [2, 4],
                max_weeks: 2,
                qualified_positions: [101],
                block_outs: [],
            },
            {
                id: 3,
                name: 'Carol',
                normal_weeks: [1, 2, 3, 4, 5],
                max_weeks: 3,
                qualified_positions: [102],
                block_outs: [],
            },
        ]);
        // Mock getAllPositions
        jest.spyOn(utils, 'getAllPositions').mockResolvedValue([
            {
                id: 101,
                name: 'Lead',
                rank: 1,
                is_required: true,
                can_be_doubled_up: false,
                priority_list: [2, 1, 3],
            },
            {
                id: 102,
                name: 'Helper',
                rank: 2,
                is_required: false,
                can_be_doubled_up: true,
                priority_list: [1, 3],
            },
        ]);
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    it('fills assignments for all Sundays in March 2026', async () => {
        const assignments = await prePopulateMonth(3, 2026);
        expect(assignments).toBeDefined();
        // Count how many Sundays have a Lead assigned
        const leadAssigned = Object.values(assignments).filter(day => day[101]).length;
        expect(leadAssigned).toBeGreaterThanOrEqual(4); // At least 4/5 Sundays filled
        // Check that no one exceeds their max_weeks
        const workCounts = { 1: 0, 2: 0, 3: 0 };
        Object.values(assignments).forEach(day => {
            if (day[101]) workCounts[day[101]]++;
        });
        expect(workCounts[1]).toBeLessThanOrEqual(2);
        expect(workCounts[2]).toBeLessThanOrEqual(2);
        expect(workCounts[3]).toBeLessThanOrEqual(3);
    });

    it('respects block out dates', async () => {
        const assignments = await prePopulateMonth(3, 2026);
        // Alice is blocked out on 2026-03-15
        expect(assignments['2026-03-15'][101]).not.toBe(1);
    });

    it('fills double-up roles only from already assigned', async () => {
        const assignments = await prePopulateMonth(3, 2026);
        Object.entries(assignments).forEach(([sunday, day]) => {
            if (day[102]) {
                // Helper (102) must be someone already assigned to Lead (101)
                expect([day[101]]).toContain(day[102]);
            }
        });
    });
});
