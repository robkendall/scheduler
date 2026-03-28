require('dotenv').config({ path: __dirname + '/../../.env' });
// scheduler/api/src/utils/prepopulateDataDump.js
// Script to dump people and positions for role_id 3 for test fixture use
const fs = require('fs');
const helpers = require('./prepopulateHelpers');

(async () => {
    const people = await helpers.getAllPeople();
    const positions = await helpers.getAllPositions();
    const dump = { people, positions };
    fs.writeFileSync(
        __dirname + '/prepopulateDataDump.json',
        JSON.stringify(dump, null, 2)
    );
    console.log('Dumped to prepopulateDataDump.json');
})();
