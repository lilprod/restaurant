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
   */
  emit(tenantId: string, event: string, payload: unknown) {
    if (!this.ns) return;
    this.ns.to(`tenant:${tenantId}`).emit(event, payload);
    this.log.debug(`${event} → tenant:${tenantId}`);
  }
}
