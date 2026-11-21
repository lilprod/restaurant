#!/usr/bin/env node
// Génère une paire de clés VAPID (notifications push web, X5B) : `node scripts/ops/gen-vapid-keys.mjs`.
// Sans dépendance (module crypto de Node). Recopiez les trois lignes dans le .env ; ne commitez jamais la clé privée.
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log(`VAPID_SUBJECT=${process.argv[2] ?? "mailto:contact@exemple.com"}`);
