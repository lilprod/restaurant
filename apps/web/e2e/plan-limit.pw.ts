import { expect, test } from "@playwright/test";
import { ensureRestaurant, loginUi, sql, SLUG } from "./support";

test.beforeAll(() => ensureRestaurant());

test("PLAN_LIMIT : la limite de tables du plan est expliquée en français, sans perdre la saisie", async ({ page }) => {
  const planId = sql(`select "planId" from "Subscription" s join "Tenant" t on t.id = s."tenantId" where t.slug = '${SLUG}' order by s."createdAt" desc limit 1`);
  const before = sql(`select coalesce("maxTables"::text, '') from "Plan" where id = '${planId}'`);
  const active = sql(`select count(*) from "RestaurantTable" r join "Tenant" t on t.id = r."tenantId" where t.slug = '${SLUG}' and r."isActive"`);
  try {
    sql(`update "Plan" set "maxTables" = ${active} where id = '${planId}'`);   // plan « plein » : plus aucune table ajoutable
    await loginUi(page, "manager", "/tables");
    await page.getByRole("button", { name: "Ajouter une table" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Ajouter une table" });
    await dialog.getByLabel("Nom de la table").fill("LIMITE");
    await dialog.getByRole("button", { name: "Ajouter la table" }).click();
    const warning = dialog.getByText("Limite de votre plan atteinte");
    await expect(warning).toBeVisible();
    await expect(dialog.getByText(/table/i).filter({ hasText: /limite|plan|maximum/i }).first()).toBeVisible();
    await expect(dialog.getByLabel("Nom de la table")).toHaveValue("LIMITE");   // la saisie est conservée
    await expect(page.getByText("Table LIMITE ajoutée")).toHaveCount(0);
  } finally {
    sql(`update "Plan" set "maxTables" = ${before === "" ? "NULL" : before} where id = '${planId}'`);
  }
});
