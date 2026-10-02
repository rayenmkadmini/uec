# UE Clubiste — SUPERADMIN / ADMIN / TREASURER

- **SUPERADMIN** : accès complet et modification de toute la plateforme.
- **ADMIN (Supervisor)** : accès lecture seule à l'administration.
- **TREASURER** : membres + paiement carte + cotisations, avec modification limitée aux statuts de paiement.
- **SUBSCRIBER** : choix de place dans le stade + modification téléphone/email/adresse/photo.

Le SUPERADMIN est le seul rôle qui peut gérer les comptes administrateurs, importer/créer/modifier/supprimer des membres, créer/modifier/supprimer des événements, gérer matchs/référentiels et modifier les permissions.

## Import membres CSV
Le SUPERADMIN peut importer jusqu'à 500 lignes par opération. Les membres existants sont conservés et mis à jour par CIN puis numéro d'abonnement ; les nouveaux sont ajoutés. Aucun `delete`/`truncate` n'est exécuté par l'import.
