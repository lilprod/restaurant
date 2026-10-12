/* eslint-disable @typescript-eslint/no-explicit-any */
import { zodResolver } from "@hookform/resolvers/zod";
import {
  businessSchema, companySchema, licensingSettingsSchema, localizationSchema, operationsSchema, paymentInstructionsSchema,
  platformSecuritySchema, tenantSecuritySchema,
} from "@restaurant/validation";
import { X } from "lucide-react";
import * as React from "react";
import { Controller, useForm, useWatch, type FieldValues, type UseFormReturn } from "react-hook-form";
import type { ZodTypeAny } from "zod";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { SettingsSection } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { SwitchRow } from "@/components/ui/switch";
import { applyApiErrors } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { TENANT_ROLE_LABEL } from "@/lib/labels";
import { FieldGrid, ReadOnlyNotice, SaveBar, SectionError, SectionSkeleton, useSaveSection, useSection, type SettingsAdapter } from "./common";

type AnyForm = UseFormReturn<FieldValues>;

/**
 * Formulaire d'une section : charge, préremplit, valide avec le schéma Zod partagé, envoie les valeurs
 * BRUTES (une chaîne vide efface un champ côté API — la valeur transformée `undefined` serait ignorée par la fusion).
 */
function useSectionForm(adapter: SettingsAdapter, section: string, schema: ZodTypeAny) {
  const query = useSection<Record<string, any>>(adapter, section);
  const save = useSaveSection(adapter, section);
  const form = useForm<FieldValues>({ resolver: zodResolver(schema, undefined, { raw: true }), mode: "onTouched" });
  React.useEffect(() => { if (query.data) form.reset(normalize(query.data)); }, [query.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = form.handleSubmit(async (values) => {
    try {
      const data = await save.mutateAsync(values);
      form.reset(normalize(data as Record<string, any>));
    } catch (e) {
      applyApiErrors(e, form.setError);
    }
  }, () => {
    // focus sur le premier champ en erreur
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
  });
  return { query, save, form, submit };
}

/** Champs texte optionnels absents → "" (contrôles contrôlés, effacement possible). */
function normalize(v: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(v ?? {}));
}

function errorAt(form: AnyForm, path: string): string | undefined {
  const parts = path.split(".");
  let cur: any = form.formState.errors;
  for (const p of parts) cur = cur?.[p];
  return cur?.message as string | undefined;
}

function SectionShell({ adapter, query, form, save, submit, children }: {
  adapter: SettingsAdapter; query: ReturnType<typeof useSection>; form: AnyForm; save: { isPending: boolean }; submit: () => void; children: React.ReactNode;
}) {
  if (query.isLoading) return <SectionSkeleton />;
  if (query.isError) return <SectionError error={query.error} retry={() => query.refetch()} />;
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      {!adapter.canWrite && <ReadOnlyNotice />}
      <fieldset disabled={!adapter.canWrite} className="flex min-w-0 flex-col gap-6">{children}</fieldset>
      <SaveBar dirty={form.formState.isDirty} saving={save.isPending} onReset={() => form.reset()} onSave={submit} canWrite={adapter.canWrite} />
    </form>
  );
}

