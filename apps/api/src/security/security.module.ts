import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { CryptoService } from "../common/crypto.service";
import { APP_ENV, Env } from "../config/env";
import { AccountAdminService } from "./account-admin.service";
import { AccountService } from "./account.service";
import { AccountsRepo } from "./accounts.repo";
import { AuthService } from "./auth.service";
import { LicenseGateService } from "./license-gate.service";
import { LoginEventsService } from "./login-events.service";
import { PasswordService } from "./password.service";
import { SecurityPolicyService } from "./security-policy.service";
import { SessionService } from "./session.service";
import { TotpService } from "./totp.service";

const providers = [
  CryptoService, AccountsRepo, SecurityPolicyService, LoginEventsService, SessionService, PasswordService,
  TotpService, LicenseGateService, AuthService, AccountService, AccountAdminService,
];

/** Authentification, sessions, 2FA, verrouillage : commun à la plateforme et aux restaurants. */
@Global()
@Module({
  imports: [JwtModule.registerAsync({ inject: [APP_ENV], useFactory: (env: Env) => ({ secret: env.JWT_ACCESS_SECRET }) })],
  providers,
  exports: [...providers, JwtModule],
})
export class SecurityModule {}
