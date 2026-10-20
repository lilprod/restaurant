# Guide backend — ajouter un module à l'API

Modèle à imiter : la phase 1 (`apps/api/src/restaurant/`). Lisez au moins `orders.service.ts` (verrou, recalcul, diffusion temps réel),
`menu.service.ts` (CRUD, relations remplacées en bloc, fichiers), `tables.service.ts`, `restaurant.controllers.ts`, `restaurant.module.ts`
et le test `apps/api/test/restaurant.e2e-spec.ts`.

## Étapes

### 1. Schéma de données (`apps/api/prisma/schema.prisma`)
- Beaucoup de modèles existent déjà (réservations, stock, personnel, livraison, avis, messagerie…) : **partez de l'existant**, complétez-le plutôt que de le dupliquer.
- Toute table métier : `tenantId String` + relation `tenant Tenant @relation(... onDelete: Cascade)` + `@@index([tenantId])` ;
  ajoutez le champ de relation inverse dans `model Tenant`.
- Unicités **par restaurant** : `@@unique([tenantId, …])`, jamais globales.
- Montants : `Int` (FCFA). Quantités de stock : `Decimal @db.Decimal(12, 3)`. Taux : `Decimal @db.Decimal(4, 2)`.
- Horodatages utiles à l'audit et à l'interface (`createdAt`, `updatedAt`, `cancelledAt`…). Préférez l'archivage (`archivedAt`) à la suppression dès qu'un historique y fait référence.
- Commentaires Prisma : `//` uniquement (`/** */` est refusé par Prisma).

### 2. Migration
```bash
cd apps/api
DATABASE_URL=postgresql://app:app@localhost:5433/restaurant npx prisma migrate dev --name <domaine_quoi>
DATABASE_URL=x npx prisma generate
```
- Une colonne obligatoire ajoutée à une table non vide doit avoir une valeur par défaut.
- Données de référence (comme les 14 allergènes) : `INSERT … ON CONFLICT DO NOTHING` à la fin du `migration.sql`, et restaurez-les dans `test/helpers.ts` si la remise à zéro des tests les efface.
- **Nouvelle table métier → `prisma/sql/rls.sql`** : ajoutez le bloc `ENABLE/FORCE ROW LEVEL SECURITY` + politique `tenant_isolation` (copiez un bloc existant).
- Ne modifiez jamais une migration déjà appliquée/poussée : créez-en une nouvelle.

