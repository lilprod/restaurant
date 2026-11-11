import { Injectable } from "@nestjs/common";

/** Horloge injectable : les tests la figent (`app.get(Clock).freeze(date)`) pour les règles horaires (plats, promotions). */
@Injectable()
export class Clock {
  private fixed: Date | null = null;
  now(): Date { return this.fixed ? new Date(this.fixed) : new Date(); }
  freeze(at: Date | string) { this.fixed = new Date(at); }
  unfreeze() { this.fixed = null; }
}
