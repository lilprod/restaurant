import { passwordReset, type PasswordResetData } from "./auth";
import { customerVerifyEmail, orderReady, type OrderReadyData, type VerifyEmailData } from "./customer";
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
import { deliveryDelivered, deliveryOnTheWay, type DeliveredData, type DeliveryOnTheWayData } from "./delivery";
import { dailyReport, type DailyReportData } from "./reports";
import {
  pushDeliveryAssigned, pushDeliveryReady, pushDeliveryUnassigned, pushKitchenItemsAdded, pushKitchenNewOrder, pushOrderReady, pushTest,
  type PushDeliveryData, type PushOrderItemsData, type PushOrderReadyData, type PushTestData,
} from "./push";
import { planningPublished, type PlanningPublishedData } from "./staff";
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
  "staff.planning-published": PlanningPublishedData;
  "customer.verify-email": VerifyEmailData;
  "order.ready": OrderReadyData;
  "delivery.on_the_way": DeliveryOnTheWayData;
  "delivery.delivered": DeliveredData;
  "reports.daily": DailyReportData;
  "push.test": PushTestData;
  "push.delivery-assigned": PushDeliveryData;
  "push.delivery-unassigned": PushDeliveryData;
  "push.delivery-ready": PushDeliveryData;
  "push.order-ready": PushOrderReadyData;
  "push.kitchen-new-order": PushOrderItemsData;
  "push.kitchen-items-added": PushOrderItemsData;
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
  "staff.planning-published": planningPublished,
  "customer.verify-email": customerVerifyEmail,
  "order.ready": orderReady,
  "delivery.on_the_way": deliveryOnTheWay,
  "delivery.delivered": deliveryDelivered,
  "reports.daily": dailyReport,
  "push.test": pushTest,
  "push.delivery-assigned": pushDeliveryAssigned,
  "push.delivery-unassigned": pushDeliveryUnassigned,
  "push.delivery-ready": pushDeliveryReady,
  "push.order-ready": pushOrderReady,
  "push.kitchen-new-order": pushKitchenNewOrder,
  "push.kitchen-items-added": pushKitchenItemsAdded,
};

/** Modèles disposant d'un contenu push. */
export type PushTemplateName = "push.test" | "push.delivery-assigned" | "push.delivery-unassigned" | "push.delivery-ready" | "push.order-ready" | "push.kitchen-new-order" | "push.kitchen-items-added";

export { renderEmail } from "./layout";
export * from "./types";
