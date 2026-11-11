# SMART CLASS — Notes de la Phase 1

## Fichiers ajoutés

- `package.json` : dépendances locales et commandes `npm start` / `npm run check`.
- `server.js` : serveur Express local, schéma SQLite, import initial, authentification, sessions et routes protégées.
- `public/index.html`, `public/styles.css`, `public/app.js` : connexion et demande d’inscription parent en français.
- `test/phase1.test.js` : vérifications de la base et tests HTTP des rôles.
- `package-lock.json` : versions exactes des dépendances installées.
- `.gitignore` : exclusion ajoutée pour le secret de session local.

Les fichiers fournis dans `seed_data/`, `private_input/`, `reference/`, ainsi que les documents d’origine n’ont pas été modifiés. `private_input/` n’est jamais servi comme contenu Web.

## Import initial

Le premier démarrage charge les CSV de l’école dans `data/smart-class.db` et marque l’import dans `seed_meta`. Les démarrages suivants ne réinitialisent pas la base. Les classes, shifts hebdomadaires, salles, matières, enseignants, charge de travail, horaires, élèves, parents, cours, historiques et notifications sont stockés dans des tables dédiées. `attendance_initiale.csv` est la seule source de présence chargée; `attendance_demo.csv` n’est jamais lue par l’import.

Un statut de présence vide devient `NOT_RECORDED`; `PRESENT` et `ABSENT` restent distincts. Les cinq parents PAR-046 à PAR-050 et leurs demandes sont conservés en attente à partir de `parents.csv` et `seed-data.json`. Seuls les 45 parents approuvés obtiennent un compte actif à l’import.

## Sécurité mise en place

- Les mots de passe initiaux sont lus côté serveur depuis `private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv`; les champs de démonstration des CSV ne sont pas utilisés.
- bcryptjs (coût 12) produit les seuls mots de passe stockés; les mots de passe en clair sont retirés de la mémoire après le hachage.
- Le compte parent en attente n’est pas créé dans `users`. Son empreinte hachée est conservée sur la demande jusqu’à décision de Direction.
- Les sessions sont stockées dans SQLite et utilisent un cookie `HttpOnly`, `SameSite=Lax`, renouvelé à la connexion.
- Les routes Direction, enseignant et parent vérifient le rôle côté serveur. Le parent ne peut demander que son propre enfant.
- Limite de tentatives de connexion par adresse, vérification d’origine pour les écritures, taille de requête limitée et en-têtes de sécurité.
- Le serveur écoute uniquement sur `127.0.0.1`.

## Limites de cette phase

La page après connexion confirme la session; les tableaux de bord complets et la gestion générale de l’école relèvent des phases suivantes. La route de décision des demandes parentales est protégée pour Direction, mais aucune page de gestion de ces demandes n’est encore fournie.

Les données initiales restent marquées comme générées et non vérifiées. La validation d’un parent lors de son inscription utilise les informations de l’élève présentes dans la base, mais les identités de départ ne sont pas des identités officielles vérifiées.
