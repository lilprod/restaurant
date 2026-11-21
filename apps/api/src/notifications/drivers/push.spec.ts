import { createECDH, generateKeyPairSync, randomBytes } from "node:crypto";
import webpush from "web-push";
import { PushGoneError, WebPushDriver } from "./push";

const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
const env = {
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url"),
  VAPID_PRIVATE_KEY: jwk.d!,
  VAPID_SUBJECT: "mailto:test@example.com",
};
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const target = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
const msg = { target, payload: JSON.stringify({ title: "Test", body: "Corps" }), ttl: 300, urgency: "high" as const };

describe("WebPushDriver", () => {
  afterEach(() => jest.restoreAllMocks());

  it("transmet TTL court et urgence haute ; la requête est signée VAPID et la charge utile chiffrée", async () => {
    const spy = jest.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    await new WebPushDriver(env).send(msg);
    const [sub, payload, options] = spy.mock.calls[0]!;
    expect(sub).toEqual({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } });
    expect(options).toMatchObject({ TTL: 300, urgency: "high" });
    // Requête réellement construite par la bibliothèque avec les mêmes paramètres.
    const d = webpush.generateRequestDetails(sub, payload as string, { ...(options as object), vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } });
    expect(d.headers).toMatchObject({ TTL: 300, Urgency: "high", "Content-Encoding": "aes128gcm" });
    expect(d.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect((d.body as Buffer).toString("utf8")).not.toContain("Corps");
  });

  it("404 et 410 → PushGoneError (abonnement à supprimer) ; autre échec → erreur ordinaire (reprise)", async () => {
    const driver = new WebPushDriver(env);
    for (const statusCode of [404, 410]) {
      jest.spyOn(webpush, "sendNotification").mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode }));
      await expect(driver.send(msg)).rejects.toBeInstanceOf(PushGoneError);
    }
    jest.spyOn(webpush, "sendNotification").mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 503 }));
    await expect(driver.send(msg)).rejects.toThrow("503");
    jest.spyOn(webpush, "sendNotification").mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(driver.send(msg)).rejects.not.toBeInstanceOf(PushGoneError);
  });

  it("clés VAPID invalides refusées au démarrage du pilote", () => {
    expect(() => new WebPushDriver({ ...env, VAPID_PRIVATE_KEY: "trop-court" })).toThrow();
  });
});
