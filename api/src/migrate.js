require("dotenv").config();

async function main() {
    console.log("No migrations to run. Migration script is a no-op.");
    process.exit(0);
}

main();