function T({ form, name, label, hint, required, ...rest }: { form: AnyForm; name: string; label: string; hint?: string; required?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "form" | "name">) {
  return (
    <Field label={label} hint={hint} required={required} error={errorAt(form, name)}>
      <Input {...rest} {...form.register(name)} />
    </Field>
  );
}

function N({ form, name, label, hint, suffix, min, max, step }: { form: AnyForm; name: string; label: string; hint?: string; suffix?: string; min?: number; max?: number; step?: number }) {
  return (
    <Field label={label} hint={hint} error={errorAt(form, name)}>
      <Input type="number" inputMode="decimal" min={min} max={max} step={step ?? 1} className="font-mono"
        trailing={suffix ? <span className="pr-2 text-xs text-muted-foreground">{suffix}</span> : undefined}
        {...form.register(name, { valueAsNumber: true })} />
    </Field>
  );
}

function S({ form, name, label, description }: { form: AnyForm; name: string; label: string; description?: string }) {
  return (
    <Controller control={form.control} name={name} render={({ field }) => (
      <SwitchRow label={label} description={description} checked={!!field.value} onCheckedChange={field.onChange} />
    )} />
  );
}

function AddressFields({ form, prefix }: { form: AnyForm; prefix: string }) {
  return (
    <>
      <T form={form} name={`${prefix}.street`} label="Rue" autoComplete="street-address" />
      <FieldGrid>
        <T form={form} name={`${prefix}.complement`} label="Complément" />
        <T form={form} name={`${prefix}.city`} label="Ville" />
        <T form={form} name={`${prefix}.postalCode`} label="Code postal / BP" />
        <T form={form} name={`${prefix}.region`} label="Région" />
      </FieldGrid>
      <T form={form} name={`${prefix}.country`} label="Pays" />
    </>
  );
}

function SocialFields({ form }: { form: AnyForm }) {
  return (
    <FieldGrid>
      {[["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"], ["linkedin", "LinkedIn"], ["x", "X (Twitter)"]].map(([k, l]) => (
        <T key={k} form={form} name={`social.${k}`} label={l!} type="url" inputMode="url" placeholder="https://" />
      ))}
      <T form={form} name="social.whatsapp" label="WhatsApp" type="tel" inputMode="tel" placeholder="+228 90 00 00 00" />
    </FieldGrid>
  );
}

// ── Restaurant : informations ──
export function BusinessForm({ adapter }: { adapter: SettingsAdapter }) {
  const { query, save, form, submit } = useSectionForm(adapter, "business", businessSchema);
  return (
    <SectionShell adapter={adapter} query={query} form={form} save={save} submit={submit}>
      <SettingsSection title="Identité" description="Le nom commercial est affiché partout ; les informations légales apparaissent sur les reçus.">
        <FieldGrid>
          <T form={form} name="tradeName" label="Nom commercial" required />
          <T form={form} name="legalName" label="Raison sociale" />
          <T form={form} name="cuisineType" label="Type de cuisine" placeholder="Togolaise, grillades…" />
          <T form={form} name="website" label="Site web" type="url" inputMode="url" placeholder="https://" />
          <T form={form} name="taxId" label="NIF" className="font-mono" />
          <T form={form} name="registrationNumber" label="RCCM" className="font-mono" />
        </FieldGrid>
        <Field label="Description" error={errorAt(form, "description")} hint="600 caractères maximum.">
          <Textarea rows={3} maxLength={600} {...form.register("description")} />
        </Field>
      </SettingsSection>
      <SettingsSection title="Coordonnées" description="Utilisées sur les reçus et pour vous contacter.">
        <FieldGrid>
          <T form={form} name="phone" label="Téléphone" type="tel" inputMode="tel" />
          <T form={form} name="email" label="Email" type="email" inputMode="email" />
        </FieldGrid>
        <AddressFields form={form} prefix="address" />
      </SettingsSection>
      <SettingsSection title="Réseaux sociaux">
        <SocialFields form={form} />
      </SettingsSection>
      <SettingsSection title="Ticket de caisse" description="Textes imprimés en haut et en bas des reçus clients.">
        <Field label="En-tête" error={errorAt(form, "receipt.headerText")}><Textarea rows={2} maxLength={200} {...form.register("receipt.headerText")} /></Field>
        <Field label="Pied de page" error={errorAt(form, "receipt.footerText")}><Textarea rows={2} maxLength={300} {...form.register("receipt.footerText")} /></Field>
        <div className="divide-y divide-border">
          <S form={form} name="receipt.showLogo" label="Afficher le logo" description="Imprimé en tête du ticket." />
          <S form={form} name="receipt.showTaxId" label="Afficher le NIF" description="Recommandé pour les clients professionnels." />
        </div>
      </SettingsSection>
    </SectionShell>
  );
}

// ── Plateforme : société ──
export function CompanyForm({ adapter }: { adapter: SettingsAdapter }) {
  const { query, save, form, submit } = useSectionForm(adapter, "company", companySchema);
  return (
    <SectionShell adapter={adapter} query={query} form={form} save={save} submit={submit}>
      <SettingsSection title="Société éditrice" description="Mentions légales affichées sur les reçus de licence.">
        <FieldGrid>
          <T form={form} name="legalName" label="Raison sociale" required />
          <T form={form} name="tradeName" label="Nom commercial" />
          <T form={form} name="legalForm" label="Forme juridique" placeholder="SARL, SA…" />
          <T form={form} name="website" label="Site web" type="url" inputMode="url" placeholder="https://" />
          <T form={form} name="taxId" label="NIF" className="font-mono" />
          <T form={form} name="registrationNumber" label="RCCM" className="font-mono" />
        </FieldGrid>
        <Field label="Description" error={errorAt(form, "description")}><Textarea rows={3} maxLength={600} {...form.register("description")} /></Field>
      </SettingsSection>
      <SettingsSection title="Contacts" description="Le support est affiché aux restaurants (écran de licence expirée, page Licence).">
        <FieldGrid>
          <T form={form} name="phone" label="Téléphone" type="tel" inputMode="tel" />
          <T form={form} name="email" label="Email" type="email" inputMode="email" />
          <T form={form} name="supportPhone" label="Téléphone du support" type="tel" inputMode="tel" />
          <T form={form} name="supportEmail" label="Email du support" type="email" inputMode="email" />
        </FieldGrid>
        <AddressFields form={form} prefix="address" />
      </SettingsSection>
      <SettingsSection title="Réseaux sociaux"><SocialFields form={form} /></SettingsSection>
    </SectionShell>
  );
}

// ── Restaurant : exploitation ──
function TipPresets({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < 0 || n > 50 || value.includes(n) || value.length >= 5) return;
    onChange([...value, n].sort((a, b) => a - b));
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((v) => (
        <span key={v} className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-subtle pl-3 pr-1 font-mono text-sm">
          {v} %
          <button type="button" aria-label={`Retirer ${v} %`} onClick={() => onChange(value.filter((x) => x !== v))} className="flex size-7 items-center justify-center rounded-full hover:bg-hover"><X className="size-3.5" /></button>
        </span>
      ))}
      {value.length < 5 && (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
          inputMode="numeric"
          placeholder="Ajouter…"
          aria-label="Ajouter un pourcentage de pourboire"
          className="h-9 w-28 font-mono"
        />
      )}
    </div>
  );
}

