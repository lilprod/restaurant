#!/usr/bin/env node
// Audit des dépendances (CI) : échoue sur toute vulnérabilité haute ou critique non justifiée dans
// scripts/ci/audit-allowlist.json (identifiant GHSA → raison + date de réexamen). Une exemption expirée échoue aussi.
//   node scripts/ci/audit.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allow = JSON.parse(readFileSync(new URL("./audit-allowlist.json", import.meta.url), "utf8"));
let out;
try { out = execFileSync("pnpm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
catch (e) { out = e.stdout; }          // pnpm audit sort en erreur dès qu'il trouve quelque chose
const advisories = Object.values(JSON.parse(out).advisories ?? {});
const today = new Date().toISOString().slice(0, 10);
const blocking = [];
for (const a of advisories) {
  if (!["high", "critical"].includes(a.severity)) continue;
  const ex = allow[a.github_advisory_id];
  const ok = ex && ex.until >= today;
  console.log(`${ok ? "exempté" : "BLOQUANT"} ${a.severity} ${a.module_name} ${a.github_advisory_id} — ${a.title}${ok ? ` (${ex.reason}, jusqu'au ${ex.until})` : ""}`);
  if (!ok) blocking.push(a);
}
const counts = advisories.reduce((m, a) => ({ ...m, [a.severity]: (m[a.severity] ?? 0) + 1 }), {});
console.log(`Vulnérabilités : ${JSON.stringify(counts)} · bloquantes : ${blocking.length}`);
process.exit(blocking.length ? 1 : 0);
