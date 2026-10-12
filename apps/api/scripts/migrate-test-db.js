// Applique les migrations sur la base de test avant les tests e2e.
const { execSync } = require("node:child_process");
const url = process.env.TEST_DATABASE_URL || "postgresql://app:app@localhost:5433/restaurant_test";
execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