export function OperationsForm({ adapter }: { adapter: SettingsAdapter }) {
  const { query, save, form, submit } = useSectionForm(adapter, "operations", operationsSchema);
  const [tips, vat] = useWatch({ control: form.control, name: ["tipsEnabled", "defaultVatRate"] });
  return (
    <SectionShell adapter={adapter} query={query} form={form} save={save} submit={submit}>
      <SettingsSection title="Taxes et service" description={`Exemple : une addition de ${formatFcfa(10000)} HT donne ${formatFcfa(Math.round(10000 * (1 + (Number(vat) || 0) / 100)))} TTC.`}>
        <FieldGrid>
          <N form={form} name="defaultVatRate" label="TVA par défaut" suffix="%" min={0} max={30} step={0.5} />
          <N form={form} name="serviceChargePercent" label="Frais de service" suffix="%" min={0} max={30} step={0.5} />
        </FieldGrid>
        <div className="divide-y divide-border">
          <S form={form} name="tipsEnabled" label="Pourboires" description="Proposer un pourboire au moment du paiement." />
        </div>
        {tips && (
          <Field label="Pourcentages proposés" hint="Jusqu'à 5 valeurs, de 0 à 50 %." error={errorAt(form, "tipPresets")}>
            <Controller control={form.control} name="tipPresets" render={({ field }) => <TipPresets value={field.value ?? []} onChange={field.onChange} />} />
          </Field>
        )}
      </SettingsSection>
      <SettingsSection title="Réservations">
        <div className="divide-y divide-border">
          <S form={form} name="onlineReservations" label="Réservations en ligne" description="Les clients peuvent réserver une table depuis votre page." />
        </div>
        <FieldGrid cols={3}>
          <N form={form} name="reservationDurationMinutes" label="Durée d'une réservation" suffix="min" min={30} max={360} />
          <N form={form} name="maxPartySize" label="Couverts max. par réservation" min={1} max={100} />
          <Field label="Créneaux" error={errorAt(form, "reservationSlotMinutes")}>
            <Controller control={form.control} name="reservationSlotMinutes" render={({ field }) => (
              <NativeSelect value={String(field.value ?? 15)} onChange={(e) => field.onChange(Number(e.target.value))}>
                {[10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>Toutes les {n} min</option>)}
              </NativeSelect>
            )} />
          </Field>
        </FieldGrid>
      </SettingsSection>
      <SettingsSection title="Vente à emporter et livraison">
        <div className="divide-y divide-border">
          <S form={form} name="takeawayEnabled" label="Vente à emporter" />
          <S form={form} name="deliveryEnabled" label="Livraison" description="Zones et frais de livraison arrivent avec le module commandes." />
        </div>
      </SettingsSection>
    </SectionShell>
  );
}

