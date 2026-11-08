import type { INestApplication } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { ModulesContainer } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodPipe } from "./zod.pipe";

const METHODS = ["get", "post", "put", "delete", "patch"] as const;   // ordre de l'énumération RequestMethod
type Json = Record<string, any>;

const first = (p: unknown) => (Array.isArray(p) ? String(p[0] ?? "") : String(p ?? ""));
const join = (...parts: string[]) => "/" + parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

/**
 * Décrit corps et paramètres de requête dans le document OpenAPI à partir des schémas Zod partagés
 * (ceux que `ZodPipe` applique réellement : la documentation ne peut pas diverger de la validation).
 */
export function describeZodSchemas(app: INestApplication, doc: OpenAPIObject, prefix = "api/v1"): OpenAPIObject {
  const modules = app.get(ModulesContainer);
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctor = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!ctor?.prototype) continue;
      const base = first(Reflect.getMetadata(PATH_METADATA, ctor));
      for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
        const fn = (ctor.prototype as Json)[name];
        if (name === "constructor" || typeof fn !== "function") continue;
        const method = METHODS[Reflect.getMetadata(METHOD_METADATA, fn) as number];
        if (!method) continue;
        const path = toOpenApiPath(join(prefix, base, first(Reflect.getMetadata(PATH_METADATA, fn))));
        const op = doc.paths[path]?.[method] as Json | undefined;
        if (!op) continue;

        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctor, name) ?? {}) as Record<string, { pipes?: unknown[] }>;
        for (const [key, arg] of Object.entries(args)) {
          const pipe = arg.pipes?.find((p): p is ZodPipe<never> => p instanceof ZodPipe);
          if (!pipe) continue;
          const schema = zodToJsonSchema(pipe.schema, { target: "openApi3", $refStrategy: "none" }) as Json;
          const type = Number(key.split(":")[0]);
          if (type === RouteParamtypes.BODY) {
            op.requestBody = { required: true, content: { "application/json": { schema } } };
          } else if (type === RouteParamtypes.QUERY && schema.type === "object" && schema.properties) {
            const required = new Set<string>(schema.required ?? []);
            const known = new Set(((op.parameters ?? []) as Json[]).filter((p) => p.in === "query").map((p) => p.name));
            op.parameters = [
              ...(op.parameters ?? []),
              ...Object.entries(schema.properties as Json).filter(([n]) => !known.has(n)).map(([name, s]) => ({ name, in: "query", required: required.has(name), schema: s })),
            ];
          }
        }
      }
    }
  }
  return doc;
}
