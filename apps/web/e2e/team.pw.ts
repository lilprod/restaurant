import { expect, test } from "@playwright/test";
import { ensureRestaurant, loginUi, SLUG } from "./support";

test.beforeAll(() => ensureRestaurant());

test("création puis modification d'un membre de l'équipe", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const mail = `pw-${stamp}@${SLUG}.demo`;
  await loginUi(page, "admin", "/equipe");

  await page.getByRole("button", { name: "Ajouter un membre" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Ajouter un membre" });
  await dialog.getByLabel("Prénom").fill("Kossi");
  await dialog.getByLabel(/^Nom\b/).fill(`Test${stamp}`);
  await dialog.getByLabel("Email").fill(mail);
  await dialog.getByRole("radio", { name: /Cuisine/ }).click();
  await dialog.getByRole("button", { name: "Créer le compte" }).click();

  // Mot de passe temporaire affiché une seule fois
  const temp = page.getByRole("dialog", { name: "Mot de passe temporaire" });
  await expect(temp).toBeVisible();
  await temp.getByRole("button", { name: "J'ai transmis le mot de passe" }).click();
  const row = page.getByRole("row", { name: new RegExp(mail) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Cuisine");

  // Modification : nouveau nom et rôle Serveur
  await page.getByRole("button", { name: `Actions pour Kossi Test${stamp}` }).click();
  await page.getByRole("menuitem", { name: /Modifier le profil et le rôle/ }).click();
  const edit = page.getByRole("dialog", { name: /Modifier Kossi/ });
  await edit.getByLabel("Prénom").fill("Komlan");
  await edit.getByRole("radio", { name: /Serveur/ }).click();
  await edit.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Komlan Test\w+ : profil enregistré/)).toBeVisible();
  const updated = page.getByRole("row", { name: new RegExp(mail) });
  await expect(updated).toContainText("Komlan");
  await expect(updated).toContainText("Serveur");

  // Erreur serveur : même email refusé (409) et affiché dans le formulaire
  await page.getByRole("button", { name: "Ajouter un membre" }).first().click();
  const again = page.getByRole("dialog", { name: "Ajouter un membre" });
  await again.getByLabel("Prénom").fill("Doublon");
  await again.getByLabel(/^Nom\b/).fill("Test");
  await again.getByLabel("Email").fill(mail);
  await again.getByRole("button", { name: "Créer le compte" }).click();
  await expect(again.getByText(/existe déjà|déjà utilisé/i)).toBeVisible();
});
