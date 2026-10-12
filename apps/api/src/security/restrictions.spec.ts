import { isPasswordExpired, restrictionFor } from "./restrictions";

const need2fa = { requires2fa: (r: string) => r === "ADMIN" };
const none = { requires2fa: () => false };

describe("restrictions de session", () => {
  it("impose d'abord le changement de mot de passe", () => {
    expect(restrictionFor({ mustChangePassword: true, twoFactorEnabled: false, role: "ADMIN" }, need2fa)).toBe("pwd-change");
  });
  it("impose la 2FA aux rôles concernés qui ne l'ont pas activée", () => {
    expect(restrictionFor({ mustChangePassword: false, twoFactorEnabled: false, role: "ADMIN" }, need2fa)).toBe("2fa-setup");
    expect(restrictionFor({ mustChangePassword: false, twoFactorEnabled: true, role: "ADMIN" }, need2fa)).toBeNull();
    expect(restrictionFor({ mustChangePassword: false, twoFactorEnabled: false, role: "WAITER" }, need2fa)).toBeNull();
    expect(restrictionFor({ mustChangePassword: false, twoFactorEnabled: false, role: "ADMIN" }, none)).toBeNull();
  });
  it("détecte l'expiration du mot de passe", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    expect(isPasswordExpired(new Date("2026-01-01T00:00:00Z"), 90, now)).toBe(true);
    expect(isPasswordExpired(new Date("2026-09-01T00:00:00Z"), 90, now)).toBe(false);
    expect(isPasswordExpired(new Date("2020-01-01T00:00:00Z"), 0, now)).toBe(false);
    expect(isPasswordExpired(null, 90, now)).toBe(false);
  });
});
