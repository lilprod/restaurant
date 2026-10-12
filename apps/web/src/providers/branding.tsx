import { ApiError, type PlatformPublicBranding, type PublicBranding, type TenantPublicBranding } from "@restaurant/api-client";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { publicSpace } from "@/app/spaces";
import { applyBranding } from "@/lib/branding";
import { useTheme } from "./theme";

interface BrandingCtx {
  branding: PublicBranding | null;
  platform: PlatformPublicBranding | null;
  isLoading: boolean;
  notFound: boolean;
}
const Ctx = React.createContext<BrandingCtx>({ branding: null, platform: null, isLoading: true, notFound: false });

export const brandingKeys = {
  platform: ["public", "branding"] as const,
  tenant: (slug: string) => ["public", "tenant-branding", slug] as const,
};

/** Marque de la plateforme (toujours chargée : contacts de support, espace SuperAdmin). */
export function usePlatformBranding() {
  return useQuery({ queryKey: brandingKeys.platform, queryFn: publicSpace.platformBranding, staleTime: 60_000 });
}

/**
 * Charge la marque publique de l'espace et l'applique sur :root (variables CSS), le favicon et le titre.
 * Le mode clair/sombre de la marque devient le défaut tant que l'utilisateur n'a rien choisi.
 */
export function BrandingProvider({ slug, children }: { slug?: string; children: React.ReactNode }) {
  const { setBrandDefault } = useTheme();
  const platform = usePlatformBranding();
  const tenant = useQuery({
    queryKey: brandingKeys.tenant(slug ?? ""),
    queryFn: () => publicSpace.tenantBranding(slug!),
    enabled: !!slug,
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  const branding: PublicBranding | null = slug ? (tenant.data as TenantPublicBranding | undefined) ?? null : platform.data ?? null;

  React.useEffect(() => {
    if (!branding) return;
    applyBranding(branding, slug ? branding.displayName : `${branding.displayName} · Administration`);
    setBrandDefault(branding.theme?.mode);
  }, [branding, slug, setBrandDefault]);

  const value = React.useMemo<BrandingCtx>(() => ({
    branding,
    platform: platform.data ?? null,
    isLoading: slug ? tenant.isLoading : platform.isLoading,
    notFound: !!slug && tenant.error instanceof ApiError && tenant.error.status === 404,
  }), [branding, platform.data, platform.isLoading, tenant.isLoading, tenant.error, slug]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useBranding = () => React.useContext(Ctx);
