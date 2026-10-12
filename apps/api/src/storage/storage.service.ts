import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { APP_ENV, Env } from "../config/env";

/**
 * Stockage de fichiers. Pilote local (disque) pour l'instant ; Cloudinary / S3 pourront remplacer
 * cette classe sans changer les appelants (`save` renvoie une URL, `remove` la supprime).
 */
@Injectable()
export class StorageService {
  readonly root: string;

  constructor(@Inject(APP_ENV) private readonly env: Env) {
    this.root = resolve(env.UPLOAD_DIR);
  }

  /** Enregistre un fichier sous `scope/` et renvoie son URL publique. Le nom est aléatoire (pas de cache périmé). */
  async save(scope: string, kind: string, buf: Buffer, ext: string): Promise<string> {
    const name = `${kind}-${randomBytes(8).toString("hex")}.${ext === "jpeg" ? "jpg" : ext}`;
    const dir = join(this.root, scope);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), buf);
    return `${this.env.PUBLIC_API_URL}/uploads/${scope}/${name}`;
  }

  /** Supprime un fichier à partir de son URL ; ignore tout ce qui n'est pas dans le dossier d'envoi. */
  async remove(url: string | null | undefined): Promise<void> {
    if (!url) return;
    const prefix = `${this.env.PUBLIC_API_URL}/uploads/`;
    if (!url.startsWith(prefix)) return;
    const target = resolve(this.root, url.slice(prefix.length));
    if (!target.startsWith(this.root + sep)) return;
    await rm(target, { force: true });
  }
}
