import { passwordReset, type PasswordResetData } from "./auth";
import { generic, type GenericData } from "./generic";
import { licenseReminder, type LicenseReminderData } from "./license";
import {
  registrationApproved, registrationReceived, registrationRejected,
  type RegistrationApprovedData, type RegistrationReceivedData, type RegistrationRejectedData,
} from "./registration";
import {
  reservationCancelled, reservationConfirmed, reservationPending, reservationReminder, reservationUpdated, waitlistAvailable,
  type ReservationCancelledData, type ReservationData, type WaitlistAvailableData,
} from "./reservations";
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
  "reservation.confirmed": ReservationData;
  "reservation.pending": ReservationData;
  "reservation.updated": ReservationData & { confirmedNow?: boolean };
  "reservation.cancelled": ReservationCancelledData;
  "reservation.reminder": ReservationData;
  "waitlist.available": WaitlistAvailableData;
}
export type TemplateName = keyof TemplateDataMap;

export const TEMPLATES: { [K in TemplateName]: TemplateDef<TemplateDataMap[K]> } = {
  "auth.password-reset": passwordReset,
  "license.reminder": licenseReminder,
  "registration.received": registrationReceived,
  "registration.approved": registrationApproved,
  "registration.rejected": registrationRejected,
  "generic.message": generic,
  "reservation.confirmed": reservationConfirmed,
  "reservation.pending": reservationPending,
  "reservation.updated": reservationUpdated,
  "reservation.cancelled": reservationCancelled,
  "reservation.reminder": reservationReminder,
  "waitlist.available": waitlistAvailable,
};

export { renderEmail } from "./layout";
export * from "./types";
