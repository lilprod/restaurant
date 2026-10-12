import { zodResolver } from "@hookform/resolvers/zod";
import type { AssetKind, Assets, BrandingSettings } from "@restaurant/api-client";
import {
  contrastRatio, DEFAULT_THEME, FONT_STACKS, HEX_COLOR, THEME_PRESETS, themeToCssVars, themeWarnings, type Theme,
} from "@restaurant/utils";
import { brandingInputSchema, type BrandingInput } from "@restaurant/validation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChefHat, LayoutDashboard, Lock, Monitor, Moon, Settings, Sun, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Dropzone } from "@/components/ui/dropzone";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/label";
import { SettingsSection } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { SwitchRow } from "@/components/ui/switch";
import { deriveBrandVars, ensureBrandFont } from "@/lib/branding";
import { cn } from "@/lib/cn";
import { applyApiErrors, toastError } from "@/lib/errors";
import { ReadOnlyNotice, SaveBar, SectionError, SectionSkeleton, useSaveSection, useSection, type SettingsAdapter } from "./common";

const FONT_LABEL: Record<string, string> = { inter: "Inter", poppins: "Poppins", roboto: "Roboto", nunito: "Nunito", lato: "Lato", system: "Police du système" };
const RADIUS_LABEL: Record<string, string> = { none: "Aucun", sm: "S", md: "M", lg: "L", xl: "XL" };

/**
 * Marque & thème : nom, slogan, couleurs, police, arrondis, mode, logos et favicon.
 * L'aperçu (clair + sombre) se met à jour à chaque frappe, avant enregistrement : les variables CSS sont
 * calculées côté client avec `themeToCssVars` (@restaurant/utils, la même fonction que l'API) et appliquées
 * uniquement au conteneur de l'aperçu.
 */
