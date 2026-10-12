import { createAccountController, createAuthController } from "../security/auth.controllers";
import { TenantAuthGuard } from "./tenant-auth.guard";

export const TenantAuthController = createAuthController("tenant", "tenant/auth", "Restaurant · Authentification");
export const TenantAccountController = createAccountController(TenantAuthGuard, "tenant/account", "Restaurant · Mon compte");
