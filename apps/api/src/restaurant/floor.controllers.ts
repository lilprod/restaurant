import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  FloorPlanInput, LayoutInput, floorPlanInputSchema, floorPlanUpdateSchema, layoutSchema, mergeTablesSchema, moveOrderSchema, splitTableSchema,
} from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { FLOOR, MANAGERS, STAFF } from "./common";
import { FloorService } from "./floor.service";
import { OrdersService } from "./orders.service";

const UUID = new ParseUUIDPipe();

@ApiTags("Restaurant · Plan de salle")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant/floor-plans")
export class FloorPlansController {
  constructor(private readonly floor: FloorService) {}

  @Get() list(@CurrentAccount() a: Account) { return this.floor.listPlans(a.tenantId!); }

  @Post() @TenantRoles(...MANAGERS)
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(floorPlanInputSchema)) body: FloorPlanInput) { return this.floor.createPlan(a, body); }

  @Patch(":id") @TenantRoles(...MANAGERS)
  update(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(floorPlanUpdateSchema)) body: Partial<FloorPlanInput>) {
    return this.floor.updatePlan(a, id, body);
  }

  @Delete(":id") @TenantRoles(...MANAGERS)
  remove(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.floor.removePlan(a, id); }

  /** Positions, formes, tailles et rotations des tables d'une salle, en lot. */
  @Put(":id/layout") @TenantRoles(...MANAGERS)
  layout(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(layoutSchema)) body: LayoutInput) { return this.floor.saveLayout(a, id, body); }
}

@ApiTags("Restaurant · Plan de salle")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...FLOOR)
@Controller("tenant/tables")
export class FloorTablesController {
  constructor(private readonly floor: FloorService) {}

  @Post("merge") @HttpCode(200)
  merge(@CurrentAccount() a: Account, @Body(new ZodPipe(mergeTablesSchema)) body: { tableIds: string[] }) { return this.floor.merge(a, body.tableIds); }

  @Post(":id/split") @HttpCode(200)
  split(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(splitTableSchema)) _body?: object) { return this.floor.split(a, id); }
}

@ApiTags("Restaurant · Plan de salle")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...FLOOR)
@Controller("tenant/orders")
export class OrderMoveController {
  constructor(private readonly orders: OrdersService) {}

  @Post(":id/move") @HttpCode(200)
  move(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(moveOrderSchema)) body: { tableId: string }) { return this.orders.move(a, id, body.tableId); }
}
