import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CategoryInput, CreateOrderInput, CreateStaffInput, ListOrdersQuery, MenuItemInput, OrderItemInput, OrderPaymentInput, TableInput,
  addItemsSchema, availabilitySchema, categoryInputSchema, categoryUpdateSchema, closeRegisterSchema, createOrderSchema,
  createStaffSchema, itemStatusSchema, listOrdersQuerySchema, menuItemInputSchema, menuItemUpdateSchema, openRegisterSchema,
  orderPaymentSchema, reasonSchema, reorderSchema, tableInputSchema, tableStatusSchema, tableUpdateSchema, updateOrderItemSchema,
  updateStaffSchema,
} from "@restaurant/validation";
import type { ItemStatus } from "@restaurant/utils";
import { ZodPipe } from "../common/zod.pipe";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { FLOOR, KITCHEN, MANAGERS, STAFF } from "./common";
import { DashboardService } from "./dashboard.service";
import { MenuService } from "./menu.service";
import { OrdersService } from "./orders.service";
import { RegisterService } from "./register.service";
import { StaffService } from "./staff.service";
import { TablesService } from "./tables.service";

const t = (a: Account) => a.tenantId!;
const UUID = new ParseUUIDPipe();

@ApiTags("Restaurant · Équipe")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@Controller("tenant/staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get() @TenantRoles(...MANAGERS)
  list(@CurrentAccount() a: Account) { return this.staff.list(t(a)); }

  @Post() @TenantRoles("ADMIN")
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(createStaffSchema)) body: CreateStaffInput) { return this.staff.create(t(a), body, a.id); }

  @Patch(":id") @TenantRoles("ADMIN")
  update(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(updateStaffSchema)) body: Record<string, string>) {
    return this.staff.update(t(a), id, body, a.id);
  }
}

@ApiTags("Restaurant · Tables")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant/tables")
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get() list(@CurrentAccount() a: Account, @Query("all") all?: string) { return this.tables.list(t(a), all === "true"); }

  @Post() @TenantRoles(...MANAGERS)
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(tableInputSchema)) body: TableInput) { return this.tables.create(t(a), body); }

  @Patch(":id") @TenantRoles(...MANAGERS)
  update(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(tableUpdateSchema)) body: Partial<TableInput>) {
    return this.tables.update(t(a), id, body);
  }

  /** Salle : marquer une table « à débarrasser » / « libre ». */
  @Patch(":id/status") @TenantRoles(...FLOOR)
  status(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(z.object({ status: tableStatusSchema }))) body: { status: string }) {
    return this.tables.update(t(a), id, { status: body.status });
  }

  @Delete(":id") @TenantRoles(...MANAGERS)
  remove(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.tables.remove(t(a), id); }
}

@ApiTags("Restaurant · Menu")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant/menu")
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get() full(@CurrentAccount() a: Account) { return this.menu.full(t(a)); }
  @Get("allergens") allergens() { return this.menu.allergens(); }

  @Post("categories") @TenantRoles(...MANAGERS)
  createCategory(@CurrentAccount() a: Account, @Body(new ZodPipe(categoryInputSchema)) body: CategoryInput) { return this.menu.createCategory(t(a), body); }

  @Patch("categories/:id") @TenantRoles(...MANAGERS)
  updateCategory(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(categoryUpdateSchema)) body: Partial<CategoryInput>) {
    return this.menu.updateCategory(t(a), id, body);
  }

  @Delete("categories/:id") @TenantRoles(...MANAGERS)
  deleteCategory(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.menu.deleteCategory(t(a), id); }

  @Post("categories/reorder") @HttpCode(200) @TenantRoles(...MANAGERS)
  reorderCategories(@CurrentAccount() a: Account, @Body(new ZodPipe(reorderSchema)) body: { ids: string[] }) { return this.menu.reorder(t(a), "categories", body.ids); }

  @Post("items/reorder") @HttpCode(200) @TenantRoles(...MANAGERS)
  reorderItems(@CurrentAccount() a: Account, @Body(new ZodPipe(reorderSchema)) body: { ids: string[] }) { return this.menu.reorder(t(a), "items", body.ids); }

  @Post("items") @TenantRoles(...MANAGERS)
  createItem(@CurrentAccount() a: Account, @Body(new ZodPipe(menuItemInputSchema)) body: MenuItemInput) { return this.menu.createItem(t(a), body); }

  @Patch("items/:id") @TenantRoles(...MANAGERS)
  updateItem(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(menuItemUpdateSchema)) body: Partial<MenuItemInput>) {
    return this.menu.updateItem(t(a), id, body);
  }

  /** « Épuisé » : la cuisine peut retirer un plat en plein service. */
  @Patch("items/:id/availability") @TenantRoles(...KITCHEN)
  availability(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(availabilitySchema)) body: { isAvailable: boolean }) {
    return this.menu.setAvailability(t(a), id, body.isAvailable);
  }

  @Delete("items/:id") @TenantRoles(...MANAGERS)
  deleteItem(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.menu.deleteItem(t(a), id); }

  @Post("items/:id/image") @HttpCode(201) @TenantRoles(...MANAGERS) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 4 * 1024 * 1024 } }))
  upload(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @UploadedFile() file: { buffer: Buffer } | undefined) {
    return this.menu.uploadImage(t(a), id, file);
  }

  @Delete("items/:id/image") @HttpCode(204) @TenantRoles(...MANAGERS)
  removeImage(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.menu.removeImage(t(a), id); }
}

