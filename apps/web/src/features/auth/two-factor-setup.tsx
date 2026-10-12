import type { TwoFactorSetup } from "@restaurant/api-client";
import { Check, Download, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CopyField, copyText } from "@/components/ui/copy-button";
import { OtpInput } from "@/components/ui/otp-input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { downloadText } from "@/lib/files";
import { errorMessage, toastError } from "@/lib/errors";
import { useSession } from "@/providers/session";

const STEPS = ["Scanner", "Confirmer", "Codes de secours"];

/**
 * Assistant d'activation de la 2FA : QR code (ou secret à saisir), confirmation par un premier code,
 * puis affichage unique des 8 codes de secours (copier / télécharger / « je les ai enregistrés »).
 */
export function TwoFactorSetupFlow({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { account, user } = useSession();
  const [step, setStep] = React.useState(0);
  const [setup, setSetup] = React.useState<TwoFactorSetup | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [codes, setCodes] = React.useState<string[]>([]);
  const [saved, setSaved] = React.useState(false);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    account.setup2fa().then(setSetup).catch((e) => { toastError(e); onCancel?.(); });
  }, [account, onCancel]);

  async function confirm(value: string) {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await account.enable2fa(value);
      setCodes(r.recoveryCodes);
      setStep(2);
    } catch (e) {
      setError(errorMessage(e));
      setCode("");
    } finally { setBusy(false); }
  }

  const secretGroups = setup?.secret.match(/.{1,4}/g)?.join(" ") ?? "";
  const fileText = `Codes de secours — ${user?.email ?? ""}\nGénérés le ${new Date().toLocaleString("fr-FR")}\nChaque code ne peut servir qu'une fois.\n\n${codes.join("\n")}\n`;

  return (
    <div className="flex flex-col gap-6">
      {/* Indicateur d'étapes */}
      <ol className="flex items-center gap-2" aria-label="Étapes">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-2" aria-current={i === step ? "step" : undefined}>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full rounded-full bg-brand" initial={false} animate={{ width: i <= step ? "100%" : "0%" }} transition={{ duration: 0.25 }} />
            </div>
            <span className={cn("text-[12px] font-medium", i <= step ? "text-foreground" : "text-muted-foreground")}>{i + 1}. {s}</span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        {step === 0 && (
          <motion.div key="s0" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }} className="flex flex-col gap-5">
            <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <Smartphone className="mt-0.5 size-4 shrink-0" />
              Scannez ce QR code avec Google Authenticator, Microsoft Authenticator, 1Password ou une application compatible.
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="flex size-[188px] shrink-0 items-center justify-center rounded-lg border border-border bg-white p-2 shadow-sm">
                {setup ? <img src={setup.qrDataUrl} alt="QR code de configuration de la double authentification" className="size-full" /> : <Skeleton className="size-full" />}
              </div>
              <div className="flex w-full min-w-0 flex-col gap-2">
                <span className="text-[13px] font-medium">Impossible de scanner ?</span>
                <span className="text-[13px] text-muted-foreground">Saisissez cette clé manuellement (type : basé sur le temps).</span>
                {setup ? <CopyField value={secretGroups} /> : <Skeleton className="h-10 w-full" />}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              {onCancel ? <Button variant="ghost" onClick={onCancel}>Annuler</Button> : <span />}
              <Button variant="primary" disabled={!setup} onClick={() => setStep(1)}><QrCode /> J'ai scanné le code</Button>
            </div>
          </motion.div>
        )}

        {step === 1 && (
          <motion.form
            key="s1"
            onSubmit={(e) => { e.preventDefault(); void confirm(code); }}
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}
            className="flex flex-col gap-5"
          >
            <p className="text-sm text-muted-foreground">Saisissez le code à 6 chiffres affiché par l'application pour confirmer.</p>
            <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => void confirm(v)} autoFocus invalid={!!error} disabled={busy} />
            {error && <p role="alert" className="text-center text-[13px] text-danger">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>Retour</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}><ShieldCheck /> Activer</Button>
            </div>
          </motion.form>
        )}

        {step === 2 && (
          <motion.div key="s2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }} className="flex flex-col gap-5">
            <Callout tone="warning" title="Enregistrez ces codes maintenant">
              Ils ne seront plus jamais affichés. Chacun permet une connexion si vous perdez votre téléphone.
            </Callout>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-subtle p-3">
              {codes.map((c, i) => (
                <motion.li
                  key={c}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.16 }}
                  className="rounded-md bg-background px-2 py-2 text-center font-mono text-[13px] tracking-wider shadow-xs ring-1 ring-border sm:text-sm"
                >
                  {c}
                </motion.li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" className="flex-1" onClick={async () => { if (await copyText(codes.join("\n"))) toast.success("Codes copiés"); }}>
                <CopyIcon /> Tout copier
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => downloadText("codes-de-secours.txt", fileText)}>
                <Download /> Télécharger (.txt)
              </Button>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-hover">
              <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              J'ai enregistré mes codes de secours en lieu sûr
            </label>
            <Button variant="primary" size="lg" disabled={!saved} onClick={onDone}><Check /> Terminer</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>;
}

