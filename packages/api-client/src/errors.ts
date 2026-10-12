/** Codes d'erreur métier renvoyés par l'API (champ `code` du corps de réponse). */
export type ApiErrorCode = "RESTRICTED_SESSION" | "LICENSE_BLOCKED" | "ACCOUNT_LOCKED" | "NETWORK_ERROR" | "UNKNOWN";

export interface FieldError {
  /** Chemin du champ, ex. `admin.password` ou `newPassword`. */
  path: string;
  message: string;
}

export type Restriction = "pwd-change" | "2fa-setup";

const HTTP_MESSAGES: Record<number, string> = {
  400: "Données invalides",
  401: "Authentification requise",
  403: "Droits insuffisants",
  404: "Ressource introuvable",
  409: "Conflit avec l'état actuel",
  413: "Fichier trop volumineux",
  423: "Compte verrouillé",
  429: "Trop de tentatives. Patientez un instant puis réessayez.",
  500: "Erreur interne du serveur",
};

/** Erreur typée de l'API : statut HTTP, code métier, message lisible et erreurs par champ. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string | undefined;
  readonly errors: FieldError[];
  /** Présent sur `RESTRICTED_SESSION` : la restriction qui pèse sur la session. */
  readonly restriction: Restriction | undefined;
  readonly body: unknown;

  constructor(init: { status: number; message: string; code?: string; errors?: FieldError[]; restriction?: Restriction; body?: unknown }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.errors = init.errors ?? [];
    this.restriction = init.restriction;
    this.body = init.body;
  }

  /** Construit l'erreur à partir d'une réponse HTTP non-2xx (corps JSON NestJS ou texte). */
  static fromResponse(status: number, body: unknown): ApiError {
    const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    let message = typeof b.message === "string" ? b.message : Array.isArray(b.message) ? b.message.join(", ") : "";
    if (!message || /^ThrottlerException/i.test(message)) message = HTTP_MESSAGES[status] ?? `Erreur ${status}`;
    const errors = Array.isArray(b.errors)
      ? (b.errors as unknown[])
          .filter((e): e is FieldError => typeof e === "object" && e !== null && "message" in e)
          .map((e) => ({ path: String(e.path ?? ""), message: String(e.message) }))
      : [];
    const restriction = b.restriction === "pwd-change" || b.restriction === "2fa-setup" ? b.restriction : undefined;
    return new ApiError({ status, message, code: typeof b.code === "string" ? b.code : undefined, errors, restriction, body });
  }

  static network(cause?: unknown): ApiError {
    return new ApiError({
      status: 0, code: "NETWORK_ERROR",
      message: "Impossible de joindre le serveur. Vérifiez votre connexion.", body: cause,
    });
  }

  get isRestricted() { return this.code === "RESTRICTED_SESSION"; }
  get isLicenseBlocked() { return this.code === "LICENSE_BLOCKED"; }
  get isLocked() { return this.status === 423 || this.code === "ACCOUNT_LOCKED"; }

  /** Minutes restantes avant déverrouillage, extraites du message 423 (« Réessayez dans N minute(s) »). */
  get lockedMinutes(): number | null {
    if (!this.isLocked) return null;
    const m = /(\d+)\s*minute/.exec(this.message);
    return m ? Number(m[1]) : null;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
