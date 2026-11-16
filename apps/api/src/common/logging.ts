import { ConsoleLogger, LogLevel, LoggerService } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Identifiant de la requête en cours (repris de `X-Request-Id` posé par nginx, sinon généré). */
const als = new AsyncLocalStorage<{ requestId: string }>();
export const currentRequestId = () => als.getStore()?.requestId;

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;
/** Les jetons placés dans l'URL (suivi de commande) ne doivent jamais apparaître dans les journaux. */
const redactPath = (url: string) => url.split("?")[0].replace(/(\/tracking\/)[^/]+/, "$1:token");

/** Middleware : identifiant de requête (en-tête de réponse `X-Request-Id`) + une ligne d'accès à la fin de la réponse. */
export function requestLogging(log: LoggerService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const inbound = req.headers["x-request-id"];
    const requestId = typeof inbound === "string" && VALID_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      if (req.originalUrl.startsWith("/api/v1/health")) return;          // sondes : pas de bruit
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10;
      const entry = { method: req.method, path: redactPath(req.originalUrl), status: res.statusCode, ms, ip: req.ip, requestId };
      const line = JSON.stringify(entry);
      if (res.statusCode >= 500) log.error?.(line, "http"); else log.log(line, "http");
    });
    als.run({ requestId }, next);
  };
}

/**
 * Journal Nest au format JSON, une ligne par événement : `{time, level, context, msg, requestId?}`.
 * Les lignes d'accès de `requestLogging` sont déjà du JSON : elles sont fusionnées plutôt qu'imbriquées.
 */
export class JsonLogger implements LoggerService {
  constructor(private readonly levels: LogLevel[] = ["log", "error", "warn"]) {}

  private write(level: string, message: unknown, rest: unknown[]) {
    const last = rest.length ? rest[rest.length - 1] : undefined;
    const context = typeof last === "string" ? last : undefined;
    const extra = context ? rest.slice(0, -1) : rest;
    let body: Record<string, unknown> = {};
    if (typeof message === "string" && message.startsWith("{") && context === "http") {
      try { body = JSON.parse(message); } catch { body = { msg: message }; }
    } else if (message instanceof Error) {
      body = { msg: message.message, stack: message.stack };
    } else {
      body = { msg: typeof message === "string" ? message : JSON.stringify(message) };
    }
    if (extra.length) body.detail = extra.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.stack ?? x.message : JSON.stringify(x))).join(" ");
    const requestId = (body.requestId as string | undefined) ?? currentRequestId();
    const out = { time: new Date().toISOString(), level, context, ...body, ...(requestId ? { requestId } : {}) };
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(JSON.stringify(out) + "\n");
  }

  log(message: unknown, ...rest: unknown[]) { if (this.levels.includes("log")) this.write("info", message, rest); }
  error(message: unknown, ...rest: unknown[]) { this.write("error", message, rest); }
  warn(message: unknown, ...rest: unknown[]) { this.write("warn", message, rest); }
  debug(message: unknown, ...rest: unknown[]) { if (this.levels.includes("debug")) this.write("debug", message, rest); }
  verbose(message: unknown, ...rest: unknown[]) { if (this.levels.includes("verbose")) this.write("verbose", message, rest); }
}

export function makeLogger(format: "json" | "text"): LoggerService {
  return format === "json" ? new JsonLogger() : new ConsoleLogger();
}
