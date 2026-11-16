import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { saveBlob } from "@/lib/download";
import { toastError } from "@/lib/errors";

/** Bouton qui télécharge un fichier servi par l'API (CSV, PDF) avec la session, puis l'enregistre. */
export function DownloadButton({ fetchFile, children, ...props }: { fetchFile: () => Promise<{ blob: Blob; filename: string }> } & Omit<ButtonProps, "onClick" | "loading">) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button {...props} loading={busy} onClick={async () => {
      setBusy(true);
      try { saveBlob(await fetchFile()); } catch (e) { toastError(e, "Téléchargement impossible"); } finally { setBusy(false); }
    }}>{children}</Button>
  );
}
