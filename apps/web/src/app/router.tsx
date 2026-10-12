import * as React from "react";
import { createBrowserRouter, Navigate, Outlet, useParams, type RouteObject } from "react-router-dom";
import { ForgotPasswordPage } from "@/features/auth/forgot-password-page";
import { LoginPage } from "@/features/auth/login-page";
import { FullScreenLoader, RequireSession } from "@/features/auth/require-session";
import { ResetPasswordPage } from "@/features/auth/reset-password-page";
import { NotFoundPage, TenantNotFound } from "@/features/misc/not-found";
import { resolveFromWindow, tenantBasePath, type ResolvedSlug } from "@/lib/tenant-slug";
import { BrandingProvider, useBranding } from "@/providers/branding";
import { SessionProvider } from "@/providers/session";
import { SpaceRoutesProvider } from "@/providers/space";
import { getTenantSpace, platformSpace, STORAGE_KEYS } from "./spaces";

/** Charge une page à la demande (découpage du bundle par écran). */
function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  const C = React.lazy(async () => ({ default: (await load())[name] as React.ComponentType }));
  return (
    <React.Suspense fallback={<PageFallback />}>
      <C />
    </React.Suspense>
  );
}

function PageFallback() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="skeleton h-8 w-56 rounded-md" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-lg" />)}
      </div>
      <div className="skeleton h-72 rounded-lg" />
    </div>
  );
}

const PlatformShell = React.lazy(() => import("@/features/platform/platform-shell").then((m) => ({ default: m.PlatformShell })));
const TenantShell = React.lazy(() => import("@/features/tenant/tenant-shell").then((m) => ({ default: m.TenantShell })));

// ── Espace plateforme (/admin) ──

function PlatformRoot() {
  return (
    <SpaceRoutesProvider base="/admin" kind="platform">
      <BrandingProvider>
        <SessionProvider space="platform" client={platformSpace.client} auth={platformSpace.auth} account={platformSpace.account}>
          <Outlet />
        </SessionProvider>
      </BrandingProvider>
    </SpaceRoutesProvider>
  );
}

const platformRoutes: RouteObject[] = [
  { path: "login", element: <LoginPage /> },
  { path: "mot-de-passe-oublie", element: <ForgotPasswordPage /> },
  {
    element: (
      <RequireSession>
        <React.Suspense fallback={<FullScreenLoader />}><PlatformShell /></React.Suspense>
      </RequireSession>
    ),
    children: [
      { index: true, element: lazyPage(() => import("@/features/platform/dashboard-page"), "PlatformDashboardPage") },
      { path: "restaurants", element: lazyPage(() => import("@/features/platform/tenants/tenants-page"), "TenantsPage") },
      { path: "restaurants/:id", element: lazyPage(() => import("@/features/platform/tenants/tenant-detail-page"), "TenantDetailPage") },
      { path: "inscriptions", element: lazyPage(() => import("@/features/platform/registrations/registrations-page"), "RegistrationsPage") },
      { path: "plans", element: lazyPage(() => import("@/features/platform/plans/plans-page"), "PlansPage") },
      { path: "paiements", element: lazyPage(() => import("@/features/platform/payments/payments-page"), "PaymentsPage") },
      { path: "paiements/:id", element: lazyPage(() => import("@/features/platform/payments/receipt-page"), "ReceiptPage") },
      { path: "parametres", element: lazyPage(() => import("@/features/platform/settings/platform-settings-page"), "PlatformSettingsPage") },
      { path: "equipe", element: lazyPage(() => import("@/features/platform/team/team-page"), "TeamPage") },
      { path: "securite", element: lazyPage(() => import("@/features/platform/security/security-page"), "PlatformSecurityPage") },
      { path: "compte", element: lazyPage(() => import("@/features/account/account-page"), "AccountPage") },
      { path: "*", element: <NotFoundPage inShell /> },
    ],
  },
];

// ── Espace restaurant (/r/:slug ou sous-domaine) ──

function TenantRoot({ resolved }: { resolved?: ResolvedSlug }) {
  const params = useParams();
  const r: ResolvedSlug = resolved ?? { slug: (params.slug ?? "").toLowerCase(), mode: "path" };
  const space = getTenantSpace(r.slug);
  return (
    <SpaceRoutesProvider base={tenantBasePath(r)} kind="tenant">
      <BrandingProvider slug={r.slug}>
        <TenantGate>
          <SessionProvider
            key={r.slug}
            space="tenant"
            slug={r.slug}
            client={space.client}
            auth={space.auth}
            account={space.account}
            licenseStorageKey={STORAGE_KEYS.tenantLicense(r.slug)}
          >
            <Outlet />
          </SessionProvider>
        </TenantGate>
      </BrandingProvider>
    </SpaceRoutesProvider>
  );
}

/** Restaurant inconnu (ou en attente / résilié) : page dédiée plutôt qu'un formulaire de connexion inutile. */
function TenantGate({ children }: { children: React.ReactNode }) {
  const { notFound, isLoading, branding } = useBranding();
  if (notFound) return <TenantNotFound />;
  if (isLoading && !branding) return <FullScreenLoader />;
  return <>{children}</>;
}

const tenantChildren: RouteObject[] = [
  { path: "login", element: <LoginPage /> },
  { path: "mot-de-passe-oublie", element: <ForgotPasswordPage /> },
  {
    element: (
      <RequireSession>
        <React.Suspense fallback={<FullScreenLoader />}><TenantShell /></React.Suspense>
      </RequireSession>
    ),
    children: [
      { index: true, element: lazyPage(() => import("@/features/tenant/dashboard-page"), "TenantDashboardPage") },
      { path: "parametres", element: lazyPage(() => import("@/features/tenant/settings-page"), "TenantSettingsPage") },
      { path: "securite", element: lazyPage(() => import("@/features/tenant/security-page"), "TenantSecurityPage") },
      { path: "licence", element: lazyPage(() => import("@/features/tenant/license-page"), "TenantLicensePage") },
      { path: "compte", element: lazyPage(() => import("@/features/account/account-page"), "AccountPage") },
      { path: "*", element: <NotFoundPage inShell /> },
    ],
  },
];

const publicRoutes: RouteObject[] = [
  { path: "/inscription", element: lazyPage(() => import("@/features/register/register-page"), "RegisterPage") },
  { path: "/reset-password", element: <ResetPasswordPage /> },
];

function buildRoutes(): RouteObject[] {
  const resolved = resolveFromWindow();
  // Production : `chez-kofi.monapp.com` → l'espace du restaurant est à la racine.
  if (resolved?.mode === "subdomain") {
    return [...publicRoutes, { path: "/", element: <TenantRoot resolved={resolved} />, children: tenantChildren }];
  }
  return [
    { path: "/", element: <Navigate to="/admin" replace /> },
    ...publicRoutes,
    { path: "/admin", element: <PlatformRoot />, children: platformRoutes },
    { path: "/r/:slug", element: <TenantRoot />, children: tenantChildren },
    { path: "*", element: <NotFoundPage /> },
  ];
}

export const router = createBrowserRouter(buildRoutes());
