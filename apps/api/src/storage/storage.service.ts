import { Inject, Injectable, Optional } from "@nestjs/common";
import { S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { APP_ENV, Env } from "../config/env";
import { DiskDriver, S3Driver, StorageDriver, StoredObject } from "./storage-drivers";

/** Injection facultative d'un pilote (tests). */
export const STORAGE_DRIVER_OVERRIDE = Symbol("STORAGE_DRIVER_OVERRIDE");

const CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", ico: "image/x-icon" };
/** Clé d'objet acceptée à la lecture (`/uploads/<clé>`) : segments sûrs, jamais de `..`. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * Stockage de fichiers, choisi par `STORAGE_DRIVER` : `disk` (UPLOAD_DIR, défaut) ou `s3` (tout service compatible S3).
 * Les appelants valident le contenu par signature binaire avant `save` ; le nom du fichier est aléatoire.
 * `save` renvoie l'URL publique, `remove` supprime à partir de cette URL (anciennes URL disque comprises après un changement de pilote).
 */
@Injectable()
export class StorageService {
  readonly root: string;
  driver: StorageDriver;

  constructor(@Inject(APP_ENV) private readonly env: Env, @Optional() @Inject(STORAGE_DRIVER_OVERRIDE) override?: StorageDriver) {
    this.root = resolve(env.UPLOAD_DIR);
    this.driver = override ?? (env.STORAGE_DRIVER === "s3" ? new S3Driver(buildS3Client(env), env.S3_BUCKET!) : new DiskDriver(this.root));
  }

  /** Enregistre un fichier sous `scope/` et renvoie son URL publique. Le nom est aléatoire (pas de cache périmé). */
  async save(scope: string, kind: string, buf: Buffer, ext: string): Promise<string> {
    const e = ext === "jpeg" ? "jpg" : ext;
    const key = `${scope}/${kind}-${randomBytes(8).toString("hex")}.${e}`;
    await this.driver.put(key, buf, CONTENT_TYPES[e] ?? "application/octet-stream");
    return this.publicUrl(key);
  }

  /** Supprime un fichier à partir de son URL ; ignore tout ce qui n'est pas dans le stockage. */
  async remove(url: string | null | undefined): Promise<void> {
    if (!url) return;
    const key = this.keyFromUrl(url);
    if (key) await this.driver.delete(key);
  }

  /** Lecture d'un objet (relais `/uploads/*` quand le bucket est privé) ; `null` si absent ou clé invalide. */
  async read(key: string): Promise<StoredObject | null> {
    if (!SAFE_KEY.test(key)) return null;
    return this.driver.get(key);
  }

  private publicUrl(key: string): string {
    const base = this.env.STORAGE_DRIVER === "s3" && this.env.S3_PUBLIC_URL ? this.env.S3_PUBLIC_URL.replace(/\/$/, "") : `${this.env.PUBLIC_API_URL}/uploads`;
    return `${base}/${key}`;
  }

  private keyFromUrl(url: string): string | null {
    const bases = [`${this.env.PUBLIC_API_URL}/uploads/`];
    if (this.env.S3_PUBLIC_URL) bases.push(`${this.env.S3_PUBLIC_URL.replace(/\/$/, "")}/`);
    const base = bases.find((b) => url.startsWith(b));
    if (!base) return null;
    const key = url.slice(base.length);
    return SAFE_KEY.test(key) ? key : null;
  }
}

export function buildS3Client(env: Env): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === "on" : !!env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
}