### 3. Validation partagée (`packages/validation/src/<domaine>.ts`)
- Un schéma Zod par corps de requête et par requête de liste ; exportez les types `z.infer`. Exportez le fichier depuis `src/index.ts`.
- Messages explicites en français pour les règles métier (`refine(…, { message, path })`) ; les messages génériques sont traduits automatiquement.
- Rebâtissez : `pnpm --filter @restaurant/validation build` (l'API lit `dist/`).
- Logique pure réutilisable par le web (calculs, disponibilités, transitions d'état) → `packages/utils/src/<domaine>.ts` + tests unitaires (dans `apps/api/src/**/*.spec.ts`, comme `src/orders/pricing.spec.ts`).

### 4. Service
- Injectez `PrismaService` ; **chaque** accès aux tables métier dans `this.prisma.asTenant(tenantId, async (tx) => …)`.
- Opérations concurrentes sur une même ressource (argent, stock, créneau) : verrou de ligne
  `await tx.$queryRaw\`SELECT id FROM "Table" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE\`` ou verrou consultatif
  `pg_advisory_xact_lock(hashtext(...))` (voir `register.service.ts`). Testez le cas « deux requêtes simultanées ».
- Réglages du restaurant : `TenantSettingsService` (`getSection("operations", tenant)`…). Nouvelle section de réglages → ajoutez-la au moteur
  (`settings/tenant-settings.service.ts`, schéma dans `packages/validation/src/settings.ts`, défauts dans `settings/defaults.ts`).
- Limites du plan : `PlanLimitsService.assertCanAdd(...)` (ajoutez un type de limite si besoin, champ dans `Plan` + `features`).
- Fonctionnalités par plan : `plan.features` (JSON) ; si un module est réservé à certains plans, refusez avec `403 {code: "PLAN_FEATURE"}` et documentez-le.
- Fichiers : `StorageService` + `validateImage` (ajoutez une règle dans `storage/image-validation.ts`).
- Audit : `tx.auditLog.create({ data: { tenantId, userId, action: "domaine.action", entity, entityId, metadata } })`.
- Emails / SMS : passez par le service de notifications (fiche X1) ; tant qu'il n'existe pas, `MailService` (journalise).
- Fuseau horaire : `zonedDayRange`, `zonedDay`, `zonedHour` de `@restaurant/utils` avec `tenant.timezone` ; le serveur raisonne en UTC.

### 5. Contrôleur
```ts
@ApiTags("Restaurant · Réservations")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)                      // défaut du contrôleur
@Controller("tenant/reservations")
export class ReservationsController {
  @Post() @TenantRoles(...FLOOR)            // restriction par route
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(createReservationSchema)) body: CreateReservationInput) { … }
}
```
- Préfixe : `tenant/<domaine>` (restaurant), `platform/<domaine>` (SuperAdmin), `public/...` (sans authentification, avec limitation de débit `@Throttle`).
- `ParseUUIDPipe` sur tous les identifiants ; `@HttpCode(200)` sur les `POST` d'action qui ne créent rien.
- Le tenant vient toujours de `@CurrentAccount()`.

### 6. Temps réel (si l'écran doit se mettre à jour seul)
- `RealtimeService.emit(tenantId, "<domaine>.<événement>", payload)` **après** la transaction (voir `OrdersService.mutate`).
- Charge utile = la même forme que la réponse de l'API (fonction `xxxView`), pour que le web mette ses caches à jour sans recharger.
- Documentez l'événement dans `docs/API.md` et prévenez le web (`apps/web/src/lib/realtime`).

### 7. Module
`src/<domaine>/<domaine>.module.ts` (imports : `TenantModule` pour la garde) → ajouté à `imports` de `app.module.ts`.
Réutilisez les services globaux (Prisma, Settings, Security, Storage, Mail) sans les réimporter.

### 8. Client typé et documentation
- Types de réponse + endpoints dans `packages/api-client/src/types.ts` et `endpoints.ts` (même style que l'existant).
- Section dans `docs/API.md` : routes, rôles, règles, erreurs, événements temps réel.

## Tests attendus

- **Unitaires** (logique pure) : `apps/api/src/<domaine>/*.spec.ts`.
- **e2e** : `apps/api/test/<domaine>.e2e-spec.ts` en suivant `restaurant.e2e-spec.ts` :
  `resetDb` + `seedPlatform` + `createApp`, restaurant créé via l'API SuperAdmin, comptes par rôle.
  Couvrez : parcours nominal, **chaque rôle autorisé et interdit**, validation (400 avec `errors[]`), conflits (409), concurrence si pertinente,
  **isolation** (un autre restaurant reçoit 404 / liste vide / aucun événement temps réel).
- **Sous RLS** : rejouez vos tests avec `TEST_DATABASE_URL=postgresql://app_rls:rls@…` (après `GRANT` + `rls.sql`). Un test qui lit la base
  directement doit passer par `asPlatform(prisma, tx => …)` de `test/helpers.ts`.
- Pas de `sleep` arbitraire pour attendre un état : attendez l'événement ou la réponse.

## Erreurs fréquentes déjà rencontrées
- Oublier `asTenant` → tout marche en superuser mais renvoie des listes vides sous RLS. D'où l'exécution sous RLS.
- `deepMerge(defaults, null)` renvoie `null` : lire un réglage absent avec `?? undefined`.
- Un `include` vers une table d'un autre domaine (ex. `User`) doit lui aussi être dans le contexte du restaurant.
- Les relations « remplacées en bloc » (options d'un plat) déjà référencées par l'historique doivent être archivées, pas supprimées.
