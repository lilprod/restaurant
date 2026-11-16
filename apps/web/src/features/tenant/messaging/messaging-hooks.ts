import { useQuery } from "@tanstack/react-query";
import { totalUnread } from "@/lib/realtime/messaging-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";

/** Mes canaux avec non-lus (le temps réel les met à jour en place). */
export function useChannels() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.chatChannels(t.root), queryFn: () => t.api.messaging.channels(), staleTime: 60_000, enabled: !t.isDriver });
}

/** Total de non-lus, pour la pastille de la navigation. */
export function useUnreadCount() {
  const q = useChannels();
  return totalUnread(q.data);
}
