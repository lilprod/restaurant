import { loadEnv } from "./env";

describe("loadEnv : secrets", () => {
  const base = { DATABASE_URL: "x", JWT_ACCESS_SECRET: "0123456789abcdef" };
  const prod = {
    DATABASE_URL: "x", NODE_ENV: "production",
    JWT_ACCESS_SECRET: "a".repeat(32), DATA_ENCRYPTION_KEY: "b".repeat(32), TRACKING_TOKEN_SECRET: "c".repeat(32),
  };

  it("en développement, le secret de suivi est facultatif", () => {
    expect(loadEnv(base).TRACKING_TOKEN_SECRET).toBeUndefined();
  });
  it("en production, chaque secret est obligatoire et assez long", () => {
    expect(loadEnv(prod).NODE_ENV).toBe("production");
    expect(() => loadEnv({ ...prod, TRACKING_TOKEN_SECRET: undefined })).toThrow("TRACKING_TOKEN_SECRET");
    expect(() => loadEnv({ ...prod, DATA_ENCRYPTION_KEY: undefined })).toThrow("DATA_ENCRYPTION_KEY");
    expect(() => loadEnv({ ...prod, JWT_ACCESS_SECRET: "0123456789abcdef" })).toThrow("JWT_ACCESS_SECRET");
  });
  it("refuse un même secret pour deux usages", () => {
    expect(() => loadEnv({ ...prod, TRACKING_TOKEN_SECRET: prod.JWT_ACCESS_SECRET })).toThrow("doivent être différents");
    expect(() => loadEnv({ ...base, TRACKING_TOKEN_SECRET: "x".repeat(10) })).toThrow("32 caractères");
  });
  it("TRUST_PROXY : 1 par défaut, entier borné", () => {
    expect(loadEnv(base).TRUST_PROXY).toBe(1);
    expect(loadEnv({ ...base, TRUST_PROXY: "0" }).TRUST_PROXY).toBe(0);
    expect(() => loadEnv({ ...base, TRUST_PROXY: "abc" })).toThrow("TRUST_PROXY");
  });
});
