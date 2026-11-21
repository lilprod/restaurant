import { getTenantSpace } from "@/app/spaces";
import { disablePush } from "@/lib/push";
import { loadProfile, resetIfOtherUser, saveProfile, wipeCachesKeepQueue, wipeTenantData } from "@/lib/offline/persist";
import { DEFAULT_POLICY_BY_SPACE } from "@/lib/policy";
import {
  ApiError, type AccountApi, type ApiClient, type AuthApi, type LicenseSummary, type LoginSuccess, type Profile, type Restriction,
} from "@restaurant/api-client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

export type SessionStatus = "loading" | "anonymous" | "authenticated";

export interface SessionState {
  status: SessionStatus;
  user: Profile | null;
  restriction: Restriction | null;
  license: LicenseSummary | null;
  /** Restaurant bloqué (licence expirée / suspendu) : écran dédié. */
  blocked: ApiError | null;
  /** X5 : session reprise sans réseau à partir du profil gardé sur l'appareil (à revalider au retour du réseau). */
  resumedOffline: boolean;
}

export interface SessionValue extends SessionState {
  space: "platform" | "tenant";
  /** Racine des clés TanStack Query de cet espace (`["platform"]` ou `["tenant", slug]`). */
  queryKey: readonly string[];
  client: ApiClient;
  auth: AuthApi;
  account: AccountApi;
  slug?: string;
  completeLogin: (res: LoginSuccess) => Promise<void>;
  logout: (opts?: { silent?: boolean; message?: string }) => Promise<void>;
  reloadProfile: () => Promise<void>;
  setRestriction: (r: Restriction | null) => void;
  setBlocked: (e: ApiError | null) => void;
}

const Ctx = React.createContext<SessionValue | null>(null);

interface ProviderProps {
  space: "platform" | "tenant";
  client: ApiClient;
  auth: AuthApi;
  account: AccountApi;
  slug?: string;
  /** Persistance de l'état de licence reçu à la connexion (bandeau de grâce pour tous les rôles). */
  licenseStorageKey?: string;
  children: React.ReactNode;
}

function readLicense(key?: string): LicenseSummary | null {
  if (!key) return null;
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as LicenseSummary) : null; } catch { return null; }
}
/** Personnel du restaurant : seuls ses profils sont gardés sur l'appareil pour le mode hors ligne (jamais un compte client). */
const offlineEligible = (space: "platform" | "tenant", slug: string | undefined, u: Profile) => space === "tenant" && !!slug && u.role !== "CUSTOMER";