@ApiTags("Public · Carte")
@Controller("public/tenants/:slug/menu")
export class PublicMenuController {
  constructor(private readonly menu: MenuService) {}
  @Get() get(@Param("slug") slug: string) { return this.menu.publicMenu(slug); }
}

@ApiTags("Restaurant · Commandes")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant/orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get() list(@CurrentAccount() a: Account, @Query(new ZodPipe(listOrdersQuerySchema)) q: ListOrdersQuery) { return this.orders.list(t(a), q); }

  @Post() @TenantRoles(...FLOOR)
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(createOrderSchema)) body: CreateOrderInput) { return this.orders.create(a, body); }

  @Get(":id") get(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.orders.get(t(a), id); }

  @Get(":id/receipt") @TenantRoles(...FLOOR)
  receipt(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.orders.receipt(t(a), id); }

  @Post(":id/items") @HttpCode(200) @TenantRoles(...FLOOR)
  addItems(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(addItemsSchema)) body: { items: OrderItemInput[] }) {
    return this.orders.addItems(a, id, body.items);
  }

  @Patch(":id/items/:itemId") @TenantRoles(...FLOOR)
  updateItem(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Param("itemId", UUID) itemId: string, @Body(new ZodPipe(updateOrderItemSchema)) body: { quantity?: number; instructions?: string }) {
    return this.orders.updateItem(a, id, itemId, body);
  }

  @Post(":id/items/:itemId/status") @HttpCode(200)
  itemStatus(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Param("itemId", UUID) itemId: string, @Body(new ZodPipe(itemStatusSchema)) body: { status: ItemStatus }) {
    return this.orders.setItemStatus(a, id, itemId, body.status);
  }

  @Post(":id/items/:itemId/cancel") @HttpCode(200) @TenantRoles(...FLOOR)
  cancelItem(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Param("itemId", UUID) itemId: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.orders.cancelItem(a, id, itemId, body.reason);
  }

  /** Avance tous les articles éligibles : « Lancer », « Tout est prêt », « Tout servi ». */
  @Post(":id/advance") @HttpCode(200)
  advance(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(z.object({ status: z.enum(["IN_PROGRESS", "READY", "SERVED"]) }))) body: { status: "IN_PROGRESS" | "READY" | "SERVED" }) {
    return this.orders.advanceAll(a, id, body.status);
  }

  @Post(":id/cancel") @HttpCode(200) @TenantRoles(...MANAGERS)
  cancel(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.orders.cancelOrder(a, id, body.reason);
  }

  @Post(":id/payments") @TenantRoles(...FLOOR)
  pay(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(orderPaymentSchema)) body: OrderPaymentInput) {
    return this.orders.pay(a, id, body);
  }

  @Post(":id/payments/:paymentId/refund") @HttpCode(200) @TenantRoles(...MANAGERS)
  refund(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Param("paymentId", UUID) pid: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.orders.refund(a, id, pid, body.reason);
  }
}

@ApiTags("Restaurant · Cuisine")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant/kitchen")
export class KitchenController {
  constructor(private readonly orders: OrdersService) {}
  @Get() board(@CurrentAccount() a: Account) { return this.orders.kitchen(t(a)); }
}

@ApiTags("Restaurant · Caisse")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@Controller("tenant/register")
export class RegisterController {
  constructor(private readonly register: RegisterService) {}

  @Get("current") @TenantRoles(...FLOOR)
  current(@CurrentAccount() a: Account) { return this.register.current(t(a)); }

  @Get("sessions") @TenantRoles(...MANAGERS)
  history(@CurrentAccount() a: Account) { return this.register.history(t(a)); }

  @Post("open") @TenantRoles(...MANAGERS)
  open(@CurrentAccount() a: Account, @Body(new ZodPipe(openRegisterSchema)) body: { opening: number }) { return this.register.open(t(a), a.id, body.opening); }

  @Post("close") @HttpCode(200) @TenantRoles(...MANAGERS)
  close(@CurrentAccount() a: Account, @Body(new ZodPipe(closeRegisterSchema)) body: { counted: number; notes?: string }) {
    return this.register.close(t(a), a.id, body.counted, body.notes);
  }
}

@ApiTags("Restaurant · Tableau de bord")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...MANAGERS)
@Controller("tenant/dashboard")
export class TenantDashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get() today(@CurrentAccount() a: Account, @Query(new ZodPipe(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))) q: { date?: string }) {
    return this.dashboard.today(t(a), q.date);
  }
}
