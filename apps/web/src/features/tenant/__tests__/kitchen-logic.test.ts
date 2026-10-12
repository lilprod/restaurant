import { describe, expect, it } from "vitest";
import { boardCounts, elapsedTone, formatElapsed, isOrderReady, nextKitchenStatus, previousKitchenStatus, referencePrepMinutes } from "../kitchen/kitchen-logic";
import { item, order } from "./fixtures";

describe("écran cuisine", () => {
  it("le chronomètre passe à l'ambre à 75 % du plat le plus long, puis au rouge", () => {
    const min = 60_000;
    expect(elapsedTone(10 * min, 20)).toBe("normal");
    expect(elapsedTone(15 * min, 20)).toBe("amber");
    expect(elapsedTone(20 * min, 20)).toBe("amber");
    expect(elapsedTone(20 * min + 1000, 20)).toBe("red");
  });

  it("référence = plat le plus long encore en cuisine (15 min par défaut)", () => {
    expect(referencePrepMinutes([item({ prepMinutes: 25, status: "READY" }), item({ prepMinutes: 8 })])).toBe(8);
    expect(referencePrepMinutes([item({ prepMinutes: 0 })])).toBe(15);
  });

  it("formate la durée et enchaîne les étapes (avec retour d'un cran)", () => {
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(nextKitchenStatus("PENDING")).toBe("IN_PROGRESS");
    expect(nextKitchenStatus("READY")).toBeNull();
    expect(previousKitchenStatus("READY")).toBe("IN_PROGRESS");
    expect(previousKitchenStatus("PENDING")).toBeNull();
  });

  it("compte les quantités par état et repère une commande prête", () => {
    const o = order({ items: [item({ quantity: 2 }), item({ status: "IN_PROGRESS" }), item({ status: "READY", quantity: 3 })] });
    expect(boardCounts([o])).toEqual({ pending: 2, inProgress: 1, ready: 3 });
    expect(isOrderReady(o)).toBe(false);
    expect(isOrderReady(order({ items: [item({ status: "READY" })] }))).toBe(true);
  });
});
