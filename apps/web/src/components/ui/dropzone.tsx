import { ImageUp, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { precheckFile, UPLOAD_RULES, type UploadKind } from "@/lib/files";
import { Button } from "./button";
import { Spinner } from "./spinner";

interface DropzoneProps {
  kind: UploadKind;
  label: string;
  currentUrl?: string | null;
  onUpload: (file: File) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  disabled?: boolean;
  /** Fond de l'aperçu (logo sombre → fond sombre). */
  previewTone?: "light" | "dark";
  /** `cover` : photo affichée en grand (plats) ; `contain` : logo centré (par défaut). */
  previewFit?: "contain" | "cover";
  className?: string;
}

/** Envoi d'image par glisser-déposer ou parcourir, avec pré-vérification locale (type, taille, SVG refusé). */
export function Dropzone({ kind, label, currentUrl, onUpload, onRemove, disabled, previewTone = "light", previewFit = "contain", className }: DropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [localPreview, setLocalPreview] = React.useState<string | null>(null);
  const [broken, setBroken] = React.useState(false);
  const rule = UPLOAD_RULES[kind];

  React.useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);
  React.useEffect(() => setBroken(false), [currentUrl]);

  async function handle(file: File | undefined) {
    if (!file || disabled) return;
    const err = precheckFile(file, kind);
    setError(err);
    if (err) return;
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    setBusy(true);
    try {
      await onUpload(file);
      setLocalPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi");
      setLocalPreview(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const shown = localPreview ?? (currentUrl && !broken ? currentUrl : null);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        {currentUrl && onRemove && !disabled && (
          <Button size="sm" variant="ghost" className="-mr-2 h-8 text-muted-foreground" onClick={async () => { setBusy(true); try { await onRemove(); } finally { setBusy(false); } }}>
            <Trash2 /> Retirer
          </Button>
        )}
      </div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={`${label} : déposer un fichier ou parcourir`}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void handle(e.dataTransfer.files[0]); }}
        className={cn(
          "group relative flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-border-strong p-4 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          over ? "border-brand-ink bg-brand-tint" : "hover:bg-hover",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {shown ? (
            <motion.div key={shown} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
              className={cn("flex w-full items-center justify-center overflow-hidden rounded-md", previewFit === "cover" ? "h-36" : "h-20",
                previewTone === "dark" ? "bg-[#0a0a0a]" : "bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]")}
            >
              <img src={shown} alt="" onError={() => setBroken(true)} className={cn(previewFit === "cover" ? "size-full object-cover" : "max-h-16 max-w-[80%] object-contain", kind === "favicon" && "size-10")} />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-full border border-border bg-background shadow-xs">
                <ImageUp className="size-4 text-muted-foreground" />
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Glissez un fichier</span> ou cliquez pour parcourir
        </p>
        <p className="text-xs text-faint">{rule.label}</p>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
            <Spinner className="size-5" />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={[...rule.types, ...rule.extensions.map((e) => `.${e}`)].join(",")}
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </div>
      <AnimatePresence>
        {error && (
          <motion.p role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-[12.5px] text-danger">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
