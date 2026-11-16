import { summarize } from "./review-stats";

describe("statistiques d'avis", () => {
  it("moyenne à une décimale et répartition", () => {
    expect(summarize({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 })).toEqual({ count: 3, average: 3.7, distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 } });
    expect(summarize({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 4 }).average).toBe(5);
    expect(summarize({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 1 }).average).toBe(3);
  });
  it("sans avis : pas de moyenne", () => {
    expect(summarize({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toMatchObject({ count: 0, average: null });
  });
});
