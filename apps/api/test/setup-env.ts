process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://app:app@localhost:5433/restaurant_test";
process.env.JWT_ACCESS_SECRET = "test-secret-test-secret";
process.env.DISABLE_CRON = "1";
process.env.DISABLE_THROTTLE = "1";
process.env.UPLOAD_DIR = require("node:path").join(require("node:os").tmpdir(), "restaurant-test-uploads");
process.env.PUBLIC_API_URL = "http://api.test";
