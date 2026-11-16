import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../config/env";
import { S3Driver } from "./storage-drivers";
import { StorageService } from "./storage.service";

const base = { UPLOAD_DIR: "uploads", PUBLIC_API_URL: "https://api.example.com", STORAGE_DRIVER: "disk" } as Env;

/** Faux client S3 en mémoire : enregistre les commandes et simule PUT / GET / DELETE. */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; type?: string; cache?: string }>();
  const commands: unknown[] = [];
  return {
    objects, commands,
    send: async (cmd: unknown) => {
      commands.push(cmd);
      if (cmd instanceof PutObjectCommand) { const i = cmd.input; objects.set(i.Key!, { body: i.Body as Buffer, type: i.ContentType, cache: i.CacheControl }); return {}; }
      if (cmd instanceof DeleteObjectCommand) { objects.delete(cmd.input.Key!); return {}; }
      if (cmd instanceof GetObjectCommand) {
        const o = objects.get(cmd.input.Key!);
        if (!o) throw Object.assign(new Error("absent"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        return { Body: Readable.from(o.body), ContentType: o.type, ContentLength: o.body.length };
      }
      throw new Error("commande inattendue");
    },
  };
}

describe("StorageService : pilote S3", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const mk = (env: Partial<Env> = {}) => { const s3 = fakeS3(); return { s3, svc: new StorageService({ ...base, STORAGE_DRIVER: "s3", S3_BUCKET: "b", ...env } as Env, new S3Driver(s3, "b")) }; };

  it("enregistre sous un nom aléatoire, type et cache longs, URL relayée par l'API", async () => {
    const { s3, svc } = mk();
    const a = await svc.save("tenants/t1", "logo", png, "png");
    const b = await svc.save("tenants/t1", "logo", png, "png");
    expect(a).toMatch(/^https:\/\/api\.example\.com\/uploads\/tenants\/t1\/logo-[0-9a-f]{16}\.png$/);
    expect(a).not.toBe(b);
    const key = a.replace("https://api.example.com/uploads/", "");
    expect(s3.objects.get(key)).toMatchObject({ type: "image/png", cache: "public, max-age=31536000, immutable" });
    expect((await svc.save("platform", "x", png, "jpeg"))).toMatch(/\.jpg$/);
  });
  it("utilise S3_PUBLIC_URL quand le bucket est public", async () => {
    const { svc } = mk({ S3_PUBLIC_URL: "https://cdn.example.com/" });
    expect(await svc.save("platform", "logo", png, "webp")).toMatch(/^https:\/\/cdn\.example\.com\/platform\/logo-[0-9a-f]{16}\.webp$/);
  });
  it("supprime à partir de l'URL (API ou CDN) et ignore le reste", async () => {
    const { s3, svc } = mk({ S3_PUBLIC_URL: "https://cdn.example.com" });
    const url = await svc.save("platform", "logo", png, "png");
    expect(s3.objects.size).toBe(1);
    await svc.remove("https://ailleurs.example.com/uploads/platform/logo.png");
    await svc.remove("https://api.example.com/uploads/../../etc/passwd");
    await svc.remove(null);
    expect(s3.objects.size).toBe(1);
    await svc.remove(url);
    expect(s3.objects.size).toBe(0);
    await svc.save("platform", "logo", png, "png");
    await svc.remove([...s3.objects.keys()].map((k) => `https://api.example.com/uploads/${k}`)[0]);
    expect(s3.objects.size).toBe(0);
  });
  it("relit un objet, null s'il est absent ou si la clé est suspecte", async () => {
    const { svc } = mk();
    const key = (await svc.save("platform", "logo", png, "png")).replace("https://api.example.com/uploads/", "");
    const obj = await svc.read(key);
    expect(obj?.contentType).toBe("image/png");
    expect(obj?.length).toBe(png.length);
    expect(await svc.read("platform/absent.png")).toBeNull();
    expect(await svc.read("../secret")).toBeNull();
    expect(await svc.read("a//b")).toBeNull();
  });
  it("propage une vraie erreur S3 (autre que « absent »)", async () => {
    const svc = new StorageService({ ...base, STORAGE_DRIVER: "s3" } as Env, new S3Driver({ send: async () => { throw Object.assign(new Error("refusé"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }); } }, "b"));
    await expect(svc.read("platform/x.png")).rejects.toThrow("refusé");
  });
});

describe("StorageService : pilote disque", () => {
  it("écrit dans UPLOAD_DIR, supprime au remplacement, refuse de sortir du dossier", async () => {
    const dir = await mkdtemp(join(tmpdir(), "storage-"));
    const svc = new StorageService({ ...base, UPLOAD_DIR: dir } as Env);
    const url = await svc.save("tenants/t1/menu", "plat", Buffer.from("x"), "png");
    const file = join(dir, url.replace("https://api.example.com/uploads/", ""));
    expect((await readFile(file)).toString()).toBe("x");
    await svc.remove("https://api.example.com/uploads/../outside.png");
    await svc.remove(url);
    await expect(stat(file)).rejects.toThrow();
  });
});
