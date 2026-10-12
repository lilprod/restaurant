import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { authenticator } from "otplib";
import { rmSync } from "node:fs";
import request from "supertest";
import { MailService } from "../src/mail/mail.service";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const DAY = 86_400_000;
const PW = "Cigale-Bleue74";
const PW2 = "Pirogue-Verte88";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PNG2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("Sécurité & paramètres (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let root: string;
  let supportTok: string;
  let tenantId: string;
  let adminUserId: string;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const V = "/api/v1";

  const tenantLogin = (slug: string, email: string, password: string) =>
    api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password });
  const tok = async (slug: string, email: string, password: string) => (await tenantLogin(slug, email, password)).body.accessToken as string;
  const addUser = (tId: string, role: string, email: string, password = PW) =>
    asPlatform(prisma, async (tx) =>
      tx.user.create({ data: { tenantId: tId, email, role: role as never, firstName: "Test", lastName: role, passwordHash: await argon2.hash(password), passwordChangedAt: new Date() } }));
  const createTenant = async (slug: string, adminEmail: string) => {
    const res = await api().post(`${V}/platform/tenants`).set(bearer(root)).send({
      name: slug.toUpperCase(), slug, email: `contact@${slug}.tg`, planId: seed.pro.id,
      admin: { firstName: "Ama", lastName: "Koffi", email: adminEmail, password: PW },
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true });
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    app = await createApp();
    root = (await login(app, "root@test.local")).body.accessToken;
    supportTok = (await login(app, "support@test.local")).body.accessToken;
    tenantId = await createTenant("kofi", "admin@kofi.tg");
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────── A. connexion & mot de passe ─────────────────────────────
  describe("connexion d'un restaurant", () => {
    it("reste muet sur l'existence des comptes", async () => {
      const a = await tenantLogin("inconnu", "admin@kofi.tg", PW);
      const b = await tenantLogin("kofi", "nobody@kofi.tg", PW);
      const c = await tenantLogin("kofi", "admin@kofi.tg", "faux");
      expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
      expect(a.body.message).toBe(b.body.message);
      expect(b.body.message).toBe(c.body.message);
    });

    it("impose le changement du mot de passe choisi par le SuperAdmin", async () => {
      const res = await tenantLogin("kofi", "admin@kofi.tg", PW);
      expect(res.status).toBe(200);
      expect(res.body.restriction).toBe("pwd-change");
      adminUserId = res.body.user.id;
      const blocked = await api().get(`${V}/tenant/settings/operations`).set(bearer(res.body.accessToken));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe("RESTRICTED_SESSION");
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(res.body.accessToken))).status).toBe(200);
    });

    it("change le mot de passe en respectant la politique, puis demande de se reconnecter", async () => {
      const t = await tok("kofi", "admin@kofi.tg", PW);
      const change = (body: object) => api().post(`${V}/tenant/account/change-password`).set(bearer(t)).send(body);
      expect((await change({ currentPassword: "faux", newPassword: PW2 })).status).toBe(401);
      const weak = await change({ currentPassword: PW, newPassword: "abcdefgh" });
      expect(weak.status).toBe(400);
      expect(weak.body.errors.length).toBeGreaterThan(1);
      expect((await change({ currentPassword: PW, newPassword: PW })).status).toBe(400);
      const ok = await change({ currentPassword: PW, newPassword: PW2 });
      expect(ok.status).toBe(200);
      expect(ok.body.reloginRequired).toBe(true);
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(t))).status).toBe(401);   // session fermée
      const again = await tenantLogin("kofi", "admin@kofi.tg", PW2);
      expect(again.body.restriction).toBeNull();
    });
  });

  // ───────────────────────────── paramètres (rôles, validation) ─────────────────────────────
  describe("paramètres du restaurant", () => {
    let admin: string;
    let manager: string;
    let waiter: string;
    beforeAll(async () => {
      await addUser(tenantId, "MANAGER", "manager@kofi.tg");
      await addUser(tenantId, "WAITER", "waiter@kofi.tg");
      admin = await tok("kofi", "admin@kofi.tg", PW2);
      manager = await tok("kofi", "manager@kofi.tg", PW);
      waiter = await tok("kofi", "waiter@kofi.tg", PW);
    });
    const get = (t: string, p: string) => api().get(`${V}/tenant/settings${p}`).set(bearer(t));
    const patch = (t: string, section: string, body: object) => api().patch(`${V}/tenant/settings/${section}`).set(bearer(t)).send(body);

    it("renvoie les valeurs par défaut (FCFA, Lomé, TVA 18 %) et le thème", async () => {
      const res = await get(admin, "");
      expect(res.status).toBe(200);
      expect(res.body.currency).toBe("XOF");
      expect(res.body.localization.timezone).toBe("Africa/Lome");
      expect(res.body.operations.defaultVatRate).toBe(18);
      expect(res.body.branding.theme.kitchenDark).toBe(true);
      expect(res.body.security.passwordPolicy.minLength).toBe(10);
    });

    it("limite la lecture et l'écriture selon le rôle", async () => {
      const m = await get(manager, "");
      expect(Object.keys(m.body)).not.toContain("security");
      expect((await get(manager, "/security")).status).toBe(403);
      expect((await patch(manager, "business", { tradeName: "Pirate" })).status).toBe(403);
      expect((await get(waiter, "/operations")).status).toBe(200);
      expect((await get(waiter, "/business")).status).toBe(403);
      expect((await get(admin, "/inconnue")).status).toBe(404);
      expect((await api().get(`${V}/tenant/settings`)).status).toBe(401);
    });

    it("enregistre les informations complètes et les synchronise avec la fiche SuperAdmin", async () => {
      const res = await patch(admin, "business", {
        tradeName: "Chez Kofi", legalName: "Kofi SARL", taxId: "NIF-123456", registrationNumber: "RCCM-TG-LOM-2024",
        description: "Cuisine togolaise", website: "https://chezkofi.tg", phone: "+22890000000",
        address: { street: "Rue du Commerce", city: "Lomé", country: "Togo" },
        social: { instagram: "https://instagram.com/chezkofi" },
        receipt: { footerText: "Merci de votre visite !" },
      });
      expect(res.status).toBe(200);
      expect(res.body.taxId).toBe("NIF-123456");
      expect(res.body.receipt.showLogo).toBe(true);          // valeur par défaut conservée
      const t = await api().get(`${V}/platform/tenants/${tenantId}`).set(bearer(root));
      expect(t.body.name).toBe("Chez Kofi");
      expect(t.body.address).toBe("Rue du Commerce, Lomé, Togo");
      expect(t.body.phone).toBe("+22890000000");
    });

    it("permet d'effacer un champ avec une chaîne vide et refuse les valeurs invalides", async () => {
      expect((await patch(admin, "business", { website: "" })).body.website).toBeUndefined();
      const bad = await patch(admin, "business", { website: "pas-une-url", email: "x" });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(["website", "email"]));
    });

    it("gère le thème et calcule les variables CSS lisibles", async () => {
      const res = await patch(admin, "branding", { displayName: "Chez Kofi", tagline: "Le goût du pays", theme: { primary: "#0369A1", radius: "xl", fontFamily: "poppins", mode: "dark" } });
      expect(res.status).toBe(200);
      expect(res.body.theme.accent).toBeDefined();           // champs non fournis conservés
      expect(res.body.preview.cssVars["--color-primary"]).toBe("#0369A1");
      expect(res.body.preview.cssVars["--color-on-primary"]).toBe("#FFFFFF");
      expect(res.body.preview.cssVars["--radius"]).toBe("20px");
      expect((await patch(admin, "branding", { theme: { primary: "#12" } })).status).toBe(400);
      expect((await patch(admin, "branding", { theme: { fontFamily: "comic-sans" } })).status).toBe(400);
      expect((await patch(admin, "branding", { displayName: "A" })).status).toBe(400);
    });

    it("valide la localisation et l'exploitation", async () => {
      expect((await patch(admin, "localization", { timezone: "Mars/Olympus" })).status).toBe(400);
      expect((await patch(admin, "localization", { timezone: "Africa/Accra", locale: "en" })).status).toBe(200);
      const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect([t.timezone, t.locale]).toEqual(["Africa/Accra", "en"]);
      await patch(admin, "localization", { timezone: "Africa/Lome", locale: "fr" });
      expect((await patch(admin, "operations", { reservationSlotMinutes: 7 })).status).toBe(400);
      const ops = await patch(admin, "operations", { tipPresets: [5, 10], deliveryEnabled: true, defaultVatRate: 18 });
      expect(ops.body.tipPresets).toEqual([5, 10]);
      expect(ops.body.reservationDurationMinutes).toBe(90);
    });

    it("expose la marque du restaurant avant connexion", async () => {
      const res = await api().get(`${V}/public/tenants/kofi/branding`);
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe("Chez Kofi");
      expect(res.body.cssVars["--color-primary"]).toBe("#0369A1");
      expect(JSON.stringify(res.body)).not.toMatch(/taxId|passwordHash|security/);
      expect((await api().get(`${V}/public/tenants/inconnu/branding`)).status).toBe(404);
    });

    it("journalise les modifications dans l'audit du restaurant", async () => {
      const logs = await asPlatform(prisma, (tx) => tx.auditLog.findMany({ where: { tenantId, action: { startsWith: "settings." } } }));
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["settings.business.update", "settings.branding.update"]));
    });
  });

  // ───────────────────────────── logo & favicon ─────────────────────────────
  describe("logo et favicon", () => {
    let admin: string;
    let manager: string;
    beforeAll(async () => {
      admin = await tok("kofi", "admin@kofi.tg", PW2);
      manager = await tok("kofi", "manager@kofi.tg", PW);
    });
    const upload = (t: string, kind: string, buf: Buffer, name = "f.png") =>
      api().post(`${V}/tenant/settings/assets/${kind}`).set(bearer(t)).attach("file", buf, { filename: name });
    const path = (url: string) => url.replace("http://api.test", "");

    it("enregistre un logo servi avec des en-têtes sûrs, et supprime l'ancien au remplacement", async () => {
      const first = await upload(admin, "logo", PNG, "logo.png");
      expect(first.status).toBe(201);
      expect(first.body.url).toMatch(new RegExp(`^http://api.test/uploads/tenants/${tenantId}/logo-[0-9a-f]{16}\\.png$`));
      const file = await api().get(path(first.body.url));
      expect(file.status).toBe(200);
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
      expect(file.headers["content-security-policy"]).toContain("sandbox");
      const second = await upload(admin, "logo", PNG2, "nouveau.png");
      expect(second.body.url).not.toBe(first.body.url);
      expect((await api().get(path(first.body.url))).status).toBe(404);
      expect((await api().get(path(second.body.url))).status).toBe(200);
    });

    it("refuse le SVG, les faux fichiers et les formats non prévus", async () => {
      expect((await upload(admin, "logo", SVG, "logo.svg")).status).toBe(400);
      expect((await upload(admin, "logo", Buffer.from("MZ exécutable"), "logo.png")).status).toBe(400);
      expect((await upload(admin, "favicon", JPEG, "f.jpg")).status).toBe(400);
      expect((await upload(admin, "logo", Buffer.concat([PNG, Buffer.alloc(2.5 * 1024 * 1024)]))).status).toBe(400);
      expect((await upload(admin, "nimporte", PNG)).status).toBe(400);
      expect((await api().post(`${V}/tenant/settings/assets/logo`).set(bearer(admin))).status).toBe(400);   // sans fichier
    });

    it("accepte un favicon ICO et réserve l'envoi à l'administrateur", async () => {
      expect((await upload(admin, "favicon", ICO, "favicon.ico")).status).toBe(201);
      expect((await upload(manager, "logo", PNG)).status).toBe(403);
    });

    it("les fichiers sont isolés par restaurant et visibles dans la marque publique", async () => {
      const pub = (await api().get(`${V}/public/tenants/kofi/branding`)).body;
      expect(pub.logoUrl).toContain(`/tenants/${tenantId}/`);
      expect(pub.faviconUrl).toMatch(/favicon-.*\.ico$/);
      expect(pub.logoDarkUrl).toBe(pub.logoUrl);               // repli quand il n'y a pas de logo sombre
    });

    it("supprime un logo (fichier compris)", async () => {
      const url = (await api().get(`${V}/public/tenants/kofi/branding`)).body.logoUrl as string;
      expect((await api().delete(`${V}/tenant/settings/assets/logo`).set(bearer(admin))).status).toBe(204);
      expect((await api().get(`${V}/public/tenants/kofi/branding`)).body.logoUrl).toBeNull();
      expect((await api().get(path(url))).status).toBe(404);
    });
  });

  // ───────────────────────────── verrouillage ─────────────────────────────
  describe("verrouillage de compte", () => {
    it("verrouille après 5 échecs, même avec le bon mot de passe, puis l'administrateur déverrouille", async () => {
      const waiter = (await asPlatform(prisma, (tx) => tx.user.findFirstOrThrow({ where: { email: "waiter@kofi.tg" } }))).id;
      for (let i = 0; i < 5; i++) expect((await tenantLogin("kofi", "waiter@kofi.tg", "mauvais")).status).toBe(401);
      const locked = await tenantLogin("kofi", "waiter@kofi.tg", PW);
      expect(locked.status).toBe(423);
      expect(locked.body.code).toBe("ACCOUNT_LOCKED");
      const admin = await tok("kofi", "admin@kofi.tg", PW2);
      const users = await api().get(`${V}/tenant/security/users`).set(bearer(admin));
      expect(users.body.find((u: { id: string }) => u.id === waiter).locked).toBe(true);
      expect((await api().post(`${V}/tenant/security/users/${waiter}/unlock`).set(bearer(admin))).status).toBe(200);
      expect((await tenantLogin("kofi", "waiter@kofi.tg", PW)).status).toBe(200);
      const events = await api().get(`${V}/tenant/security/login-events`).set(bearer(admin));
      expect(events.body.map((e: { result: string }) => e.result)).toEqual(expect.arrayContaining(["LOCKED", "BAD_PASSWORD", "SUCCESS"]));
    });

    it("réserve la gestion de la sécurité à l'administrateur", async () => {
      const waiter = await tok("kofi", "waiter@kofi.tg", PW);
      expect((await api().get(`${V}/tenant/security/users`).set(bearer(waiter))).status).toBe(403);
    });
  });

  // ───────────────────────────── 2FA ─────────────────────────────
  describe("double authentification", () => {
    let admin: string;
    let secret: string;
    let recovery: string[];
    beforeAll(async () => { admin = await tok("kofi", "admin@kofi.tg", PW2); });
    const acct = (p: string) => `${V}/tenant/account/${p}`;

    it("s'active en deux étapes et remet des codes de secours", async () => {
      const setup = await api().post(acct("2fa/setup")).set(bearer(admin));
      expect(setup.status).toBe(200);
      expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      secret = setup.body.secret;
      expect((await api().post(acct("2fa/enable")).set(bearer(admin)).send({ code: "000000" })).status).toBe(400);
      const stored = await asPlatform(prisma, (tx) => tx.user.findUniqueOrThrow({ where: { id: adminUserId } }));
      expect(stored.twoFactorSecret).not.toContain(secret);   // chiffré en base
      const ok = await api().post(acct("2fa/enable")).set(bearer(admin)).send({ code: authenticator.generate(secret) });
      expect(ok.status).toBe(200);
      recovery = ok.body.recoveryCodes;
      expect(recovery).toHaveLength(8);
      expect((await api().post(acct("2fa/setup")).set(bearer(admin))).status).toBe(409);
    });

    it("exige le second facteur à la connexion", async () => {
      const first = await tenantLogin("kofi", "admin@kofi.tg", PW2);
      expect(first.body.twoFactorRequired).toBe(true);
      expect(first.body.accessToken).toBeUndefined();
      const verify = (code: string) => api().post(`${V}/tenant/auth/2fa/verify`).send({ challengeToken: first.body.challengeToken, code });
      expect((await verify("123456")).status).toBe(401);
      const ok = await verify(authenticator.generate(secret));
      expect(ok.status).toBe(200);
      expect(ok.body.accessToken).toBeDefined();
    });

    it("accepte un code de secours une seule fois", async () => {
      const verifyWith = async (code: string) => {
        const c = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body.challengeToken;
        return api().post(`${V}/tenant/auth/2fa/verify`).send({ challengeToken: c, code });
      };
      expect((await verifyWith(recovery[0])).status).toBe(200);
      expect((await verifyWith(recovery[0])).status).toBe(401);
      expect((await verifyWith(recovery[1].toLowerCase().replace("-", " "))).status).toBe(200);
      expect((await asPlatform(prisma, (tx) => tx.user.findUniqueOrThrow({ where: { id: adminUserId } }))).recoveryCodeHashes).toHaveLength(6);
    });

    it("verrouille aussi sur les codes 2FA faux répétés", async () => {
      const c = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body.challengeToken;
      for (let i = 0; i < 5; i++) await api().post(`${V}/tenant/auth/2fa/verify`).send({ challengeToken: c, code: "111111" });
      const res = await api().post(`${V}/tenant/auth/2fa/verify`).send({ challengeToken: c, code: authenticator.generate(secret) });
      expect(res.status).toBe(423);
      await asPlatform(prisma, (tx) => tx.user.update({ where: { id: adminUserId }, data: { lockedUntil: null, failedLoginCount: 0 } }));
    });

    it("se désactive avec mot de passe et code", async () => {
      const challengeToken = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body.challengeToken;
      const t = (await api().post(`${V}/tenant/auth/2fa/verify`).send({ challengeToken, code: authenticator.generate(secret) })).body.accessToken as string;
      expect((await api().post(acct("2fa/disable")).set(bearer(t)).send({ password: "faux", code: authenticator.generate(secret) })).status).toBe(401);
      expect((await api().post(acct("2fa/disable")).set(bearer(t)).send({ password: PW2 })).status).toBe(401);   // code manquant
      const ok = await api().post(acct("2fa/disable")).set(bearer(t)).send({ password: PW2, code: authenticator.generate(secret) });
      expect(ok.body.enabled).toBe(false);
      expect((await tenantLogin("kofi", "admin@kofi.tg", PW2)).body.accessToken).toBeDefined();
    });
  });

  // ───────────────────────────── sessions ─────────────────────────────
  describe("sessions", () => {
    it("liste les appareils connectés et permet de les déconnecter", async () => {
      const a = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body;
      const b = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body;
      const list = await api().get(`${V}/tenant/account/sessions`).set(bearer(a.accessToken));
      expect(list.body.length).toBeGreaterThanOrEqual(2);
      expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      const other = list.body.find((s: { current: boolean }) => !s.current).id;
      expect((await api().delete(`${V}/tenant/account/sessions/${other}`).set(bearer(a.accessToken))).status).toBe(204);
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(b.accessToken))).status).toBe(401);   // effet immédiat
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(a.accessToken))).status).toBe(200);
      expect((await api().delete(`${V}/tenant/account/sessions/${other}`).set(bearer(a.accessToken))).status).toBe(404);
    });

    it("renouvelle une session avec rotation et refuse un jeton rejoué", async () => {
      const s = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body;
      const r = await api().post(`${V}/tenant/auth/refresh`).send({ refreshToken: s.refreshToken });
      expect(r.status).toBe(200);
      expect((await api().post(`${V}/tenant/auth/refresh`).send({ refreshToken: s.refreshToken })).status).toBe(401);
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(r.body.accessToken))).status).toBe(200);
      // un jeton de la plateforme ne fonctionne pas côté restaurant, et inversement
      expect((await api().post(`${V}/platform/auth/refresh`).send({ refreshToken: r.body.refreshToken })).status).toBe(401);
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(root))).status).toBe(401);
      expect((await api().get(`${V}/platform/account/me`).set(bearer(r.body.accessToken))).status).toBe(401);
    });

    it("la déconnexion révoque la session", async () => {
      const s = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body;
      expect((await api().post(`${V}/tenant/auth/logout`).send({ refreshToken: s.refreshToken })).status).toBe(204);
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(s.accessToken))).status).toBe(401);
    });
  });

  // ───────────────────────────── mot de passe oublié ─────────────────────────────
  describe("mot de passe oublié", () => {
    it("envoie un lien à usage unique sans révéler si le compte existe", async () => {
      const mail = app.get(MailService);
      mail.outbox.length = 0;
      const known = await api().post(`${V}/tenant/auth/forgot-password`).send({ email: "waiter@kofi.tg", tenantSlug: "kofi" });
      const unknown = await api().post(`${V}/tenant/auth/forgot-password`).send({ email: "personne@kofi.tg", tenantSlug: "kofi" });
      expect([known.status, unknown.status]).toEqual([202, 202]);
      expect(known.body).toEqual(unknown.body);
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0].to).toBe("waiter@kofi.tg");
      const token = /token=([\w-]+)/.exec(mail.outbox[0].text)![1];

      const reset = (newPassword: string) => api().post(`${V}/tenant/auth/reset-password`).send({ token, newPassword });
      expect((await reset("faible")).status).toBe(400);
      const sessionBefore = (await tenantLogin("kofi", "waiter@kofi.tg", PW)).body;
      expect((await reset(PW2)).status).toBe(200);
      expect((await tenantLogin("kofi", "waiter@kofi.tg", PW)).status).toBe(401);
      expect((await tenantLogin("kofi", "waiter@kofi.tg", PW2)).status).toBe(200);
      expect((await reset("Autre-Mot2Passe9")).status).toBe(401);                       // lien déjà utilisé
      expect((await api().get(`${V}/tenant/account/me`).set(bearer(sessionBefore.accessToken))).status).toBe(401);
    });
  });

  // ───────────────────────────── politique de sécurité du restaurant ─────────────────────────────
  describe("politique de sécurité", () => {
    let admin: string;
    beforeAll(async () => { admin = await tok("kofi", "admin@kofi.tg", PW2); });
    const secPatch = (body: object) => api().patch(`${V}/tenant/settings/security`).set(bearer(admin)).send(body);

    it("rend la 2FA obligatoire pour un rôle et restreint la session jusqu'à l'activation", async () => {
      expect((await secPatch({ maxFailedAttempts: 1 })).status).toBe(400);
      expect((await secPatch({ require2faRoles: ["CUSTOMER"] })).status).toBe(400);
      expect((await secPatch({ require2faRoles: ["MANAGER"], passwordPolicy: { minLength: 14 } })).status).toBe(200);

      const m = await tenantLogin("kofi", "manager@kofi.tg", PW);
      expect(m.body.restriction).toBe("2fa-setup");
      const t = m.body.accessToken;
      const blocked = await api().get(`${V}/tenant/settings/operations`).set(bearer(t));
      expect([blocked.status, blocked.body.restriction]).toEqual([403, "2fa-setup"]);

      const setup = await api().post(`${V}/tenant/account/2fa/setup`).set(bearer(t));
      expect(setup.status).toBe(200);
      expect((await api().post(`${V}/tenant/account/2fa/enable`).set(bearer(t)).send({ code: authenticator.generate(setup.body.secret) })).status).toBe(200);
      expect((await api().get(`${V}/tenant/settings/operations`).set(bearer(t))).status).toBe(200);   // restriction levée aussitôt
      const off = await api().post(`${V}/tenant/account/2fa/disable`).set(bearer(t)).send({ password: PW, code: authenticator.generate(setup.body.secret) });
      expect(off.status).toBe(409);                                                                  // obligatoire pour ce rôle
    });

    it("applique la nouvelle longueur minimale des mots de passe", async () => {
      const t = await tok("kofi", "waiter@kofi.tg", PW2);
      const res = await api().post(`${V}/tenant/account/change-password`).set(bearer(t)).send({ currentPassword: PW2, newPassword: "Pirogue-Verte9" });
      expect(res.status).toBe(200);   // 14 caractères
      const short = await tok("kofi", "waiter@kofi.tg", "Pirogue-Verte9");
      const res2 = await api().post(`${V}/tenant/account/change-password`).set(bearer(short)).send({ currentPassword: "Pirogue-Verte9", newPassword: "Court-Mot2Passe" });
      expect(res2.status).toBe(200);  // 15 caractères
      const t3 = await tok("kofi", "waiter@kofi.tg", "Court-Mot2Passe");
      const res3 = await api().post(`${V}/tenant/account/change-password`).set(bearer(t3)).send({ currentPassword: "Court-Mot2Passe", newPassword: "Court-Mot2P1" });
      expect(res3.status).toBe(400);  // 12 < 14
    });

    it("le SuperAdmin peut retirer la 2FA perdue et réinitialiser un mot de passe", async () => {
      const manager = (await asPlatform(prisma, (tx) => tx.user.findFirstOrThrow({ where: { email: "manager@kofi.tg" } }))).id;
      expect((await api().post(`${V}/platform/tenants/${tenantId}/security/users/${manager}/disable-2fa`).set(bearer(root))).status).toBe(200);
      const reset = await api().post(`${V}/platform/tenants/${tenantId}/security/users/${manager}/reset-password`).set(bearer(root));
      expect(reset.body.temporaryPassword).toHaveLength(14);
      const l = await tenantLogin("kofi", "manager@kofi.tg", reset.body.temporaryPassword);
      expect(l.body.restriction).toBe("pwd-change");
      expect((await api().post(`${V}/platform/tenants/${tenantId}/security/users/${manager}/revoke-sessions`).set(bearer(root))).status).toBe(200);
      const audit = await prisma.platformAuditLog.findMany({ where: { action: { startsWith: "security." } } });
      expect(audit.length).toBeGreaterThanOrEqual(3);
      await secPatch({ require2faRoles: [], passwordPolicy: { minLength: 10 } });
    });
  });

  // ───────────────────────────── licence ─────────────────────────────
  describe("blocage par la licence", () => {
    let admin: string;
    beforeAll(async () => {
      await api().patch(`${V}/platform/settings/paymentInstructions`).set(bearer(root))
        .send({ flooz: { number: "90123456", holder: "Gestion Restaurant SARL" }, tmoney: { number: "91123456" }, instructions: "Envoyez la preuve de paiement." });
      admin = await tok("kofi", "admin@kofi.tg", PW2);
    });
    const setSub = (data: object) => prisma.subscription.updateMany({ where: { tenantId }, data });

    it("montre au restaurant sa licence et comment payer", async () => {
      const res = await api().get(`${V}/tenant/license`).set(bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("TRIALING");
      expect(res.body.plan.code).toBe("PRO");
      expect(res.body.daysLeft).toBeGreaterThanOrEqual(13);
      expect(res.body.howToPay.flooz.number).toBe("90123456");
      expect(res.body.howToPay.tmoney.number).toBe("91123456");
      const waiter = await tok("kofi", "waiter@kofi.tg", "Court-Mot2Passe");
      expect((await api().get(`${V}/tenant/license`).set(bearer(waiter))).status).toBe(403);
    });

    it("garde l'accès pendant la période de grâce", async () => {
      await setSub({ status: "GRACE", currentPeriodEnd: new Date(Date.now() - 2 * DAY), graceEndsAt: new Date(Date.now() + 5 * DAY) });
      expect((await api().get(`${V}/tenant/settings/operations`).set(bearer(admin))).status).toBe(200);
      const login2 = await tenantLogin("kofi", "admin@kofi.tg", PW2);
      expect(login2.body.license.inGrace).toBe(true);
    });

    it("coupe l'accès, les connexions et les renouvellements quand la licence est expirée, puis le rétablit au paiement", async () => {
      const refresh = (await tenantLogin("kofi", "admin@kofi.tg", PW2)).body.refreshToken;
      await setSub({ status: "EXPIRED", currentPeriodEnd: new Date(Date.now() - 20 * DAY) });
      await prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });

      const blocked = await api().get(`${V}/tenant/settings/operations`).set(bearer(admin));
      expect([blocked.status, blocked.body.code]).toEqual([403, "LICENSE_BLOCKED"]);
      const l = await tenantLogin("kofi", "admin@kofi.tg", PW2);
      expect([l.status, l.body.code]).toEqual([403, "LICENSE_BLOCKED"]);
      expect((await api().post(`${V}/tenant/auth/refresh`).send({ refreshToken: refresh })).status).toBe(403);
      // la marque publique reste visible (page de connexion)
      expect((await api().get(`${V}/public/tenants/kofi/branding`)).status).toBe(200);

      const pay = await api().post(`${V}/platform/payments`).set(bearer(root)).send({ tenantId, method: "TMONEY", reference: "TM-9001", billingCycle: "MONTHLY" });
      expect(pay.status).toBe(201);
      expect((await tenantLogin("kofi", "admin@kofi.tg", PW2)).status).toBe(200);
    });
  });

  // ───────────────────────────── plateforme ─────────────────────────────
  describe("paramètres et sécurité de la plateforme", () => {
    it("enregistre l'identité complète de l'éditeur", async () => {
      const res = await api().patch(`${V}/platform/settings/company`).set(bearer(root)).send({
        legalName: "Gestion Restaurant SARL", taxId: "NIF-998877", registrationNumber: "RCCM-TG-LOM-2025",
        address: { street: "Boulevard du 13 Janvier", city: "Lomé", country: "Togo" },
        email: "contact@gestion-restaurant.tg", supportEmail: "support@gestion-restaurant.tg", supportPhone: "+22890112233",
        website: "https://gestion-restaurant.tg", social: { facebook: "https://facebook.com/gestionrestaurant" },
      });
      expect(res.status).toBe(200);
      expect(res.body.taxId).toBe("NIF-998877");
      expect((await api().patch(`${V}/platform/settings/company`).set(bearer(root)).send({ website: "nope" })).status).toBe(400);
    });

    it("gère la marque de la plateforme, son logo et son favicon", async () => {
      await api().patch(`${V}/platform/settings/branding`).set(bearer(root)).send({ displayName: "Gestion Restaurant", theme: { primary: "#4D7C0F", accent: "#EAB308" } });
      const logo = await api().post(`${V}/platform/settings/assets/logo`).set(bearer(root)).attach("file", PNG, { filename: "l.png" });
      const fav = await api().post(`${V}/platform/settings/assets/favicon`).set(bearer(root)).attach("file", ICO, { filename: "f.ico" });
      expect([logo.status, fav.status]).toEqual([201, 201]);
      expect(logo.body.url).toMatch(/^http:\/\/api\.test\/uploads\/platform\/logo-/);
      const pub = await api().get(`${V}/public/branding`);
      expect(pub.body.displayName).toBe("Gestion Restaurant");
      expect(pub.body.logoUrl).toBe(logo.body.url);
      expect(pub.body.support.email).toBe("support@gestion-restaurant.tg");
      expect(pub.body.cssVars["--color-primary"]).toBe("#4D7C0F");
      expect((await api().post(`${V}/platform/settings/assets/logo`).set(bearer(supportTok)).attach("file", PNG, { filename: "l.png" })).status).toBe(403);
      expect((await api().post(`${V}/platform/settings/assets/logo`).set(bearer(root)).attach("file", SVG, { filename: "l.svg" })).status).toBe(400);
    });

    it("limite le rôle Support en lecture et masque la sécurité", async () => {
      const all = await api().get(`${V}/platform/settings`).set(bearer(supportTok));
      expect(all.status).toBe(200);
      expect(all.body.company.legalName).toBe("Gestion Restaurant SARL");
      expect(all.body.security).toBeUndefined();
      expect((await api().get(`${V}/platform/settings/security`).set(bearer(supportTok))).status).toBe(403);
      expect((await api().patch(`${V}/platform/settings/company`).set(bearer(supportTok)).send({ legalName: "Pirate" })).status).toBe(403);
      expect((await api().patch(`${V}/platform/settings/inconnue`).set(bearer(root)).send({})).status).toBe(404);
    });

    it("règle le délai de grâce des licences", async () => {
      expect((await api().patch(`${V}/platform/settings/licensing`).set(bearer(root)).send({ graceDays: 99 })).status).toBe(400);
      const ok = await api().patch(`${V}/platform/settings/licensing`).set(bearer(root)).send({ graceDays: 3 });
      expect(ok.body.graceDays).toBe(3);
      const id = await createTenant("grace", "admin@grace.tg");
      await prisma.subscription.updateMany({ where: { tenantId: id }, data: { currentPeriodEnd: new Date(Date.now() - 4 * DAY) } });
      await api().post(`${V}/platform/licensing/sweep`).set(bearer(root));
      expect((await prisma.subscription.findFirstOrThrow({ where: { tenantId: id } })).status).toBe("EXPIRED");   // 4 j > 3 j de grâce
      await api().patch(`${V}/platform/settings/licensing`).set(bearer(root)).send({ graceDays: 7 });
    });

    it("gère l'équipe de la plateforme", async () => {
      const created = await api().post(`${V}/platform/users`).set(bearer(root)).send({ email: "agent@plateforme.tg", firstName: "Agent", lastName: "Dossou", role: "SUPPORT" });
      expect(created.status).toBe(201);
      const l = await login(app, "agent@plateforme.tg", created.body.temporaryPassword);
      expect(l.body.restriction).toBe("pwd-change");
      expect((await api().get(`${V}/platform/tenants`).set(bearer(l.body.accessToken))).status).toBe(403);   // restreint
      expect((await api().post(`${V}/platform/users`).set(bearer(supportTok)).send({})).status).toBe(403);
      const me = (await api().get(`${V}/platform/account/me`).set(bearer(root))).body.id;
      expect((await api().patch(`${V}/platform/users/${me}`).set(bearer(root)).send({ isActive: false })).status).toBe(409);
      expect((await api().patch(`${V}/platform/users/${created.body.id}`).set(bearer(root)).send({ isActive: false })).status).toBe(200);
      expect((await login(app, "agent@plateforme.tg", created.body.temporaryPassword)).status).toBe(401);
      const list = await api().get(`${V}/platform/users`).set(bearer(root));
      expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|twoFactorSecret/);
    });

    it("journalise les connexions de toute la plateforme", async () => {
      const res = await api().get(`${V}/platform/security/login-events?limit=100`).set(bearer(root));
      expect(res.status).toBe(200);
      expect(res.body.some((e: { space: string }) => e.space === "tenant")).toBe(true);
      expect(res.body.some((e: { space: string }) => e.space === "platform")).toBe(true);
      const locked = await api().get(`${V}/platform/security/login-events?result=LOCKED`).set(bearer(root));
      expect(locked.body.every((e: { result: string }) => e.result === "LOCKED")).toBe(true);
      expect((await api().get(`${V}/platform/security/login-events`).set(bearer(supportTok))).status).toBe(403);
    });

    it("le SuperAdmin modifie la marque d'un restaurant pour lui", async () => {
      const res = await api().patch(`${V}/platform/tenants/${tenantId}/settings/branding`).set(bearer(root)).send({ tagline: "Modifié par le support" });
      expect(res.status).toBe(200);
      expect((await api().get(`${V}/public/tenants/kofi/branding`)).body.tagline).toBe("Modifié par le support");
      const up = await api().post(`${V}/platform/tenants/${tenantId}/assets/logo`).set(bearer(root)).attach("file", PNG, { filename: "l.png" });
      expect(up.status).toBe(201);
      expect(up.body.url).toContain(`/tenants/${tenantId}/`);
    });

    it("rend la 2FA obligatoire pour la plateforme sans enfermer le SuperAdmin", async () => {
      expect((await api().patch(`${V}/platform/settings/security`).set(bearer(root)).send({ require2fa: true })).status).toBe(200);
      const l = await login(app, "root@test.local");
      expect(l.body.restriction).toBe("2fa-setup");
      const t = l.body.accessToken;
      const blocked = await api().get(`${V}/platform/settings/security`).set(bearer(t));
      expect([blocked.status, blocked.body.code]).toEqual([403, "RESTRICTED_SESSION"]);
      const setup = await api().post(`${V}/platform/account/2fa/setup`).set(bearer(t));
      await api().post(`${V}/platform/account/2fa/enable`).set(bearer(t)).send({ code: authenticator.generate(setup.body.secret) });
      expect((await api().patch(`${V}/platform/settings/security`).set(bearer(t)).send({ require2fa: false })).status).toBe(200);
    });
  });

  // ───────────────────────────── isolation ─────────────────────────────
  describe("isolation entre restaurants", () => {
    it("un administrateur ne voit ni ne modifie les comptes et réglages d'un autre restaurant", async () => {
      const otherId = await createTenant("autre", "admin@autre.tg");
      const otherAdmin = (await asPlatform(prisma, (tx) => tx.user.findFirstOrThrow({ where: { tenantId: otherId } }))).id;
      const admin = await tok("kofi", "admin@kofi.tg", PW2);

      const users = await api().get(`${V}/tenant/security/users`).set(bearer(admin));
      expect(users.body.every((u: { email: string }) => u.email.endsWith("@kofi.tg"))).toBe(true);
      expect((await api().post(`${V}/tenant/security/users/${otherAdmin}/reset-password`).set(bearer(admin))).status).toBe(404);
      expect((await api().post(`${V}/tenant/security/users/${otherAdmin}/unlock`).set(bearer(admin))).status).toBe(404);
      expect((await api().get(`${V}/tenant/settings/business`).set(bearer(admin))).body.tradeName).toBe("Chez Kofi");

      await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: otherId }, data: { mustChangePassword: false } }));
      const t2 = await tok("autre", "admin@autre.tg", PW);
      expect((await api().get(`${V}/tenant/settings/business`).set(bearer(t2))).body.tradeName).toBe("AUTRE");
      expect((await tenantLogin("autre", "admin@kofi.tg", PW2)).status).toBe(401);           // pas d'identifiants croisés
      const events = await api().get(`${V}/tenant/security/login-events`).set(bearer(t2));
      expect(events.body.every((e: { tenantId: string }) => e.tenantId === otherId)).toBe(true);
    });
  });
});
