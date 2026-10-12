import { z, ZodIssueCode, type ZodErrorMap } from "zod";

/**
 * Messages français pour les schémas partagés (@restaurant/validation) qui n'en précisent pas :
 * l'API et les formulaires affichent « Obligatoire » plutôt que « String must contain at least 1 character(s) ».
 */
export const frenchErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "Obligatoire" };
      if (issue.expected === "number") return { message: "Saisissez un nombre" };
      return { message: "Valeur invalide" };
    case ZodIssueCode.too_small:
      if (issue.type === "string") return { message: Number(issue.minimum) <= 1 ? "Obligatoire" : `${issue.minimum} caractères minimum` };
      if (issue.type === "array") return { message: Number(issue.minimum) <= 1 ? "Ajoutez au moins un élément" : `Au moins ${issue.minimum} éléments` };
      return { message: `La valeur doit être supérieure ou égale à ${issue.minimum}` };
    case ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `${issue.maximum} caractères maximum` };
      if (issue.type === "array") return { message: `${issue.maximum} éléments maximum` };
      return { message: `La valeur doit être inférieure ou égale à ${issue.maximum}` };
    case ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "Adresse email invalide" };
      if (issue.validation === "uuid") return { message: "Choix invalide" };
      if (issue.validation === "url") return { message: "Adresse web invalide" };
      return { message: "Format invalide" };
    case ZodIssueCode.invalid_enum_value:
      return { message: "Choix invalide" };
    case ZodIssueCode.not_multiple_of:
      return { message: "Valeur invalide" };
    default:
      return { message: ctx.defaultError };
  }
};

export function installFrenchErrors() {
  z.setErrorMap(frenchErrorMap);
}
