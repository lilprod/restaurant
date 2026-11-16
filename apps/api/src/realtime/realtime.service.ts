import { Injectable, Logger } from "@nestjs/common";
import type { Namespace } from "socket.io";

/** Diffusion des événements temps réel vers les écrans d'un restaurant (cuisine, salle, caisse). */
@Injectable()
export class RealtimeService {
  private readonly log = new Logger("Realtime");
  private ns?: Namespace;

  attach(ns: Namespace) {
    this.ns = ns;
  }

  /**
   * Événements émis : `order.created`, `order.updated` (charge utile = vue de la commande),
   * `menu.updated` (= `menuItemView`, ou `{ id, deleted: true }`), `table.updated` (= élément de `GET /tenant/tables`, ou `{ id, deleted: true }`),
   * `reservation.created|updated` (= `reservationView`), `waitlist.updated` (= `waitlistView`).
   * Événements privés (`emitToUsers`) : `message.created` (messagerie), `planning.published` (planning du personnel).
   */
  emit(tenantId: string, event: string, payload: unknown) {
    if (!this.ns) return;
    this.ns.to(`tenant:${tenantId}`).emit(event, payload);
    this.log.debug(`${event} → tenant:${tenantId}`);
  }

  /** Événement privé : seulement les sockets (appareils) des personnes citées, jamais le reste du restaurant. */
  emitToUsers(tenantId: string, userIds: string[], event: string, payload: unknown) {
    if (!this.ns || userIds.length === 0) return;
    this.ns.to(userIds.map((u) => `tenant:${tenantId}:user:${u}`)).emit(event, payload);
    this.log.debug(`${event} → ${userIds.length} personne(s) de tenant:${tenantId}`);
  }
}
