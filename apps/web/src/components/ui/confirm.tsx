import * as React from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { Input, Textarea } from "./input";

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Demande un motif (obligatoire, min. `reasonMin` caractères). */
  reason?: { label: string; placeholder?: string; min?: number };
  /** Exige de retaper un mot (ex. le slug) pour confirmer. */
  typeToConfirm?: string;
  /** Action asynchrone : la boîte reste ouverte et affiche un chargement jusqu'à la fin. */
  onConfirm: (reason?: string) => Promise<unknown> | unknown;
}

const ConfirmCtx = React.createContext<(o: ConfirmOptions) => void>(() => undefined);

/** Toutes les actions destructrices passent par cette confirmation. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [typed, setTyped] = React.useState("");

  const confirm = React.useCallback((o: ConfirmOptions) => {
    setOpts(o); setReason(""); setTyped(""); setBusy(false); setOpen(true);
  }, []);

  const min = opts?.reason?.min ?? 3;
  const reasonOk = !opts?.reason || reason.trim().length >= min;
  const typedOk = !opts?.typeToConfirm || typed.trim() === opts.typeToConfirm;

  async function run() {
    if (!opts || !reasonOk || !typedOk) return;
    setBusy(true);
    try {
      await opts.onConfirm(opts.reason ? reason.trim() : undefined);
      setOpen(false);
    } catch {
      /* l'appelant affiche l'erreur (toast) ; on laisse la boîte ouverte pour corriger */
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o) => { if (!busy) setOpen(o); }}
        title={opts?.title ?? ""}
        description={opts?.description}
        size="sm"
        dismissable={!busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{opts?.cancelLabel ?? "Annuler"}</Button>
            <Button
              variant={opts?.tone === "primary" ? "primary" : "danger"}
              onClick={run}
              loading={busy}
              disabled={!reasonOk || !typedOk}
            >
              {opts?.confirmLabel ?? "Confirmer"}
            </Button>
          </>
        }
      >
        {(opts?.reason || opts?.typeToConfirm) && (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void run(); }}>
            {opts.reason && (
              <Field label={opts.reason.label} hint={`${min} caractères minimum`} required>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={opts.reason.placeholder} autoFocus maxLength={300} />
              </Field>
            )}
            {opts.typeToConfirm && (
              <Field label={<>Tapez <span className="font-mono">{opts.typeToConfirm}</span> pour confirmer</>}>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
              </Field>
            )}
          </form>
        )}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => React.useContext(ConfirmCtx);
