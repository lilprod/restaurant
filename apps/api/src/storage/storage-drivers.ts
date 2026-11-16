import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

export interface StoredObject { body: Readable; contentType: string; length?: number }

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
}

/** Disque local (UPLOAD_DIR) : servi directement par Express (`useStaticAssets`), `get` sert surtout aux tests. */
export class DiskDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  private path(key: string): string | null {
    const target = resolve(this.root, key);
    return target.startsWith(this.root + sep) ? target : null;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.path(key);
    if (!target) throw new Error("Clé de fichier invalide");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async delete(key: string): Promise<void> {
    const target = this.path(key);
    if (target) await rm(target, { force: true });
  }

  async get(key: string): Promise<StoredObject | null> {
    const target = this.path(key);
    if (!target) return null;
    const body = createReadStream(target);
    return new Promise((ok) => { body.once("open", () => ok({ body, contentType: "application/octet-stream" })); body.once("error", () => ok(null)); });
  }
}

/** Sous-ensemble du client AWS SDK utilisé ici (permet un faux client en test). */
export interface S3Like { send(command: any): Promise<any> }

/** Objet S3 / R2 / MinIO : `Cache-Control` long (noms aléatoires), type connu, jamais d'ACL publique. */
export class S3Driver implements StorageDriver {
  constructor(private readonly client: S3Like, private readonly bucket: string) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length,
      CacheControl: "public, max-age=31536000, immutable",
    }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));   // idempotent côté S3 (204 même si absent)
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!r.Body) return null;
      return { body: r.Body as Readable, contentType: r.ContentType ?? "application/octet-stream", length: r.ContentLength };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
}
