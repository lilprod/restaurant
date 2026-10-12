import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CopyField } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";

/** Mot de passe temporaire : affiché une seule fois, à transmettre en main propre. */
export function TempPasswordDialog({ value, who, onClose }: { value: string | null; who?: string; onClose: () => void }) {
  return (
    <Dialog
      open={!!value}
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="sm"
      title="Mot de passe temporaire"
      description={who ? `À transmettre à ${who}.` : undefined}
      dismissable={false}
      footer={<Button variant="primary" onClick={onClose}>J'ai transmis le mot de passe</Button>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-center py-1">
          <span className="flex size-11 items-center justify-center rounded-full border border-border bg-subtle"><KeyRound className="size-5 text-muted-foreground" /></span>
        </div>
        {value && <CopyField value={value} className="text-base" />}
        <Callout tone="warning">
          Il ne sera plus jamais affiché. L'utilisateur devra le remplacer à sa prochaine connexion ; ses sessions ouvertes ont été fermées.
        </Callout>
      </div>
    </Dialog>
  );
}
