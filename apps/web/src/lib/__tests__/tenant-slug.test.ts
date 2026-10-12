import { describe, expect, it } from "vitest";
import { resolveTenantSlug, tenantBasePath } from "../tenant-slug";

describe("resolveTenantSlug", () => {
  it("préfère le sous-domaine en production", () => {
    expect(resolveTenantSlug({ hostname: "chez-kofi.monapp.com", pathname: "/", rootDomain: "monapp.com" }))
      .toEqual({ slug: "chez-kofi", mode: "subdomain" });
  });

  it("ignore la casse et le point final du nom d'hôte", () => {
    expect(resolveTenantSlug({ hostname: "Chez-Kofi.MonApp.com.", pathname: "/", rootDomain: "monapp.com" })?.slug).toBe("chez-kofi");
  });

  it("le sous-domaine l'emporte sur le chemin", () => {
    expect(resolveTenantSlug({ hostname: "chez-kofi.monapp.com", pathname: "/r/autre/login", rootDomain: "monapp.com" })?.slug).toBe("chez-kofi");
  });

  it("ignore les sous-domaines réservés et revient au chemin", () => {
    expect(resolveTenantSlug({ hostname: "admin.monapp.com", pathname: "/", rootDomain: "monapp.com" })).toBeNull();
    expect(resolveTenantSlug({ hostname: "www.monapp.com", pathname: "/r/chez-kofi/login", rootDomain: "monapp.com" }))
      .toEqual({ slug: "chez-kofi", mode: "path" });
  });

  it("refuse plusieurs niveaux de sous-domaine et les slugs invalides", () => {
    expect(resolveTenantSlug({ hostname: "a.b.monapp.com", pathname: "/", rootDomain: "monapp.com" })).toBeNull();
    expect(resolveTenantSlug({ hostname: "chez_kofi.monapp.com", pathname: "/", rootDomain: "monapp.com" })).toBeNull();
    expect(resolveTenantSlug({ hostname: "localhost", pathname: "/r/Chez--Kofi/", rootDomain: "localhost" })).toBeNull();
  });

  it("le domaine racine seul n'est pas un restaurant", () => {
    expect(resolveTenantSlug({ hostname: "monapp.com", pathname: "/admin", rootDomain: "monapp.com" })).toBeNull();
  });

  it("fonctionne en développement avec le chemin /r/:slug et avec slug.localhost", () => {
    expect(resolveTenantSlug({ hostname: "localhost", pathname: "/r/maquis-du-port/parametres", rootDomain: "localhost" }))
      .toEqual({ slug: "maquis-du-port", mode: "path" });
    expect(resolveTenantSlug({ hostname: "maquis-du-port.localhost", pathname: "/", rootDomain: "localhost" }))
      .toEqual({ slug: "maquis-du-port", mode: "subdomain" });
  });

  it("sans domaine racine configuré, seul le chemin compte", () => {
    expect(resolveTenantSlug({ hostname: "chez-kofi.monapp.com", pathname: "/", rootDomain: null })).toBeNull();
  });

  it("calcule le préfixe des routes", () => {
    expect(tenantBasePath({ slug: "chez-kofi", mode: "path" })).toBe("/r/chez-kofi");
    expect(tenantBasePath({ slug: "chez-kofi", mode: "subdomain" })).toBe("");
  });
});
