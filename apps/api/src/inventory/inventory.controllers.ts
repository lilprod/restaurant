import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CreateStockCountInput, IngredientInput, IngredientUpdate, ListIngredientsQuery, ListMovementsQuery, ListPurchaseOrdersQuery,
  ListWasteQuery, PurchaseOrderInput, PurchaseOrderUpdate, ReceivePurchaseInput, RecipeInput, StockAdjustInput, StockCountLinesInput,
  SupplierInput, SupplierUpdate, WasteInput,
  createStockCountSchema, ingredientInputSchema, ingredientUpdateSchema, listIngredientsQuerySchema, listMovementsQuerySchema,
  listPurchaseOrdersQuerySchema, listWasteQuerySchema, purchaseOrderInputSchema, purchaseOrderUpdateSchema, receivePurchaseSchema,
  recipeInputSchema, stockAdjustSchema, stockCountLinesSchema, supplierInputSchema, supplierUpdateSchema, wasteInputSchema,
} from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { KITCHEN, MANAGERS } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { PlanFeature, PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { InventoryService } from "./inventory.service";
import { PurchasingService } from "./purchasing.service";
import { RecipesService } from "./recipes.service";

const t = (a: Account) => a.tenantId!;
const UUID = new ParseUUIDPipe();

/** Lecture : cuisine + responsables ; écriture : responsables ; pertes déclarables par la cuisine. Plan : module `inventory`. */
@ApiTags("Restaurant · Stock")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard, PlanFeatureGuard)
@PlanFeature("inventory")
@TenantRoles(...KITCHEN)
@Controller("tenant/inventory")
export class InventoryController {
  constructor(private readonly inv: InventoryService, private readonly recipes: RecipesService) {}

  @Get("ingredients") list(@CurrentAccount() a: Account, @Query(new ZodPipe(listIngredientsQuerySchema)) q: ListIngredientsQuery) { return this.inv.list(t(a), q); }
  @Get("ingredients/categories") categories(@CurrentAccount() a: Account) { return this.inv.categories(t(a)); }
  @Get("ingredients/:id") get(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.inv.get(t(a), id); }

  @Post("ingredients") @TenantRoles(...MANAGERS)
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(ingredientInputSchema)) body: IngredientInput) { return this.inv.create(a, body); }

  @Patch("ingredients/:id") @TenantRoles(...MANAGERS)
  update(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(ingredientUpdateSchema)) body: IngredientUpdate) { return this.inv.update(a, id, body); }

  @Delete("ingredients/:id") @TenantRoles(...MANAGERS)
  remove(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.inv.remove(a, id); }

  @Post("ingredients/:id/adjust") @HttpCode(200) @TenantRoles(...MANAGERS)
  adjust(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(stockAdjustSchema)) body: StockAdjustInput) { return this.inv.adjust(a, id, body); }

  @Get("movements") movements(@CurrentAccount() a: Account, @Query(new ZodPipe(listMovementsQuerySchema)) q: ListMovementsQuery) { return this.inv.movements(t(a), q); }

  @Get("waste") waste(@CurrentAccount() a: Account, @Query(new ZodPipe(listWasteQuerySchema)) q: ListWasteQuery) { return this.inv.wasteList(t(a), q); }
  @Post("waste") declareWaste(@CurrentAccount() a: Account, @Body(new ZodPipe(wasteInputSchema)) body: WasteInput) { return this.inv.declareWaste(a, body); }

  @Get("alerts") alerts(@CurrentAccount() a: Account) { return this.inv.alerts(t(a)); }
  @Get("dish-costs") @TenantRoles(...MANAGERS) dishCosts(@CurrentAccount() a: Account) { return this.recipes.dishCosts(t(a)); }

  @Get("counts") counts(@CurrentAccount() a: Account) { return this.inv.counts(t(a)); }
  @Get("counts/:id") count(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.inv.getCount(t(a), id); }

  @Post("counts") @TenantRoles(...MANAGERS)
  createCount(@CurrentAccount() a: Account, @Body(new ZodPipe(createStockCountSchema)) body: CreateStockCountInput) { return this.inv.createCount(a, body); }

  @Patch("counts/:id/lines") @TenantRoles(...MANAGERS)
  saveCount(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(stockCountLinesSchema)) body: StockCountLinesInput) { return this.inv.saveCountLines(a, id, body); }

  @Post("counts/:id/validate") @HttpCode(200) @TenantRoles(...MANAGERS)
  validateCount(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.inv.validateCount(a, id); }

  @Post("counts/:id/cancel") @HttpCode(200) @TenantRoles(...MANAGERS)
  cancelCount(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.inv.cancelCount(a, id); }
}

@ApiTags("Restaurant · Stock")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard, PlanFeatureGuard)
@PlanFeature("inventory")
@TenantRoles(...KITCHEN)
@Controller("tenant/menu")
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get("items/:id/recipe") dish(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.recipes.dish(t(a), id); }

  @Put("items/:id/recipe") @TenantRoles(...MANAGERS)
  setDish(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(recipeInputSchema)) body: RecipeInput) { return this.recipes.setDish(t(a), id, body); }

  @Get("options/:id/recipe") option(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.recipes.option(t(a), id); }

  @Put("options/:id/recipe") @TenantRoles(...MANAGERS)
  setOption(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(recipeInputSchema)) body: RecipeInput) { return this.recipes.setOption(t(a), id, body); }
}

@ApiTags("Restaurant · Fournisseurs")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard, PlanFeatureGuard)
@PlanFeature("inventory")
@TenantRoles(...KITCHEN)
@Controller("tenant/suppliers")
export class SuppliersController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get() list(@CurrentAccount() a: Account, @Query("all") all?: string) { return this.purchasing.suppliers(t(a), all === "true"); }

  @Post() @TenantRoles(...MANAGERS)
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(supplierInputSchema)) body: SupplierInput) { return this.purchasing.createSupplier(t(a), body); }

  @Patch(":id") @TenantRoles(...MANAGERS)
  update(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(supplierUpdateSchema)) body: SupplierUpdate) { return this.purchasing.updateSupplier(t(a), id, body); }

  @Delete(":id") @TenantRoles(...MANAGERS)
  remove(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.purchasing.removeSupplier(t(a), id); }
}

@ApiTags("Restaurant · Fournisseurs")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard, PlanFeatureGuard)
@PlanFeature("inventory")
@TenantRoles(...KITCHEN)
@Controller("tenant/purchase-orders")
export class PurchaseOrdersController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get() list(@CurrentAccount() a: Account, @Query(new ZodPipe(listPurchaseOrdersQuerySchema)) q: ListPurchaseOrdersQuery) { return this.purchasing.list(t(a), q); }
  @Get(":id") get(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.purchasing.get(t(a), id); }

  @Post() @TenantRoles(...MANAGERS)
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(purchaseOrderInputSchema)) body: PurchaseOrderInput) { return this.purchasing.create(a, body); }

  @Patch(":id") @TenantRoles(...MANAGERS)
  update(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(purchaseOrderUpdateSchema)) body: PurchaseOrderUpdate) { return this.purchasing.update(a, id, body); }

  @Post(":id/send") @HttpCode(200) @TenantRoles(...MANAGERS)
  send(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.purchasing.send(a, id); }

  @Post(":id/receive") @HttpCode(200) @TenantRoles(...MANAGERS)
  receive(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(receivePurchaseSchema)) body: ReceivePurchaseInput) { return this.purchasing.receive(a, id, body); }

  @Post(":id/cancel") @HttpCode(200) @TenantRoles(...MANAGERS)
  cancel(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.purchasing.cancel(a, id); }
}
