import { fitSms, type TemplateDef } from "./types";

export interface GenericData { subject: string; text: string }

/** Message libre : sert d'adaptateur à l'ancien `MailService` et aux messages ponctuels. */
export const generic: TemplateDef<GenericData> = {
  category: "transactional",
  sensitive: true, // contenu inconnu : jamais conservé dans le journal
  email: (d) => ({ subject: d.subject, paragraphs: d.text.split(/\n{2,}/) }),
  sms: (d) => fitSms(d.text),
};
