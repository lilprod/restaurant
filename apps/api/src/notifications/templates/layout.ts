import type { Brand, EmailParts } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Gabarit commun des emails : en-tête (logo ou nom), paragraphes, bouton, signature, pied de page avec coordonnées. */
export function renderEmail(parts: EmailParts, brand: Brand): { subject: string; text: string; html: string } {
  const contact = [brand.contact.phone, brand.contact.email, brand.contact.address].filter(Boolean) as string[];

  const text = [
    ...parts.paragraphs,
    ...(parts.action ? [`${parts.action.label} : ${parts.action.url}`] : []),
    ...(parts.note ? [parts.note] : []),
    ...(brand.signature ? [brand.signature] : []),
    `—\n${brand.name}${contact.length ? `\n${contact.join(" · ")}` : ""}`,
  ].join("\n\n");

  const p = (s: string) => `<p style="margin:0 0 16px;line-height:1.55">${esc(s).replace(/\n/g, "<br>")}</p>`;
  const header = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" height="32" style="display:block;border:0">`
    : `<strong style="font-size:18px">${esc(brand.name)}</strong>`;
  const action = parts.action
    ? `<p style="margin:24px 0"><a href="${esc(parts.action.url)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${esc(parts.action.label)}</a></p>
<p style="margin:0 0 16px;font-size:12px;color:#666666;word-break:break-all">${esc(parts.action.url)}</p>`
    : "";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#171717">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px">
<tr><td style="padding:24px 28px;border-bottom:1px solid #eeeeee">${header}</td></tr>
<tr><td style="padding:28px;font-size:15px">
${parts.paragraphs.map(p).join("\n")}
${action}
${parts.note ? `<p style="margin:0 0 16px;font-size:13px;color:#666666">${esc(parts.note)}</p>` : ""}
${brand.signature ? p(brand.signature) : ""}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eeeeee;font-size:12px;color:#666666">${esc(brand.name)}${contact.length ? `<br>${contact.map(esc).join(" · ")}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: parts.subject, text, html };
}
