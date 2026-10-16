# UE Clubiste — Module Matchs

## Fichiers ajoutés
- matchs.html : espace abonné / choix de place
- js/matchs.js : calendrier + choix de zone
- admin-matchs.html : gestion admin des matchs + statistiques
- js/admin-matchs.js : CRUD matchs + statistiques
- Base de données : tables, zones, RLS et règle Femme/Virages, uniquement via `supabase/migrations/`

## Fichiers mis à jour
- subscribers.html
- js/subscribers.js
- subscriber.html
- js/subscriber.js
- dashboard.html
- css/style.css
- supabase/functions/admin-create-user/index.ts

## Installation (historique)

> **Historique.** L'ancien script `supabase/matchs.sql` (supprimé le 2026-10-16)
> recréait d'anciennes règles d'accès. Les changements de schéma passent
> uniquement par `supabase/migrations/` (revus, avec rollback) et un
> environnement de staging.

1. Appliquer les migrations de `supabase/migrations/` (voir `docs/security/DEPLOYMENT_PLAN.md`).
2. Vérifier `js/config.js` avec l'URL et la clé publishable/anon du projet.
3. Pour chaque abonné, le SUPERADMIN doit choisir Sexe = Homme ou Femme.
4. Les femmes ne voient jamais Virage 1 et Virage 2 dans `matchs.html`.
5. La base de données bloque aussi un choix Femme -> VIRAGE_1/VIRAGE_2.
6. Les Edge Functions se déploient depuis `supabase/functions/` (voir le plan de déploiement).

## Navigation
Admin : Dashboard > Matchs
Abonné : Mon profil > Matchs

Aucun paiement, prix ou checkout n'est utilisé.
