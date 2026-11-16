import { createHmac } from "node:crypto";
import { loadEnv } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";
import { TrackingService } from "./tracking.service";

describe("TrackingService.tokenFor", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const hmac = (key: string) => createHmac("sha256", key).update(`order-tracking:${id}`).digest("base64url");

  it("utilise le secret dédié, pas celui des JWT", () => {
    const env = loadEnv({ DATABASE_URL: "x", JWT_ACCESS_SECRET: "j".repeat(32), TRACKING_TOKEN_SECRET: "t".repeat(32) });
    const t = new TrackingService({} as PrismaService, env).tokenFor(id);
    expect(t).toBe(hmac("t".repeat(32)));
    expect(t).not.toBe(hmac("j".repeat(32)));
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("hors production, sans secret dédié, reste stable (liens déjà imprimés en développement)", () => {
    const env = loadEnv({ DATABASE_URL: "x", JWT_ACCESS_SECRET: "j".repeat(32) });
    expect(new TrackingService({} as PrismaService, env).tokenFor(id)).toBe(hmac("j".repeat(32)));
  });
});