function writeLicense(key: string | undefined, v: LicenseSummary | null) {
  if (!key) return;
  try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Session d'un espace. Au démarrage, si un refresh token existe : rafraîchit (via le client) et lit le profil,
 * qui indique aussi la restriction en cours (mot de passe à changer, 2FA à activer).
 */
export function SessionProvider({ space, client, auth, account, slug, licenseStorageKey, children }: ProviderProps) {
  const qc = useQueryClient();
  const queryKey = React.useMemo(() => (space === "platform" ? ["platform"] : ["tenant", slug ?? ""]) as readonly string[], [space, slug]);
  const [state, setState] = React.useState<SessionState>(() => ({
    status: client.hasRefreshToken() ? "loading" : "anonymous",
    user: null, restriction: null, license: readLicense(licenseStorageKey), blocked: null, resumedOffline: false,
  }));
  const statusRef = React.useRef(state.status);
  statusRef.current = state.status;

  // Démarrage : reprise de session
  React.useEffect(() => {
    let cancelled = false;
    if (!client.hasRefreshToken()) return;
    (async () => {
      try {
        const user = await account.me();
        if (offlineEligible(space, slug, user)) { await resetIfOtherUser(slug!, user.id); void saveProfile(slug!, user); }
        if (!cancelled) setState((s) => ({ ...s, status: "authenticated", user, restriction: user.restriction, resumedOffline: false }));
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : null;
        if (err?.isLicenseBlocked) setState((s) => ({ ...s, status: "anonymous", blocked: err }));
        else if (err?.status === 0) {
          // X5 : réseau coupé au démarrage. Avec un jeton de session et le profil gardé sur l'appareil, on reprend hors ligne.
          const cached = space === "tenant" && slug ? await loadProfile(slug) : null;
          if (cancelled) return;
          if (cached) { setState((s) => ({ ...s, status: "authenticated", user: cached, restriction: null, resumedOffline: true })); return; }
          toast.error(err.message);
          setState((s) => ({ ...s, status: "anonymous" }));
        } else setState((s) => ({ ...s, status: "anonymous" }));
      }
    })();
    return () => { cancelled = true; };
  }, [client, account, space, slug]);

  // Événements globaux du client : fin de session, restriction, licence bloquée
  React.useEffect(() => client.subscribe((ev) => {
    if (ev.type === "license") {
      writeLicense(licenseStorageKey, ev.license);
      setState((s) => ({ ...s, license: ev.license }));
    } else if (ev.type === "session-ended") {
      const wasIn = statusRef.current === "authenticated";
      qc.removeQueries({ queryKey: [...queryKey] });
      if (space === "tenant" && slug) void wipeCachesKeepQueue(slug);    // la file de commandes non envoyées reste (voir offline/queue)
      setState((s) => ({ ...s, status: "anonymous", user: null, restriction: null, resumedOffline: false }));
      if (wasIn && !ev.reason?.isLicenseBlocked) toast.message("Votre session a expiré", { description: "Reconnectez-vous pour continuer." });
    } else if (ev.type === "error") {
      const e = ev.error;
      if (e.isRestricted && e.restriction) setState((s) => ({ ...s, restriction: e.restriction ?? s.restriction }));
      else if (e.isLicenseBlocked && space === "tenant") setState((s) => ({ ...s, blocked: e }));
    }
  }), [client, qc, queryKey, space, slug, licenseStorageKey]);

  const completeLogin = React.useCallback(async (res: LoginSuccess) => {
    client.setSession(res);
    writeLicense(licenseStorageKey, res.license ?? null);
    let user: Profile;
    try { user = await account.me(); } catch {
      user = {
        ...res.user, lastLoginAt: null, passwordChangedAt: null, recoveryCodesLeft: 0,
        twoFactorRequired: res.restriction === "2fa-setup", mustChangePassword: res.restriction === "pwd-change",
        restriction: res.restriction, passwordPolicy: DEFAULT_POLICY_BY_SPACE[space],
      };
    }
    if (offlineEligible(space, slug, user)) { await resetIfOtherUser(slug!, user.id); void saveProfile(slug!, user); }
    setState({ status: "authenticated", user, restriction: res.restriction, license: res.license ?? null, blocked: null, resumedOffline: false });
  }, [client, account, licenseStorageKey, space, slug]);

  const logout = React.useCallback(async (opts: { silent?: boolean; message?: string } = {}) => {
    // X5B : l'appareil ne reçoit plus d'alertes du compte (abonnement retiré côté navigateur ET côté API, tant que la session est valide).
    if (space === "tenant" && slug) await disablePush(getTenantSpace(slug).api.push);
    await client.logout();
    writeLicense(licenseStorageKey, null);
    qc.removeQueries({ queryKey: [...queryKey] });
    if (space === "tenant" && slug) await wipeTenantData(slug);          // X5 : plus aucune donnée du restaurant sur l'appareil
    setState({ status: "anonymous", user: null, restriction: null, license: null, blocked: null, resumedOffline: false });
    if (!opts.silent) toast.success(opts.message ?? "Vous êtes déconnecté");
  }, [client, qc, queryKey, licenseStorageKey, space, slug]);

  const reloadProfile = React.useCallback(async () => {
    const user = await account.me();
    if (offlineEligible(space, slug, user)) void saveProfile(slug!, user);
    setState((s) => ({ ...s, user, restriction: s.resumedOffline ? user.restriction : s.restriction, resumedOffline: false }));
  }, [account, space, slug]);

  const setRestriction = React.useCallback((restriction: Restriction | null) => setState((s) => ({ ...s, restriction })), []);
  const setBlocked = React.useCallback((blocked: ApiError | null) => setState((s) => ({ ...s, blocked })), []);

  const value = React.useMemo<SessionValue>(() => ({
    ...state, space, queryKey, client, auth, account, slug, completeLogin, logout, reloadProfile, setRestriction, setBlocked,
  }), [state, space, queryKey, client, auth, account, slug, completeLogin, logout, reloadProfile, setRestriction, setBlocked]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useSession hors SessionProvider");
  return v;
}

/** Utilisateur connecté (à utiliser sous RequireSession). */
export function useUser(): Profile {
  const { user } = useSession();
  if (!user) throw new Error("Aucun utilisateur connecté");
  return user;
}
