process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://app:app@localhost:5433/restaurant_test";
// Compte propriétaire (superuser) pour préparer la base (rls.sql, rôles) quand la suite tourne sous le rôle restreint app_rls.
if (!process.env.TEST_ADMIN_DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  if (u.username === "app_rls") { u.username = "app"; u.password = "app"; }
  process.env.TEST_ADMIN_DATABASE_URL = u.toString();
}
process.env.JWT_ACCESS_SECRET = "test-secret-test-secret";
process.env.TRACKING_TOKEN_SECRET = "test-tracking-secret-0123456789abcdef";
process.env.DISABLE_CRON = "1";
process.env.NOTIFICATIONS_RETRY_BASE_MS = "0";
process.env.DISABLE_THROTTLE = "1";
process.env.UPLOAD_DIR = require("node:path").join(require("node:os").tmpdir(), "restaurant-test-uploads");
process.env.PUBLIC_API_URL = "http://api.test";
// X5B : clés VAPID générées à la volée (jamais commitées) ; pilote `log` : rien ne sort du serveur, les envois sont capturés en mémoire.
{
  const { generateKeyPairSync } = require("node:crypto") as typeof import("node:crypto");
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  process.env.VAPID_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
  process.env.VAPID_PRIVATE_KEY = jwk.d!;
  process.env.VAPID_SUBJECT = "mailto:push-test@example.com";
  process.env.PUSH_DRIVER = "log";
}