// ── Localisation ──
const TIMEZONES: string[] = (() => {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    const africa = all.filter((z) => z.startsWith("Africa/"));
    return [...africa, ...all.filter((z) => !z.startsWith("Africa/"))];
  } catch { return ["Africa/Lome", "Africa/Abidjan", "Africa/Lagos", "Europe/Paris", "UTC"]; }
})();

export function LocalizationForm({ adapter }: { adapter: SettingsAdapter }) {
  const { query, save, form, submit } = useSectionForm(adapter, "localization", localizationSchema);
  const tz = useWatch({ control: form.control, name: "timezone" }) as string | undefined;
  let now = "";
  try { now = new Intl.DateTimeFormat("fr-FR", { timeZone: tz || "Africa/Lome", dateStyle: "full", timeStyle: "short" }).format(new Date()); } catch { now = ""; }
  return (
    <SectionShell adapter={adapter} query={query} form={form} save={save} submit={submit}>
      <SettingsSection title="Langue et région" description={now ? `Heure locale actuelle : ${now}` : undefined}>
        <FieldGrid>
          <Field label="Langue" error={errorAt(form, "locale")}>
            <Controller control={form.control} name="locale" render={({ field }) => (
              <Segmented ariaLabel="Langue" value={field.value ?? "fr"} onChange={field.onChange} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} className="sm:w-full" />
            )} />
          </Field>
          <Field label="Fuseau horaire" error={errorAt(form, "timezone")}>
            <NativeSelect {...form.register("timezone")}>
              {(tz && !TIMEZONES.includes(tz) ? [tz, ...TIMEZONES] : TIMEZONES).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Format de date" error={errorAt(form, "dateFormat")}>
            <Controller control={form.control} name="dateFormat" render={({ field }) => (
              <Segmented ariaLabel="Format de date" size="sm" value={field.value ?? "DD/MM/YYYY"} onChange={field.onChange} className="sm:w-full"
                options={["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"].map((f) => ({ value: f, label: <span className="font-mono text-xs">{f}</span> }))} />
            )} />
          </Field>
          <Field label="Premier jour de la semaine" error={errorAt(form, "firstDayOfWeek")}>
            <Controller control={form.control} name="firstDayOfWeek" render={({ field }) => (
              <Segmented ariaLabel="Premier jour de la semaine" value={String(field.value ?? 1)} onChange={(v) => field.onChange(Number(v))} className="sm:w-full"
                options={[{ value: "1", label: "Lundi" }, { value: "0", label: "Dimanche" }, { value: "6", label: "Samedi" }]} />
            )} />
          </Field>
        </FieldGrid>
      </SettingsSection>
    </SectionShell>
  );
}

// ── Politique de sécurité ──
export function SecurityPolicyForm({ adapter, space }: { adapter: SettingsAdapter; space: "platform" | "tenant" }) {
  const { query, save, form, submit } = useSectionForm(adapter, "security", space === "platform" ? platformSecuritySchema : tenantSecuritySchema);
  return (
    <SectionShell adapter={adapter} query={query} form={form} save={save} submit={submit}>
      <SettingsSection title="Mots de passe" description="S'applique aux nouveaux mots de passe. Les mots courants et ceux contenant l'email ou le nom sont toujours refusés.">
        <FieldGrid>
          <N form={form} name="passwordPolicy.minLength" label="Longueur minimale" suffix="caractères" min={8} max={64} />
          <N form={form} name="passwordExpiryDays" label="Expiration" suffix="jours" min={0} max={365} hint="0 = jamais" />
        </FieldGrid>
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
          <S form={form} name="passwordPolicy.requireUpper" label="Au moins une majuscule" />
          <S form={form} name="passwordPolicy.requireLower" label="Au moins une minuscule" />
          <S form={form} name="passwordPolicy.requireDigit" label="Au moins un chiffre" />
          <S form={form} name="passwordPolicy.requireSymbol" label="Au moins un symbole" />
        </div>
      </SettingsSection>
      <SettingsSection title="Verrouillage et sessions">
        <FieldGrid cols={3}>
          <N form={form} name="maxFailedAttempts" label="Tentatives avant verrouillage" min={3} max={10} />
          <N form={form} name="lockoutMinutes" label="Durée du verrouillage" suffix="min" min={5} max={1440} />
          <N form={form} name="sessionDays" label="Durée d'une session" suffix="jours" min={1} max={90} />
        </FieldGrid>
      </SettingsSection>
      <SettingsSection title="Double authentification" description="Les comptes concernés devront l'activer à leur prochaine connexion.">
        {space === "platform" ? (
          <div className="divide-y divide-border"><S form={form} name="require2fa" label="Obligatoire pour toute l'équipe" description="SuperAdmin et Support." /></div>
        ) : (
          <Controller control={form.control} name="require2faRoles" render={({ field }) => {
            const v: string[] = field.value ?? [];
            return (
              <div className="grid gap-2 sm:grid-cols-4" role="group" aria-label="Rôles soumis à la 2FA">
                {["ADMIN", "MANAGER", "WAITER", "KITCHEN"].map((r) => (
                  <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 text-sm has-[:checked]:border-brand-ink has-[:checked]:bg-brand-tint">
                    <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={v.includes(r)} onChange={(e) => field.onChange(e.target.checked ? [...v, r] : v.filter((x) => x !== r))} />
                    {TENANT_ROLE_LABEL[r]}
                  </label>
                ))}
              </div>
            );
          }} />
        )}
      </SettingsSection>
    </SectionShell>
  );
}

