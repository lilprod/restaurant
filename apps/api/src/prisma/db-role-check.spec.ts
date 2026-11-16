import { findPrivilegedRole } from "./db-role-check";

const db = (row?: object) => ({ $queryRaw: async () => (row ? [row] : []) }) as never;

describe("findPrivilegedRole", () => {
  it("signale un superuser ou un rôle BYPASSRLS", async () => {
    expect(await findPrivilegedRole(db({ rolname: "app", rolsuper: true, rolbypassrls: true }))).toContain("superuser");
    expect(await findPrivilegedRole(db({ rolname: "app", rolsuper: false, rolbypassrls: true }))).toContain("BYPASSRLS");
  });
  it("accepte un rôle restreint", async () => {
    expect(await findPrivilegedRole(db({ rolname: "app", rolsuper: false, rolbypassrls: false }))).toBeNull();
    expect(await findPrivilegedRole(db())).toBeNull();
  });
});
