import { createAccountController, createAuthController } from "../../security/auth.controllers";
import { PlatformAuthGuard } from "./platform-auth.guard";

export const PlatformAuthController = createAuthController("platform", "platform/auth", "Plateforme · Authentification");
export const PlatformAccountController = createAccountController(PlatformAuthGuard, "platform/account", "Plateforme · Mon compte");
