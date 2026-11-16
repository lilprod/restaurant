import { claimOrderSchema, customerSignupSchema, reviewInputSchema } from "@restaurant/validation";
import { describe, expect, it } from "vitest";
import { tokenFrom } from "../orders-tab";

const TOKEN = "Ab3_dEf-Gh1JkLmNoPqRsTuVwXyZ0123456789abcde";

describe("lien du ticket", () => {
  it("extrait le jeton d'un lien complet ou d'un jeton seul", () => {
    expect(tokenFrom(`https://resto.exemple/r/baobab/suivi/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFrom(`  http://localhost:5173/r/baobab/suivi/${TOKEN}/ `)).toBe(TOKEN);
    expect(tokenFrom(TOKEN)).toBe(TOKEN);
    expect(tokenFrom("n'importe quoi")).toBeNull();
    expect(claimOrderSchema.safeParse({ token: tokenFrom(TOKEN) }).success).toBe(true);
  });
});

describe("schémas de l'espace client", () => {
  it("l'inscription exige le consentement et un téléphone valide s'il est donné", () => {
    const base = { firstName: "Awa", lastName: "Mensah", email: "AWA@exemple.tg", password: "Mangue-Verte-58" };
    expect(customerSignupSchema.safeParse({ ...base, consent: true }).success).toBe(true);
    expect(customerSignupSchema.parse({ ...base, consent: true }).email).toBe("awa@exemple.tg");
    const refused = customerSignupSchema.safeParse({ ...base, consent: false });
    expect(refused.success).toBe(false);
    expect(customerSignupSchema.safeParse({ ...base, consent: true, phone: "abc" }).success).toBe(false);
    expect(customerSignupSchema.parse({ ...base, consent: true, phone: "" }).phone).toBeUndefined();
  });
  it("un avis a une note entière de 1 à 5", () => {
    expect(reviewInputSchema.safeParse({ rating: 5, comment: " Super " }).data?.comment).toBe("Super");
    for (const rating of [0, 6, 3.5]) expect(reviewInputSchema.safeParse({ rating }).success).toBe(false);
  });
});
