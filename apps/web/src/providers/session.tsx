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
function writeLicense(key: string | undefined, v: LicenseSummary | null) {
  if (!key) return;
  try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Session d'un espace. Au démarrage, si un refresh token existe : rafraîchit (via le client), lit le profil,
 * puis sonde une route non « restreinte » pour savoir si la session doit d'abord changer de mot de passe
 * ou activer la 2FA (l'API ne renvoie la restriction qu'à la connexion ou dans l'erreur RESTRICTED_SESSION).
 */
export function SessionProvider({ space, client, auth, account, slug, licenseStorageKey, children }: ProviderProps) {
  const qc = useQueryClient();
  const queryKey = React.useMemo(() => (space === "platform" ? ["platform"] : ["tenant", slug ?? ""]) as readonly string[], [space, slug]);
  const [state, setState] = React.useState<SessionState>(() => ({
    status: client.hasRefreshToken() ? "loading" : "anonymous",
    user: null, restriction: null, license: readLicense(licenseStorageKey), blocked: null,
  }));
  const statusRef = React.useRef(state.status);
  statusRef.current = state.status;

  const probeRestriction = React.useCallback(async (): Promise<Restriction | null> => {
    try { await account.sessions(); return null; } catch (e) {
      if (e instanceof ApiError && e.isRestricted) return e.restriction ?? null;
      throw e;
    }
  }, [account]);

  // Démarrage : reprise de session
  React.useEffect(() => {
    let cancelled = false;
    if (!client.hasRefreshToken()) return;
    (async () => {
      try {
        const user = await account.me();
        const restriction = await probeRestriction();
        if (!cancelled) setState((s) => ({ ...s, status: "authenticated", user, restriction }));
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : null;
        if (err?.isLicenseBlocked) setState((s) => ({ ...s, status: "anonymous", blocked: err }));
        else if (err?.status === 0) {
          toast.error(err.message);
          setState((s) => ({ ...s, status: "anonymous" }));
        } else setState((s) => ({ ...s, status: "anonymous" }));
      }
    })();
    return () => { cancelled = true; };
  }, [client, account, probeRestriction]);

  // Événements globaux du client : fin de session, restriction, licence bloquée
  React.useEffect(() => client.subscribe((ev) => {
    if (ev.type === "session-ended") {
      const wasIn = statusRef.current === "authenticated";
      qc.removeQueries({ queryKey: [...queryKey] });
      setState((s) => ({ ...s, status: "anonymous", user: null, restriction: null }));
      if (wasIn && !ev.reason?.isLicenseBlocked) toast.message("Votre session a expiré", { description: "Reconnectez-vous pour continuer." });
    } else if (ev.type === "error") {
      const e = ev.error;
      if (e.isRestricted && e.restriction) setState((s) => ({ ...s, restriction: e.restriction ?? s.restriction }));
      else if (e.isLicenseBlocked && space === "tenant") setState((s) => ({ ...s, blocked: e }));
    }
  }), [client, qc, queryKey, space]);

  const completeLogin = React.useCallback(async (res: LoginSuccess) => {
    client.setSession(res);
    writeLicense(licenseStorageKey, res.license ?? null);
    let user: Profile;
    try { user = await account.me(); } catch {
      user = { ...res.user, lastLoginAt: null, passwordChangedAt: null, recoveryCodesLeft: 0, twoFactorRequired: res.restriction === "2fa-setup" };
    }
    setState({ status: "authenticated", user, restriction: res.restriction, license: res.license ?? null, blocked: null });
  }, [client, account, licenseStorageKey]);

  const logout = React.useCallback(async (opts: { silent?: boolean; message?: string } = {}) => {
    await client.logout();
    writeLicense(licenseStorageKey, null);
    qc.removeQueries({ queryKey: [...queryKey] });
    setState({ status: "anonymous", user: null, restriction: null, license: null, blocked: null });
    if (!opts.silent) toast.success(opts.message ?? "Vous êtes déconnecté");
  }, [client, qc, queryKey, licenseStorageKey]);

  const reloadProfile = React.useCallback(async () => {
    const user = await account.me();
    setState((s) => ({ ...s, user }));
  }, [account]);

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
