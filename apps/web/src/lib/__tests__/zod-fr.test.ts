import { createStaffSchema, menuItemInputSchema } from "@restaurant/validation";
import { describe, expect, it } from "vitest";
import { installFrenchErrors } from "../zod-fr";

describe("messages de validation en français", () => {
  it("traduit les erreurs des schémas partagés", () => {
    installFrenchErrors();
    const r = createStaffSchema.safeParse({ email: "x", firstName: "", lastName: "Doe", role: "CHEF" });
    const msg = Object.fromEntries((r.success ? [] : r.error.issues).map((i) => [i.path.join("."), i.message]));
    expect(msg).toEqual({ email: "Adresse email invalide", firstName: "Obligatoire", role: "Choix invalide" });
    const m = menuItemInputSchema.safeParse({ categoryId: "c3b1f2a4-5d6e-4f70-8a9b-0c1d2e3f4a5b", name: "Plat", price: -1, optionGroups: [{ name: "Sauce", options: [] }] });
    expect(m.success ? [] : m.error.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["La valeur doit être supérieure ou égale à 0", "Ajoutez au moins un élément"]));
  });
});
