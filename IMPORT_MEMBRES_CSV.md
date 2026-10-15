# Import membres CSV — UE Clubiste

Réservé au **SUPERADMIN**. Les CSV séparés par `,` ou `;` sont acceptés (UTF-8, avec
ou sans BOM). L'ordre des colonnes n'est pas obligatoire.

## Colonnes reconnues

| Champ | Obligatoire | En-têtes acceptés (accents, casse et ponctuation ignorés) |
|---|---|---|
| Nom | oui | Nom, Name, Last name, اللقب, اسم العائلة, الاسم العائلي |
| Prénom | oui | Prénom, First name, الاسم, الإسم, الاسم الأول, الاسم الشخصي |
| CIN | oui | CIN, Numéro CIN, بطاقة التعريف الوطنية, رقم بطاقة التعريف |
| Sexe | oui | Sexe, Genre, Gender, الجنس — valeurs : Homme/Femme, M/F, ذكر/أنثى |
| Login | non | Login, Identifiant, Username, Nom d'utilisateur, اسم الدخول |
| N° abonnement | non | Numéro d'abonnement, N° abonnement, Abonnement, رقم الاشتراك |
| Email | non | Email, Mail, E-mail, Adresse email |
| Téléphone | non | Téléphone, Tel, Phone, GSM, الهاتف |
| Adresse | non | Adresse, Address, العنوان |
| Faculté | non | Faculté, Faculty, Établissement, الكلية, المؤسسة |
| Zone | non | Zone, المنطقة |

Le texte entre parenthèses ou crochets d'un en-tête est ignoré :
`Login (FOULENFOULENI)` est lu comme `Login`. Les autres colonnes (par exemple
l'horodatage Google Forms) sont ignorées et listées dans l'aperçu.

## Règles

- **Tout ou rien** : si une colonne obligatoire manque, si deux colonnes désignent le
  même champ, ou si une seule ligne est invalide, **aucune ligne n'est importée**. Les
  erreurs indiquent la ligne et la colonne, jamais la valeur.
- **Faculté et zone doivent déjà exister** (nom complet, ou nom court avant « — »
  s'il est unique). Elles ne sont jamais créées par l'import.
- **Doublons refusés** : même CIN, même N° d'abonnement ou même login deux fois dans
  le fichier ; login déjà utilisé par un autre membre ; CIN et N° d'abonnement
  correspondant à deux membres différents.
- Un membre existant est retrouvé par **CIN**, puis par **N° d'abonnement** ; ses
  informations sont mises à jour, son compte et son statut de paiement sont conservés.
  Les anciens membres ne sont **jamais supprimés**.
- Login d'un nouveau membre : celui du fichier, sinon **NOMPRENOM** en majuscules (un
  suffixe numérique est ajouté seulement si ce login généré est déjà pris).
- Maximum : **500 lignes** par import.

## Comptes de connexion et activation

L'import crée ou met à jour uniquement les **fiches membres**. Il ne crée **aucun
compte de connexion** et n'affiche aucun mot de passe. Les nouveaux membres
apparaissent « **Non activé** » dans la liste. Le rapport d'import donne, pour
chaque ligne, un statut (`created`, `updated`, `failed` + code), sans aucune
valeur personnelle.

Activation, membre par membre, par un SUPERADMIN (bouton **Activer le compte**) :

1. Le serveur crée le compte avec un mot de passe aléatoire que personne ne connaît
   (jamais le CIN ni une autre donnée personnelle).
2. Il génère un **lien d'activation à usage unique** (lien de récupération Supabase)
   qui expire selon le réglage Supabase Auth. Le lien est affiché **une seule
   fois** ; remettez-le au membre par un canal sûr.
3. Le membre ouvre le lien, arrive sur « Nouveau mot de passe » et choisit son mot
   de passe. Tant qu'il ne l'a pas fait, le serveur ne lui donne accès à aucune
   donnée, et il vérifie que le mot de passe a réellement changé.
4. Lien expiré ou déjà utilisé : la page l'indique ; le SUPERADMIN génère un nouvel
   accès (bouton **Nouvel accès**).

Si les liens ne sont pas configurés (`PUBLIC_SITE_URL` et liste des URL de
redirection Supabase Auth), le SUPERADMIN peut, après confirmation, générer à la
place un **mot de passe temporaire** affiché une seule fois et valable 7 jours.

Les adresses de connexion sont internes (`<login>@login.ueclubiste.local`) : les
e-mails d'invitation de Supabase ne sont pas utilisables tant que les comptes
n'ont pas une adresse vérifiée et un serveur SMTP configuré.

## Exemple (données fictives)

```csv
mail,Nom,prenom,numero d'abonnement,CIN,sexe,Téléphone,address,FACULTÉ,zone
test.member001@example.invalid,TEST,SYNTHETIC_MEMBER_001,TEST-0001,00000001,M,+216 00 000 001,1 Rue Fictive Test,FSEG Tunis — Faculté des Sciences Economiques et de Gestion de Tunis,ZONE A
```

`CSV_MEMBRES_TEMPLATE.csv` reprend les en-têtes du formulaire Google avec trois
lignes fictives. Ne versionnez jamais un fichier contenant de vraies données.
