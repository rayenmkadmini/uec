# Import membres CSV — UE Clubiste

Colonnes reconnues (l'ordre n'est pas obligatoire). Les CSV séparés par `,` ou `;` sont acceptés :

`mail, Nom, prenom, numero d'abonnement, CIN, sexe, Téléphone, address, FACULTÉ, zone`

## Règle d'import
- Les anciens membres ne sont **jamais supprimés**.
- Un membre existant est retrouvé d'abord par **CIN**, puis par **N° abonnement**.
- S'il existe : ses informations du fichier sont mises à jour, son compte et son statut de paiement sont conservés.
- S'il n'existe pas : un nouveau compte est créé.
- Login automatique d'un nouveau membre : **NOMPRENOM en MAJUSCULES**. En cas de doublon de nom, un suffixe numérique est ajouté uniquement pour garantir l'unicité.
- Mot de passe initial d'un nouveau membre : **CIN**, puis changement obligatoire à la première connexion.
- Faculté/zone absentes sont créées automatiquement par l'import SUPERADMIN.
- Réimporter le même fichier ne crée donc pas de doublons.

## Exemple
```csv
mail,Nom,prenom,numero d'abonnement,CIN,sexe,Téléphone,address,FACULTÉ,zone
membre@example.com,DOE,Jean,10001,12345678,M,22123456,1 Rue Exemple,FSEG,Tunis
```

Maximum : 500 lignes par import.