// ── Plateforme : instructions de paiement ──
export function PaymentInstructionsForm({ adapter }: { adapter: SettingsAdapter }) {
  const { query, save, form, submit } = useSectionForm(adapter, "paymentInstructions", paymentInstructionsSchema);
  return (
    <SectionShell adapter={adapter} query={query} form={form} save={save} submit={submit}>
      <SettingsSection title="Mobile money" description="Affiché aux restaurants dans « Comment payer » (page Licence).">
        <FieldGrid>
          <T form={form} name="flooz.number" label="Numéro Flooz" type="tel" inputMode="tel" className="font-mono" />
          <T form={form} name="flooz.holder" label="Titulaire Flooz" />
          <T form={form} name="tmoney.number" label="Numéro TMoney" type="tel" inputMode="tel" className="font-mono" />
          <T form={form} name="tmoney.holder" label="Titulaire TMoney" />
        </FieldGrid>
      </SettingsSection>
      <SettingsSection title="Virement bancaire">
        <FieldGrid>
          <T form={form} name="bank.bankName" label="Banque" />
          <T form={form} name="bank.accountHolder" label="Titulaire du compte" />
        </FieldGrid>
        <T form={form} name="bank.accountNumber" label="Numéro de compte / IBAN" className="font-mono" />
      </SettingsSection>
      <SettingsSection title="Espèces et consignes">
        <Field label="Paiement en espèces" error={errorAt(form, "cashNote")} hint="Lieu, horaires…"><Textarea rows={2} maxLength={300} {...form.register("cashNote")} /></Field>
        <Field label="Consignes générales" error={errorAt(form, "instructions")}><Textarea rows={3} maxLength={600} {...form.register("instructions")} /></Field>
      </SettingsSection>
    </SectionShell>
  );
}

// ── Plateforme : licences ──
export function LicensingForm({ adapter }: { adapter: SettingsAdapter }) {
  const { query, save, form, submit } = useSectionForm(adapter, "licensing", licensingSettingsSchema);
  const days = Number(useWatch({ control: form.control, name: "graceDays" }) ?? 0);
  return (
    <SectionShell adapter={adapter} query={query} form={form} save={save} submit={submit}>
      <SettingsSection title="Période de grâce" description="Après l'échéance, le restaurant garde l'accès (avec un bandeau d'alerte) pendant ce délai, puis il est suspendu.">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="sm:w-48"><N form={form} name="graceDays" label="Durée" suffix="jours" min={0} max={30} /></div>
          <input type="range" min={0} max={30} value={Number.isFinite(days) ? days : 0} aria-label="Durée de la période de grâce"
            onChange={(e) => form.setValue("graceDays", Number(e.target.value), { shouldDirty: true })}
            className="h-11 flex-1 accent-[var(--color-primary)]" />
        </div>
        <ol className="flex flex-col gap-0 overflow-hidden rounded-lg border border-border text-sm sm:flex-row">
          {[["Échéance", "J"], ["Grâce", `J+1 → J+${days}`], ["Suspension", `J+${days + 1}`]].map(([a, b], i) => (
            <li key={a} className={`flex flex-1 flex-col gap-0.5 px-4 py-3 ${i === 1 ? "bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]" : i === 2 ? "bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]" : "bg-subtle"}`}>
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] opacity-80">{a}</span>
              <span className="font-mono">{b}</span>
            </li>
          ))}
        </ol>
      </SettingsSection>
    </SectionShell>
  );
}
