import { expect, test, type Page } from "@playwright/test";
import { apiAs, ensureRestaurant, loginUi, newDevice } from "./support";

type T = { id: string; label: string; posX: number; posY: number; width: number; height: number; shape: string; rotation: number; floorPlanId: string; openOrders: { id: string }[]; mergedTables: { id: string }[] };

test.beforeAll(() => ensureRestaurant());

/** Remet la salle à zéro : plus de commande ouverte ni de fusion. */
async function clean(manager: Awaited<ReturnType<typeof apiAs>>) {
  const orders = (await manager("GET", "/tenant/orders?open=true")) as { items: { id: string }[] };
  for (const o of orders.items) await manager("POST", `/tenant/orders/${o.id}/cancel`, { reason: "Nettoyage test" });
  for (const t of (await manager("GET", "/tenant/tables")) as T[]) if (t.mergedTables.length) await manager("POST", `/tenant/tables/${t.id}/split`);
  for (const t of (await manager("GET", "/tenant/tables")) as T[]) await manager("PATCH", `/tenant/tables/${t.id}/status`, { status: "FREE" });
}

const tile = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^Table ${label}(,| \\()`) });

test("deux appareils : la mise en page enregistrée et les états (commande, transfert, fusion) arrivent en direct sur le plan de service", async ({ browser }) => {
  const editor = await newDevice(browser);
  const service = await newDevice(browser);
  const manager = await apiAs("manager");
  await clean(manager);
  const tables = (await manager("GET", "/tenant/tables")) as T[];
  const [t1, t2, t3] = ["T1", "T2", "T3"].map((l) => tables.find((t) => t.label === l)!);
  const original = { posX: t1!.posX, posY: t1!.posY, width: t1!.width, height: t1!.height, shape: t1!.shape, rotation: t1!.rotation };
  try {
    await service.page.setViewportSize({ width: 1024, height: 768 });
    await loginUi(service.page, "waiter", "/plan-de-salle?vue=plan");
    await expect(tile(service.page, "T1")).toBeVisible();
    const x0 = (await tile(service.page, "T1").boundingBox())!.x;

    // ── Éditeur (responsable) : déplacer T1 au clavier puis par la liste, enregistrer ──
    await loginUi(editor.page, "manager", "/plan-de-salle/editeur");
    await editor.page.getByRole("list", { name: "Liste des tables" }).getByRole("button", { name: /^T1/ }).click();
    const props = editor.page.getByRole("region", { name: "Propriétés de la table T1" });
    await props.getByLabel("Position X").fill("560");
    await props.getByLabel("Position X").press("Enter");
    await expect(editor.page.getByRole("button", { name: /^Enregistrer \(1\)/ })).toBeEnabled();
    // Rien n'est visible en salle avant l'enregistrement
    await service.page.waitForTimeout(600);
    expect(Math.abs((await tile(service.page, "T1").boundingBox())!.x - x0)).toBeLessThan(1);
    await editor.page.getByRole("button", { name: /^Enregistrer \(1\)/ }).click();
    await expect(editor.page.getByText("Plan enregistré")).toBeVisible();
    // L'autre appareil n'a pas été rechargé : la tuile a bougé
    await expect.poll(async () => (await tile(service.page, "T1").boundingBox())!.x, { timeout: 8000 }).toBeGreaterThan(x0 + 20);
    // Restitué à l'identique après rechargement
    await editor.page.reload();
    await editor.page.getByRole("list", { name: "Liste des tables" }).getByRole("button", { name: /^T1/ }).click();
    await expect(editor.page.getByRole("region", { name: "Propriétés de la table T1" }).getByLabel("Position X")).toHaveValue("560");

    // ── Annulation : une modification non enregistrée est abandonnée ──
    await editor.page.getByRole("region", { name: "Propriétés de la table T1" }).getByRole("button", { name: "Pivoter de 15° à droite" }).click();
    await editor.page.getByRole("button", { name: "Annuler les modifications" }).first().click();
    await editor.page.getByRole("button", { name: "Annuler les modifications" }).last().click();
    await expect(editor.page.getByRole("region", { name: "Propriétés de la table T1" }).getByLabel("Rotation (°)")).toHaveValue("0");

    // ── Commande ouverte ailleurs → table occupée sans rechargement ──
    const menu = (await manager("GET", "/tenant/menu")) as { items: { id: string; optionGroups: unknown[] }[] }[];
    const dish = menu.flatMap((c) => c.items).find((i) => i.optionGroups.length === 0)!;
    const order = await manager("POST", "/tenant/orders", { type: "DINE_IN", tableId: t2!.id, items: [{ menuItemId: dish.id, quantity: 1 }] });
    await expect(service.page.getByRole("button", { name: new RegExp(`^Table T2, Occupée.*commande n°${order.number}`) })).toBeVisible();

    // ── Déplacer la commande de T2 vers T3 ──
    await tile(service.page, "T2").click();
    const dlg = service.page.getByRole("dialog", { name: /^Table T2/ });
    await dlg.getByRole("button", { name: /Déplacer la commande/ }).click();
    await dlg.getByRole("button", { name: /^T3/ }).click();
    await expect(service.page.getByText(`Commande n°${order.number} déplacée sur la table T3`)).toBeVisible();
    await expect(service.page.getByRole("button", { name: new RegExp(`^Table T3, Occupée.*commande n°${order.number}`) })).toBeVisible();
    await expect(service.page.getByRole("button", { name: /^Table T2, Libre/ })).toBeVisible();

    // ── Fusionner T1 et T2, vu par l'autre appareil, puis séparer ──
    await editor.page.goto(`/r/${process.env.E2E_SLUG ?? "e2e"}/plan-de-salle?vue=plan`);
    await tile(service.page, "T1").click();
    const d1 = service.page.getByRole("dialog", { name: /^Table T1/ });
    await d1.getByRole("button", { name: /Fusionner/ }).click();
    await d1.getByRole("checkbox", { name: /^T2/ }).click();
    await d1.getByRole("button", { name: /^Fusionner \(/ }).click();
    await expect(service.page.getByText(/Tables fusionnées/)).toBeVisible();
    await expect(tile(editor.page, "T1")).toHaveAccessibleName(/fusionnée avec T2/);
    await tile(service.page, "T1").click();
    await service.page.getByRole("dialog", { name: /^Table T1 \+ T2/ }).getByRole("button", { name: /Séparer les tables/ }).click();
    await service.page.getByRole("button", { name: "Séparer", exact: true }).click();
    await expect(service.page.getByText("Tables séparées")).toBeVisible();
    await expect(tile(editor.page, "T1")).not.toHaveAccessibleName(/fusionnée/);
  } finally {
    await manager("PUT", `/tenant/floor-plans/${t1!.floorPlanId}/layout`, { tables: [{ id: t1!.id, ...original }] });
    await clean(manager);
    await editor.ctx.close();
    await service.ctx.close();
  }
});