export function BrandingEditor({ adapter, contextLabel = "Espace" }: { adapter: SettingsAdapter; contextLabel?: string }) {
  const query = useSection<BrandingSettings>(adapter, "branding");
  const save = useSaveSection<BrandingSettings>(adapter, "branding", "Marque enregistrée");
  const qc = useQueryClient();
  const form = useForm<BrandingInput>({ resolver: zodResolver(brandingInputSchema, undefined, { raw: true }), mode: "onChange" });
  const [assets, setAssets] = React.useState<Assets>({});

  React.useEffect(() => {
    if (!query.data) return;
    form.reset({ displayName: query.data.displayName, tagline: query.data.tagline ?? "", theme: { ...DEFAULT_THEME, ...query.data.theme } });
    setAssets(query.data.assets ?? {});
  }, [query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const values = useWatch({ control: form.control }) as Partial<BrandingInput>;
  const theme: Theme = { ...DEFAULT_THEME, ...(values.theme ?? {}) } as Theme;
  const validColors = HEX_COLOR.test(theme.primary) && HEX_COLOR.test(theme.accent);
  const liveWarnings = validColors ? themeWarnings(theme) : [];
  React.useEffect(() => { ensureBrandFont(theme.fontFamily); }, [theme.fontFamily]);

  const submit = form.handleSubmit(async (v) => {
    try {
      const data = await save.mutateAsync({ ...v, tagline: v.tagline ?? "" });
      form.reset({ displayName: data.displayName, tagline: data.tagline ?? "", theme: data.theme });
    } catch (e) { applyApiErrors(e, form.setError); }
  });

  async function upload(kind: AssetKind, file: File) {
    if (!adapter.uploadAsset) return;
    try {
      const r = await adapter.uploadAsset(kind, file);
      setAssets((a) => ({ ...a, [kind]: r.url }));
      toast.success(kind === "favicon" ? "Favicon mis à jour" : "Logo mis à jour");
      void qc.invalidateQueries({ queryKey: [...adapter.key, "branding"] });
      adapter.onSaved?.("branding");
    } catch (e) { toastError(e); throw e; }
  }
  async function remove(kind: AssetKind) {
    if (!adapter.removeAsset) return;
    try {
      await adapter.removeAsset(kind);
      setAssets((a) => ({ ...a, [kind]: null }));
      toast.success("Fichier retiré");
      void qc.invalidateQueries({ queryKey: [...adapter.key, "branding"] });
      adapter.onSaved?.("branding");
    } catch (e) { toastError(e); }
  }

  if (query.isLoading) return <SectionSkeleton />;
  if (query.isError) return <SectionError error={query.error} retry={() => query.refetch()} />;

  const errors = form.formState.errors;
  const preview = { displayName: values.displayName || "Votre marque", tagline: values.tagline, theme, assets };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {!adapter.canWrite && <ReadOnlyNotice />}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <fieldset disabled={!adapter.canWrite} className="flex min-w-0 flex-col gap-6">
          <SettingsSection title="Identité" description="Nom et slogan affichés sur la page de connexion et dans l'en-tête.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom affiché" required error={errors.displayName && "2 à 60 caractères"}>
                <Input maxLength={60} {...form.register("displayName")} />
              </Field>
              <Field label="Slogan" error={errors.tagline && "120 caractères maximum"}>
                <Input maxLength={120} placeholder="Facultatif" {...form.register("tagline")} />
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection title="Couleurs" description="La couleur principale habille le bouton principal, la navigation active, le focus et les graphiques.">
            <div className="flex flex-col gap-2">
              <Eyebrow>Palettes</Eyebrow>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {Object.entries(THEME_PRESETS).map(([k, p]) => {
                  const active = theme.primary.toUpperCase() === p.primary && theme.accent.toUpperCase() === p.accent;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => { form.setValue("theme.primary", p.primary, { shouldDirty: true, shouldValidate: true }); form.setValue("theme.accent", p.accent, { shouldDirty: true, shouldValidate: true }); }}
                      className={cn("group flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-brand-ink bg-brand-tint" : "border-border hover:bg-hover")}
                      aria-pressed={active}
                    >
                      <span className="relative flex h-7 w-full overflow-hidden rounded-md ring-1 ring-black/5">
                        <span className="flex-[2]" style={{ background: p.primary }} />
                        <span className="flex-1" style={{ background: p.accent }} />
                        {active && <Check className="absolute inset-0 m-auto size-4 text-white drop-shadow" />}
                      </span>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label="Couleur principale" error={errors.theme?.primary?.message} value={theme.primary} onChange={(v) => form.setValue("theme.primary", v, { shouldDirty: true, shouldValidate: true })} />
              <ColorField label="Couleur d'accent" error={errors.theme?.accent?.message} value={theme.accent} onChange={(v) => form.setValue("theme.accent", v, { shouldDirty: true, shouldValidate: true })} />
            </div>
            {validColors && <ContrastMeter primary={theme.primary} />}
            <AnimatePresence initial={false}>
              {liveWarnings.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <Callout tone="warning" title="Contraste à vérifier">
                    <ul className="list-disc pl-4">{liveWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  </Callout>
                </motion.div>
              )}
            </AnimatePresence>
          </SettingsSection>

          <SettingsSection title="Typographie et formes">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Police">
                <NativeSelect {...form.register("theme.fontFamily")}>
                  {Object.keys(FONT_STACKS).map((f) => <option key={f} value={f}>{FONT_LABEL[f]}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Arrondis">
                <Controller control={form.control} name="theme.radius" render={({ field }) => (
                  <Segmented ariaLabel="Arrondis" size="sm" value={field.value ?? "md"} onChange={field.onChange} className="sm:w-full"
                    options={Object.keys(RADIUS_LABEL).map((r) => ({ value: r as Theme["radius"], label: RADIUS_LABEL[r] }))} />
                )} />
              </Field>
              <Field label="Mode par défaut" hint="Chaque utilisateur peut ensuite choisir le sien.">
                <Controller control={form.control} name="theme.mode" render={({ field }) => (
                  <Segmented ariaLabel="Mode par défaut" size="sm" value={field.value ?? "system"} onChange={field.onChange} className="sm:w-full"
                    options={[{ value: "system", label: "Auto", icon: <Monitor /> }, { value: "light", label: "Clair", icon: <Sun /> }, { value: "dark", label: "Sombre", icon: <Moon /> }]} />
                )} />
              </Field>
            </div>
            <div className="divide-y divide-border">
              <Controller control={form.control} name="theme.kitchenDark" render={({ field }) => (
                <SwitchRow label="Écran cuisine toujours sombre" description="Recommandé : meilleure lisibilité et moins d'éblouissement en cuisine." checked={!!field.value} onCheckedChange={field.onChange} />
              )} />
            </div>
          </SettingsSection>

          <SettingsSection title="Logos et favicon" description="Le format est revérifié par le serveur (signature du fichier). SVG refusé.">
            <div className="grid gap-4 md:grid-cols-2">
              <Dropzone kind="logo" label="Logo (fond clair)" currentUrl={assets.logo} disabled={!adapter.canWrite || !adapter.uploadAsset} onUpload={(f) => upload("logo", f)} onRemove={() => remove("logo")} />
              <Dropzone kind="logoDark" label="Logo (fond sombre)" previewTone="dark" currentUrl={assets.logoDark} disabled={!adapter.canWrite || !adapter.uploadAsset} onUpload={(f) => upload("logoDark", f)} onRemove={() => remove("logoDark")} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Dropzone kind="favicon" label="Favicon" currentUrl={assets.favicon} disabled={!adapter.canWrite || !adapter.uploadAsset} onUpload={(f) => upload("favicon", f)} onRemove={() => remove("favicon")} />
              <FaviconTab name={preview.displayName} url={assets.favicon} />
            </div>
          </SettingsSection>
        </fieldset>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <LivePreview {...preview} contextLabel={contextLabel} apiWarnings={query.data?.preview?.warnings ?? []} dirty={form.formState.isDirty} />
        </div>
      </div>
      <SaveBar dirty={form.formState.isDirty} saving={save.isPending} onReset={() => form.reset()} onSave={() => void submit()} canWrite={adapter.canWrite} />
    </form>
  );
}

function ColorField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  const id = React.useId();
  return (
    <Field label={label} error={error} hint="Format #RRGGBB">
      <div className="flex items-center gap-2" id={id}>
        <label className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border shadow-xs sm:size-9" style={{ background: HEX_COLOR.test(value) ? value : "transparent" }}>
          <span className="sr-only">Choisir la couleur</span>
          <input type="color" value={HEX_COLOR.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </label>
        <Input
          value={text}
          maxLength={7}
          spellCheck={false}
          className="font-mono uppercase"
          onChange={(e) => {
            let v = e.target.value.trim();
            if (v && !v.startsWith("#")) v = `#${v}`;
            setText(v);
            onChange(v.toUpperCase());
          }}
        />
      </div>
    </Field>
  );
}

/** Contraste du texte sur la couleur principale (calculé comme l'API : blanc ou quasi-noir). */
function ContrastMeter({ primary }: { primary: string }) {
  const vars = themeToCssVars({ ...DEFAULT_THEME, primary });
  const on = vars["--color-on-primary"]!;
  const ratio = contrastRatio(primary, on);
  const level = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA (grands textes)" : "Insuffisant";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="flex h-8 items-center rounded-md px-3 text-sm font-medium" style={{ background: primary, color: on }}>Aa</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px]">Texte {on === "#FFFFFF" ? "blanc" : "sombre"} sur la couleur principale</span>
        <span className="font-mono text-xs text-muted-foreground">Contraste {ratio.toFixed(2).replace(".", ",")} : 1</span>
      </div>
      <Badge tone={ratio >= 4.5 ? "green" : ratio >= 3 ? "amber" : "red"}>{level}</Badge>
    </div>
  );
}

function FaviconTab({ name, url }: { name: string; url?: string | null }) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [url]);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">Aperçu dans le navigateur</span>
      <div className="flex min-h-[132px] flex-col justify-center gap-0 overflow-hidden rounded-lg border border-border bg-muted p-3">
        <div className="flex items-end gap-1">
          <div className="flex h-9 max-w-[220px] flex-1 items-center gap-2 rounded-t-lg bg-background px-3 shadow-xs">
            {url && !broken ? <img src={url} alt="" className="size-4" onError={() => setBroken(true)} /> : <span className="size-4 rounded-sm bg-brand" />}
            <span className="truncate text-xs">{name}</span>
            <X className="ml-auto size-3 text-muted-foreground" />
          </div>
          <div className="hidden h-8 items-center whitespace-nowrap rounded-t-lg px-3 text-xs text-muted-foreground sm:flex">Nouvel onglet</div>
        </div>
        <div className="h-8 rounded-b-md rounded-tr-md bg-background px-3 py-2 font-mono text-[11px] text-muted-foreground">https://…</div>
      </div>
    </div>
  );
}

/** Aperçu en direct : mini page de connexion + barre de navigation, en clair ET en sombre. */
function LivePreview({ displayName, tagline, theme, assets, contextLabel, apiWarnings, dirty }: {
  displayName: string; tagline?: string; theme: Theme; assets: Assets; contextLabel: string; apiWarnings: string[]; dirty: boolean;
}) {
  const valid = HEX_COLOR.test(theme.primary) && HEX_COLOR.test(theme.accent);
  const vars = valid ? deriveBrandVars(themeToCssVars(theme)) : {};
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label="Aperçu en direct">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--tone-green-dot)] opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-[var(--tone-green-dot)]" />
          </span>
          <h3 className="text-sm font-semibold">Aperçu en direct</h3>
        </div>
        {dirty && <Badge tone="amber">Non enregistré</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {(["light", "dark"] as const).map((mode) => (
          <PreviewPane key={mode} mode={mode} vars={vars} displayName={displayName} tagline={tagline} logo={mode === "dark" ? assets.logoDark ?? assets.logo : assets.logo} contextLabel={contextLabel} />
        ))}
      </div>
      {apiWarnings.length > 0 && !dirty && (
        <p className="flex items-start gap-2 text-xs text-[var(--tone-amber-fg)]"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Thème enregistré : {apiWarnings.join(" ")}</p>
      )}
    </section>
  );
}

