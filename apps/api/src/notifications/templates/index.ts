import { passwordReset, type PasswordResetData } from "./auth";
import { generic, type GenericData } from "./generic";
import { licenseReminder, type LicenseReminderData } from "./license";
import {
  registrationApproved, registrationReceived, registrationRejected,
  type RegistrationApprovedData, type RegistrationReceivedData, type RegistrationRejectedData,
} from "./registration";
import type { TemplateDef } from "./types";

/**
 * Registre des modèles. Pour en ajouter un (P2A, X2, P5…) :
 *  1. créer `templates/<domaine>.ts` avec un `TemplateDef<MesVariables>` ;
 *  2. l'ajouter à `TemplateDataMap` (nom → type des variables) et à `TEMPLATES` ci-dessous ;
 *  3. appeler `notifications.send({ channel, to, template: "<nom>", data, tenantId })`.
 */
export interface TemplateDataMap {
  "auth.password-reset": PasswordResetData;
  "license.reminder": LicenseReminderData;
  "registration.received": RegistrationReceivedData;
  "registration.approved": RegistrationApprovedData;
  "registration.rejected": RegistrationRejectedData;
  "generic.message": GenericData;
}
export type TemplateName = keyof TemplateDataMap;

export const TEMPLATES: { [K in TemplateName]: TemplateDef<TemplateDataMap[K]> } = {
  "auth.password-reset": passwordReset,
  "license.reminder": licenseReminder,
  "registration.received": registrationReceived,
  "registration.approved": registrationApproved,
  "registration.rejected": registrationRejected,
  "generic.message": generic,
};

export { renderEmail } from "./layout";
export * from "./types";
