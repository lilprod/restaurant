import { maskEmail, maskPhone, normalizePhone } from "@restaurant/utils";
import { loadEnv } from "../config/env";
import { HttpSmsDriver, TwilioSmsDriver } from "./drivers/sms";
import { dueLicenseTier } from "./license-tiers";
import { TEMPLATES, renderEmail, type Brand } from "./templates";
import { SMS_MAX_LENGTH, fitSms } from "./templates/types";

const brand: Brand = { name: "Chez Kofi <Lomé>", signature: "À bientôt !", contact: { phone: "+228 90 12 34 56", email: "contact@kofi.tg", address: "Rue 12, Lomé" } };

describe("normalizePhone (E.164, Togo)", () => {
  it.each([
    ["90123456", "+22890123456"],
    ["90 12 34 56", "+22890123456"],
    ["+228 90 12 34 56", "+22890123456"],
    ["00228 90 12 34 56", "+22890123456"],
    ["22890123456", "+22890123456"],
    ["(228) 90-12-34-56", "+22890123456"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("%s → %s", (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it.each(["", "abc", "9012345", "901234567", "+228 9012345", "+2289012345678", "+0123456789", "12", "90 12 34 5x"])("rejette %j", (raw) =>
    expect(normalizePhone(raw)).toBeNull(),
  );

  it("masque les coordonnées", () => {
    expect(maskPhone("+22890123456")).toBe("+228 •• •• 34 56");
    expect(maskEmail("kofi.mensah@gmail.com")).toBe("k••••@gmail.com");
    expect(maskEmail("n'importe quoi")).toBe("••••");
  });
});

describe("modèles", () => {
  const data = { firstName: "Ama", tier: "J7" as const, endDate: "18 novembre 2026", planName: "Pro", licenseUrl: "http://app/r/kofi/licence" };

  it("rend l'email de relance (texte + HTML, marque, signature, pied de page, échappement)", () => {
    const parts = TEMPLATES["license.reminder"].email!(data, brand);
    const mail = renderEmail(parts, brand);
    expect(mail.subject).toBe("Votre licence Chez Kofi <Lomé> expire dans 7 jours");
    expect(mail.text).toContain("18 novembre 2026");
    expect(mail.text).toContain("À bientôt !");
    expect(mail.text).toContain("contact@kofi.tg");
    expect(mail.html).toContain("Chez Kofi &lt;Lomé&gt;");
    expect(mail.html).not.toContain("<Lomé>");
    expect(mail.html).toContain('href="http://app/r/kofi/licence"');
  });

  it("n'insère le logo que s'il existe", () => {
    const withLogo = renderEmail({ subject: "s", paragraphs: ["a"] }, { ...brand, logoUrl: "http://api/logo.png" });
    expect(withLogo.html).toContain('<img src="http://api/logo.png"');
    expect(renderEmail({ subject: "s", paragraphs: ["a"] }, brand).html).not.toContain("<img");
  });

  it("les SMS font 160 caractères au plus, même avec un nom très long", () => {
    for (const tier of ["J7", "J1", "J0"] as const) {
      const sms = TEMPLATES["license.reminder"].sms!({ ...data, tier }, { ...brand, name: "Le grand restaurant gastronomique de la corniche de Lomé et ses jardins" });
      expect(sms.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
      expect(sms.length).toBeGreaterThan(40);
    }
    expect(fitSms("x".repeat(500))).toHaveLength(SMS_MAX_LENGTH);
    expect(TEMPLATES["generic.message"].sms!({ subject: "", text: "y".repeat(400) }, brand).length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it("le lien de réinitialisation n'existe que par email et ses variables ne sont jamais conservées", () => {
    const t = TEMPLATES["auth.password-reset"];
    expect(t.sms).toBeUndefined();
    expect(t.sensitive).toBe(true);
    expect(renderEmail(t.email!({ firstName: "Ama", resetUrl: "http://app/reset-password?token=abc" }, brand), brand).text).toContain("token=abc");
  });
});

describe("paliers de relance de licence", () => {
  const tz = "Africa/Lome";
  const end = new Date("2026-11-18T12:00:00Z");
  const at = (iso: string) => new Date(iso);

  it("J-7 de 7 à 2 jours avant, J-1 la veille, J0 le jour même et peu après, rien avant ni longtemps après", () => {
    expect(dueLicenseTier(end, at("2026-11-10T12:00:00Z"), tz)).toBeNull();
    expect(dueLicenseTier(end, at("2026-11-11T08:00:00Z"), tz)).toBe("J7");
    expect(dueLicenseTier(end, at("2026-11-16T23:00:00Z"), tz)).toBe("J7");
    expect(dueLicenseTier(end, at("2026-11-17T01:00:00Z"), tz)).toBe("J1");
    expect(dueLicenseTier(end, at("2026-11-18T00:30:00Z"), tz)).toBe("J0");
    expect(dueLicenseTier(end, at("2026-11-18T13:00:00Z"), tz)).toBe("J0");
    expect(dueLicenseTier(end, at("2026-11-20T10:00:00Z"), tz)).toBe("J0");
    expect(dueLicenseTier(end, at("2026-11-22T10:00:00Z"), tz)).toBeNull();
  });
});

describe("pilote SMS http générique", () => {
  const msg = { to: "+22890123456", text: 'Dîner "offert" \\ ok' };

  it("JSON : gabarit rempli et échappé, en-têtes personnalisés", () => {
    const d = new HttpSmsDriver({ url: "https://sms.test/send", method: "POST", contentType: "json", from: "MonResto", headers: { Authorization: "Bearer x" }, body: '{"dest":"{{to}}","sender":"{{from}}","text":"{{message}}"}' });
    const { url, init } = d.buildRequest(msg);
    expect(url).toBe("https://sms.test/send");
    expect(JSON.parse(init.body as string)).toEqual({ dest: "+22890123456", sender: "MonResto", text: 'Dîner "offert" \\ ok' });
    expect(init.headers).toMatchObject({ Authorization: "Bearer x", "Content-Type": "application/json" });
  });

  it("formulaire et GET", () => {
    const form = new HttpSmsDriver({ url: "https://sms.test/send", method: "POST", contentType: "form", headers: {}, from: "R" }).buildRequest({ to: "+22890123456", text: "a b&c" });
    expect(form.init.body).toBe("to=%2B22890123456&from=R&message=a%20b%26c");
    const get = new HttpSmsDriver({ url: "https://sms.test/send?key=1", method: "GET", contentType: "json", headers: {}, from: "R" }).buildRequest({ to: "+22890123456", text: "salut" });
    expect(get.init.method).toBe("GET");
    expect(get.url).toBe("https://sms.test/send?key=1&to=%2B22890123456&from=R&message=salut");
  });

  it("échoue sur un code non 2xx, réussit sinon", async () => {
    const mk = (status: number) => new HttpSmsDriver({ url: "https://sms.test", method: "POST", contentType: "json", headers: {} }, (async () => new Response("refusé", { status })) as typeof fetch);
    await expect(mk(500).send(msg)).rejects.toThrow("500");
    await expect(mk(202).send(msg)).resolves.toBeUndefined();
  });

  it("Twilio : authentification Basic et corps formulaire", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const d = new TwilioSmsDriver("ACxxx", "tok", "+15550001", (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 201 }); }) as unknown as typeof fetch);
    await d.send(msg);
    expect(seen!.url).toContain("/Accounts/ACxxx/Messages.json");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("ACxxx:tok").toString("base64")}`);
    expect(String(seen!.init.body)).toContain("To=%2B22890123456");
  });
});

describe("configuration des pilotes (env)", () => {
  const base = { DATABASE_URL: "x", JWT_ACCESS_SECRET: "0123456789abcdef" };

  it("log par défaut, file sync", () => {
    const env = loadEnv(base);
    expect([env.MAIL_DRIVER, env.SMS_DRIVER, env.NOTIFICATIONS_QUEUE]).toEqual(["log", "log", "sync"]);
  });

  it("refuse un pilote réel mal configuré", () => {
    expect(() => loadEnv({ ...base, MAIL_DRIVER: "smtp" })).toThrow("SMTP_URL");
    expect(() => loadEnv({ ...base, SMS_DRIVER: "twilio" })).toThrow("TWILIO_ACCOUNT_SID");
    expect(() => loadEnv({ ...base, SMS_DRIVER: "http" })).toThrow("SMS_HTTP_URL");
    expect(() => loadEnv({ ...base, SMS_DRIVER: "http", SMS_HTTP_URL: "https://s.test", SMS_HTTP_HEADERS: "{pas du json" })).toThrow("SMS_HTTP_HEADERS");
    expect(() => loadEnv({ ...base, NOTIFICATIONS_QUEUE: "bullmq" })).toThrow("REDIS_URL");
  });

  it("accepte les pilotes réels bien configurés", () => {
    expect(loadEnv({ ...base, MAIL_DRIVER: "smtp", SMTP_URL: "smtp://u:p@smtp.test:587" }).MAIL_DRIVER).toBe("smtp");
    expect(loadEnv({ ...base, SMS_DRIVER: "http", SMS_HTTP_URL: "https://s.test/send", SMS_HTTP_HEADERS: '{"Authorization":"Bearer x"}' }).SMS_DRIVER).toBe("http");
  });
});