function PreviewPane({ mode, vars, displayName, tagline, logo, contextLabel }: {
  mode: "light" | "dark"; vars: Record<string, string>; displayName: string; tagline?: string; logo?: string | null; contextLabel: string;
}) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [logo]);
  return (
    <div
      className={cn(mode, "overflow-hidden rounded-lg border border-border bg-background text-foreground")}
      style={vars as React.CSSProperties}
      aria-label={mode === "dark" ? "Aperçu en mode sombre" : "Aperçu en mode clair"}
    >
      <div className="flex items-center justify-between border-b border-border bg-subtle px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          {logo && !broken ? (
            <img src={logo} alt="" className="h-5 max-w-[96px] object-contain" onError={() => setBroken(true)} />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-[calc(var(--radius)*0.6)] bg-brand text-[10px] font-semibold text-brand-foreground">{displayName[0]?.toUpperCase()}</span>
          )}
          <span className="truncate font-brand text-xs font-semibold">{displayName}</span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{mode === "dark" ? "Sombre" : "Clair"}</span>
      </div>
      <div className="flex">
        <div className="hidden w-[38%] flex-col gap-1 border-r border-border bg-subtle p-2 sm:flex xl:hidden 2xl:flex">
          {[{ i: <LayoutDashboard className="size-3" />, l: "Accueil", a: true }, { i: <ChefHat className="size-3" />, l: "Cuisine" }, { i: <Settings className="size-3" />, l: "Réglages" }].map((n) => (
            <span key={n.l} className={cn("relative flex items-center gap-1.5 rounded-[calc(var(--radius)*0.6)] px-2 py-1 text-[11px]", n.a ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground")}>
              {n.a && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand" />}
              <span className={n.a ? "text-brand-ink" : ""}>{n.i}</span>{n.l}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-brand text-sm font-semibold tracking-tight">Connexion</span>
            <span className="truncate text-[11px] text-muted-foreground">{tagline || contextLabel}</span>
          </div>
          <span className="flex h-7 items-center rounded-[var(--radius)] border border-input bg-background px-2 text-[11px] text-faint">vous@exemple.com</span>
          <span className="flex h-7 items-center rounded-[var(--radius)] border border-brand-ink bg-background px-2 text-[11px] ring-2 ring-ring/50"><Lock className="mr-1 size-3 text-muted-foreground" />••••••••</span>
          <span className="flex h-7 items-center justify-center rounded-[var(--radius)] bg-brand text-[11px] font-medium text-brand-foreground shadow-xs">Se connecter</span>
          <div className="flex items-center gap-1.5">
            <span className="flex h-6 flex-1 items-center justify-center rounded-[var(--radius)] border border-border text-[10px]">Annuler</span>
            <span className="flex h-6 flex-1 items-center justify-center rounded-[var(--radius)] text-[10px] font-medium" style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}>Accent</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge tone="blue" dot className="h-5 px-2 text-[10px]">Essai</Badge>
            <Badge tone="green" dot className="h-5 px-2 text-[10px]">Actif</Badge>
            <Badge tone="amber" dot className="h-5 px-2 text-[10px]">Grâce</Badge>
            <Badge tone="brand" className="h-5 px-2 text-[10px]">Marque</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
