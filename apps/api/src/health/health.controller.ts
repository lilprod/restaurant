import { Controller, Get, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { HealthReport, HealthService } from "./health.service";

@ApiTags("Santé")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Public, sans authentification ni limitation : sonde Docker / nginx / supervision. 200 si tout répond, 503 sinon. */
  @Get() @SkipThrottle()
  @ApiOperation({ summary: "État de l'API (base de données, Redis si configuré)" })
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== "ok") res.status(503);
    res.setHeader("Cache-Control", "no-store");
    return report;
  }
}
