import type { AssetKind } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, toastError } from "@/lib/errors";

/**
 * Accès aux réglages d'un espace. Le même formulaire sert pour la plateforme (/platform/settings),
 * le restaurant (/tenant/settings) et le support SuperAdmin (/platform/tenants/:id/settings).
 */
export interface SettingsAdapter {
  key: readonly unknown[];
  get: (section: string) => Promise<unknown>;
  update: (section: string, body: unknown) => Promise<unknown>;
  uploadAsset?: (kind: AssetKind, file: File) => Promise<{ url: string }>;
  removeAsset?: (kind: AssetKind) => Promise<void>;
  canWrite: boolean;
  /** Invalidation complémentaire après enregistrement (ex. marque publique appliquée à l'interface). */
  onSaved?: (section: string) => void;
}

export function useSection<T>(adapter: SettingsAdapter, section: string) {
  return useQuery({ queryKey: [...adapter.key, section], queryFn: () => adapter.get(section) as Promise<T> });
}

export function useSaveSection<T>(adapter: SettingsAdapter, section: string, successMessage = "Modifications enregistrées") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => adapter.update(section, body) as Promise<T>,
    onSuccess: (data) => {
      qc.setQueryData([...adapter.key, section], data);
      adapter.onSaved?.(section);
      toast.success(successMessage);
    },
    onError: (e) => toastError(e),
  });
}

/** Barre d'enregistrement collante, visible dès qu'un formulaire a des modifications. */
export function SaveBar({ dirty, saving, onReset, onSave, canWrite }: { dirty: boolean; saving: boolean; onReset: () => void; onSave: () => void; canWrite: boolean }) {
  return (
    <AnimatePresence>
      {dirty && canWrite && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.18 }}
          className="sticky bottom-3 z-20 mt-6 flex items-center justify-between gap-3 rounded-xl border border-border bg-popover/95 px-4 py-3 shadow-lg backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          role="region"
          aria-label="Modifications non enregistrées"
        >
          <span className="text-sm text-muted-foreground"><span className="mr-2 inline-block size-1.5 rounded-full bg-[var(--tone-amber-dot)] align-middle" />Modifications non enregistrées</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>Annuler</Button>
            <Button variant="primary" size="sm" onClick={onSave} loading={saving}>Enregistrer</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ReadOnlyNotice({ children = "Lecture seule : seul un administrateur peut modifier ces réglages." }: { children?: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-subtle px-4 py-2.5 text-[13px] text-muted-foreground">
      <Lock className="size-3.5" /> {children}
    </p>
  );
}

export function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-6" aria-busy="true">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
    </div>
  );
}

export function SectionError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-10 text-center">
      <p className="text-sm">{errorMessage(error)}</p>
      <Button variant="secondary" size="sm" onClick={retry}><RefreshCw /> Réessayer</Button>
    </div>
  );
}

/** Grille de champs : 1 colonne sur mobile, 2 au-delà. */
export function FieldGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={cols === 3 ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>{children}</div>;
}
