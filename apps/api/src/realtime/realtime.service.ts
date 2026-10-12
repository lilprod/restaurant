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

  /** Événements : `order.created`, `order.updated`, `menu.updated`, `table.updated`. */
  emit(tenantId: string, event: string, payload: unknown) {
    if (!this.ns) return;
    this.ns.to(`tenant:${tenantId}`).emit(event, payload);
    this.log.debug(`${event} → tenant:${tenantId}`);
  }
}
