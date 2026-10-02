# UE Clubiste — Roles + permissions finales

## SUPERADMIN
Accès complet :
- membres : ajout, modification, suppression, activation/désactivation, reset mot de passe ;
- import CSV cumulatif ;
- carte membre : payé/non payé ;
- événements : ajout, modification, suppression ;
- cotisations : consultation et modification ;
- matchs, zones, facultés et comptes administrateurs ;
- gestion des rôles et du statut Trésorier.

## ADMIN / SUPERVISOR
Lecture seule :
- voit les membres, cartes, facultés, zones, matchs, événements, cotisations et administrateurs ;
- aucune action de création, modification, suppression, import ou paiement.

## TREASURER
Accès limité à la trésorerie :
- voit la liste des membres ;
- peut marquer la carte membre payée/non payée ;
- voit les événements et la liste des cotisations ;
- peut marquer un membre payé/non payé pour une cotisation ;
- ne peut pas créer/modifier/supprimer un événement ;
- ne peut pas modifier les informations d'un membre.

## MEMBER / SUBSCRIBER
- choisit/modifie sa place dans le stade pour les matchs disponibles ;
- peut modifier ses informations de contact : téléphone, email, adresse ;
- peut remplacer sa photo ;
- peut changer son mot de passe ;
- ne peut pas modifier nom, prénom, CIN, N° abonnement, sexe, faculté, zone ou statut.

## Import CSV
Le bouton **Importer CSV** est réservé au SUPERADMIN.
Chaque import conserve les anciens membres. Les lignes existantes sont mises à jour (CIN puis N° abonnement) et les nouvelles lignes sont ajoutées. Réimporter le même fichier ne crée pas de doublons.

Format recommandé : `mail,Nom,prenom,numero d'abonnement,CIN,sexe,Téléphone,address,FACULTÉ,zone`.

### SQL à exécuter
1. `schema.sql`
2. `security_hardening.sql`
3. `roles_migration.sql`
4. `payments.sql`
5. `permissions_v2.sql`
6. `subscriber_photos.sql`

Puis déployer les Edge Functions, notamment `admin-import-users`.
