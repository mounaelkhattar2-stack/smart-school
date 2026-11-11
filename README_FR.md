# SMART CLASS — Nouveau projet local pour Codex

Ce kit doit être utilisé dans un **nouveau dossier indépendant**. Ne l'ouvrez pas dans l'ancien projet SMART CLASS et ne modifiez pas l'ancien dossier.

## Étapes pour Codex

1. Téléchargez `SMART_CLASS_WEB_STARTER.zip` et extrayez-le dans un nouveau dossier nommé `SMART CLASS WEB ONLY`.
2. Vérifiez que le dossier contient `CODEX_PROMPT.md`, `seed_data`, `reference`, `private_input` et `.gitignore`.
3. Ouvrez Codex et choisissez **Open folder / Ouvrir un dossier**.
4. Sélectionnez précisément le dossier `SMART CLASS WEB ONLY`.
5. Dans Codex, envoyez le message de départ fourni à la fin de ce README.
6. Codex doit d'abord lire `CODEX_PROMPT.md`, inspecter les fichiers de données, puis construire le site dans ce dossier uniquement.
7. Ne lui demandez pas de toucher à l'ancien projet, à Firebase, à Cloudflare, à ESP32 ou à GitHub.

## Ce que le kit contient

- `CODEX_PROMPT.md` : cahier des charges détaillé, étape par étape.
- `seed_data/` : données initiales pour 5 classes, 50 élèves, 50 parents, 20 enseignants et 120 cours hebdomadaires.
- `reference/emploi-du-temps-reference.png` : référence visuelle du tableau d'emploi du temps.
- `private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv` : identifiants et mots de passe initiaux uniques pour Direction, chaque enseignant et chaque parent.
- `private_input/COMPTES_INITIAUX_CONFIDENTIELS.txt` : copie lisible des mêmes identifiants.
- `.gitignore` : exclut notamment `private_input/`, la base SQLite et les fichiers téléversés.

## Comptes initiaux

Il n'y a **aucun compte générique de démonstration**. Le kit fournit 71 comptes uniques :

- 1 compte Direction : identifiant `DIR-001`.
- 20 comptes enseignants : chaque enseignant utilise son `login_id` propre.
- 50 comptes parents : chaque parent utilise le Code Massar de son enfant comme identifiant.

Les mots de passe sont différents et générés aléatoirement. Retrouvez-les dans `private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv` ou le fichier `.txt`. Conservez ces fichiers en lieu sûr. Ne les envoyez pas dans le groupe et ne les publiez jamais sur GitHub. Codex doit lire les mots de passe uniquement côté serveur pour créer les comptes, puis enregistrer uniquement les hachages bcrypt dans SQLite.

## Important : nature des données

Vous avez demandé que ces enregistrements soient le **jeu initial de l'application**, et non un mode démo séparé. Le site doit donc les charger comme données initiales et fonctionner dessus dès le premier démarrage.

Cependant, les noms, dates de naissance, Codes Massar de forme fictive, emails, numéros de téléphone et historiques de présence ont été générés. Ils ne sont pas des identités ou coordonnées officielles vérifiées. Les emails `example.invalid` sont volontairement non distribuables. Les historiques de présence sont également générés et portent le marqueur `INITIAL_GENERATED_UNVERIFIED`. La Direction doit vérifier et remplacer les informations par les données officielles avant une utilisation réelle avec les familles. Le site doit conserver un indicateur de provenance `INITIAL_GENERATED_UNVERIFIED` pour ces données.

## Matières

SVT est confirmé : **Sciences de la Vie et de la Terre (SVT)**.

Les 10 matières sont : Mathématiques, Français, Arabe, Physique-Chimie, SVT, Philosophie, Histoire-Géographie, Éducation islamique, EPS et Informatique.

## Horaires prévus

- Matin : 08:00–12:00, quatre créneaux d'une heure.
- Pause : 12:00–14:00.
- Après-midi : 14:00–18:00, quatre créneaux d'une heure.
- Du lundi au jeudi : matin ou après-midi selon la classe.
- Vendredi et samedi : matin uniquement.
- Dimanche : aucun cours.
- Maximum de 4 heures d'enseignement par enseignant et par jour; jamais les deux shifts le même jour.

Le kit contient 120 cours hebdomadaires (24 par classe). Les données ont été contrôlées pour les conflits d'emploi du temps.

## Message à envoyer à Codex

Copiez ce message dans Codex après avoir ouvert le nouveau dossier :

> Lis entièrement `CODEX_PROMPT.md` avant de commencer. Inspecte les fichiers `seed_data/` et `private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv`. Construis le site complet décrit dans le prompt, uniquement dans ce nouveau dossier. Il s'agit du jeu initial de l'application, pas d'un mode démo : crée 71 comptes individuels, sans identifiants partagés. Lis les mots de passe uniquement côté serveur, hache-les avec bcrypt et ne les expose jamais au navigateur ni aux logs. Charge les données initiales une seule fois sans doublons. Commence par la structure, le serveur local, SQLite et la connexion, puis construis les trois espaces. Explique-moi simplement chaque étape et ne touche jamais à mon ancien projet.

## Démarrage prévu du site terminé

Après construction, Codex doit documenter les commandes exactes. La cible souhaitée est :

```powershell
npm install
npm start
```

Puis ouvrir `http://127.0.0.1:3000`.
