import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { ZodTypeAny } from "zod";
import { deepMerge } from "./deep-merge";

export interface SectionDef<Ctx> {
  schema: ZodTypeAny;
  /** Valeurs par défaut (peuvent dépendre du contexte : nom du restaurant, etc.). */
  defaults: (ctx: Ctx) => unknown;
}

/**
 * Moteur commun des réglages par « section » (JSON validé par un schéma Zod).
 * Lecture = défauts + valeurs enregistrées ; écriture = fusion du patch puis validation complète.
 */
export abstract class SettingsEngine<Ctx> {
  protected abstract readonly sections: Record<string, SectionDef<Ctx>>;
  protected abstract read(key: string, ctx: Ctx): Promise<unknown | null>;
  protected abstract write(key: string, value: unknown, ctx: Ctx): Promise<void>;

  sectionNames(): string[] {
    return Object.keys(this.sections);
  }

  protected def(section: string): SectionDef<Ctx> {
    const d = this.sections[section];
    if (!d) throw new NotFoundException(`Section de réglages inconnue : ${section}`);
    return d;
  }

  async getSection(section: string, ctx: Ctx): Promise<any> {
    const d = this.def(section);
    return deepMerge(d.defaults(ctx) as object, (await this.read(section, ctx)) ?? undefined);
  }

  async patchSection(section: string, patch: unknown, ctx: Ctx): Promise<any> {
    const d = this.def(section);
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new BadRequestException("Corps JSON attendu");
    const merged = deepMerge(await this.getSection(section, ctx), patch);
    const parsed = d.schema.safeParse(merged);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Données invalides",
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    await this.write(section, parsed.data, ctx);
    return parsed.data;
  }
}
