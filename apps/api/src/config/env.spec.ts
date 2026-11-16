import { loadEnv } from "./env";

describe("loadEnv : secrets", () => {
  const base = { DATABASE_URL: "x", JWT_ACCESS_SECRET: "0123456789abcdef" };
  const prod = {
    DATABASE_URL: "x", NODE_ENV: "production",
    JWT_ACCESS_SECRET: "a".repeat(32), DATA_ENCRYPTION_KEY: "b".repeat(32), TRACKING_TOKEN_SECRET: "c".repeat(32),
    MAIL_DRIVER: "smtp", SMTP_URL: "smtp://u:p@smtp.example.com:587",
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
  it("en production, refuse le pilote email « log » sauf dérogation explicite", () => {
    const log = { ...prod, MAIL_DRIVER: "log", SMTP_URL: undefined };
    expect(() => loadEnv(log)).toThrow("MAIL_DRIVER");
    expect(() => loadEnv({ ...log, MAIL_DRIVER: undefined })).toThrow("n'envoie aucun email");   // défaut = log
    expect(loadEnv({ ...log, ALLOW_MAIL_LOG: "on" }).MAIL_DRIVER).toBe("log");
    expect(loadEnv({ ...base, MAIL_DRIVER: "log" }).MAIL_DRIVER).toBe("log");                      // développement : libre
  });
  it("STORAGE_DRIVER=s3 exige le bucket et les clés ; disk par défaut", () => {
    expect(loadEnv(base).STORAGE_DRIVER).toBe("disk");
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: "s3" })).toThrow("S3_BUCKET");
    const s3 = { ...base, STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
    expect(loadEnv(s3).S3_REGION).toBe("us-east-1");
    expect(() => loadEnv({ ...s3, S3_ENDPOINT: "pas une url" })).toThrow("S3_ENDPOINT");
  });
  it("une variable vide vaut une variable absente (docker compose, .env)", () => {
    const e = loadEnv({ ...base, S3_ENDPOINT: "", S3_PUBLIC_URL: "", SMS_HTTP_URL: "", SMS_HTTP_METHOD: "", DATA_ENCRYPTION_KEY: "" });
    expect([e.S3_ENDPOINT, e.SMS_HTTP_URL, e.SMS_HTTP_METHOD, e.DATA_ENCRYPTION_KEY]).toEqual([undefined, undefined, "POST", undefined]);
  });
});
