import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import { AccountsRepo } from "../security/accounts.repo";
import { LicenseGateService } from "../security/license-gate.service";
import { AccessClaims, SessionService } from "../security/session.service";
import { RealtimeService } from "./realtime.service";

const ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",");

/**
 * Canal temps réel des restaurants (Socket.io, espace de noms `/realtime`).
 * Connexion : `io(url + "/realtime", { auth: { token: accessToken } })` ; mêmes contrôles que l'API
 * (jeton, session active, compte actif, licence valide). Chaque socket rejoint la salle de son restaurant.
 */
@WebSocketGateway({ namespace: "/realtime", cors: { origin: ORIGINS, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger("RealtimeGateway");
  @WebSocketServer() ns!: Namespace;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly repo: AccountsRepo,
    private readonly gate: LicenseGateService,
  ) {}

  afterInit(ns: Namespace) {
    this.realtime.attach(ns);
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string | undefined) ?? client.handshake.headers.authorization?.replace(/^Bearer /, "");
      if (!token) throw new Error("Authentification requise");
      const claims = await this.jwt.verifyAsync<AccessClaims>(token).catch(() => { throw new Error("Jeton invalide ou expiré"); });
      if (claims.typ !== "tenant" || !claims.tid) throw new Error("Jeton invalide");
      if (!(await this.sessions.isActive(claims.sid, claims.sub))) throw new Error("Session terminée");
      const acc = await this.repo.findById("tenant", claims.sub, claims.tid);
      if (!acc?.isActive || acc.role === "CUSTOMER") throw new Error("Accès refusé");
      await this.gate.assertAccess(claims.tid);
      client.data = { tenantId: claims.tid, userId: acc.id, role: acc.role };
      await client.join(`tenant:${claims.tid}`);
      client.emit("ready", { tenantId: claims.tid, role: acc.role });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Connexion refusée";
      client.emit("auth_error", { message: (e as { response?: { message?: string } }).response?.message ?? message });
      client.disconnect(true);
      this.log.debug(`connexion refusée : ${message}`);
    }
  }
}
