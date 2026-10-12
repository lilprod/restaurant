import { isLocked, minutesLeft, registerFailure } from "./lockout";

const policy = { maxFailedAttempts: 3, lockoutMinutes: 15 };
const now = new Date("2026-10-12T10:00:00Z");

describe("verrouillage de compte", () => {
  it("compte les échecs puis verrouille au seuil", () => {
    let s = { failedLoginCount: 0, lockedUntil: null as Date | null };
    s = registerFailure(s, policy, now);
    expect(s).toEqual({ failedLoginCount: 1, lockedUntil: null });
    s = registerFailure(s, policy, now);
    expect(s.failedLoginCount).toBe(2);
    s = registerFailure(s, policy, now);
    expect(s.lockedUntil?.toISOString()).toBe("2026-10-12T10:15:00.000Z");
    expect(s.failedLoginCount).toBe(0);
  });
  it("repart de zéro quand un ancien verrouillage est échu", () => {
    const s = registerFailure({ failedLoginCount: 0, lockedUntil: new Date("2026-10-12T09:00:00Z") }, policy, now);
    expect(s).toEqual({ failedLoginCount: 1, lockedUntil: null });
  });
  it("détecte le verrouillage et calcule les minutes restantes", () => {
    const until = new Date("2026-10-12T10:07:30Z");
    expect(isLocked(until, now)).toBe(true);
    expect(isLocked(new Date("2026-10-12T09:59:00Z"), now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
    expect(minutesLeft(until, now)).toBe(8);
  });
});
