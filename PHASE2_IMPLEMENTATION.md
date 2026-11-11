# SMART CLASS — Phase 2 : administration Direction

## Changements

- Réutilisation du serveur Express, de la base SQLite, de la session et du contrôle de rôle existants. Aucun compte ou jeu de données de démonstration n’a été ajouté.
- Ajout des routes Direction pour le tableau de bord, les élèves, enseignants, parents, classes, emplois du temps, présences, inscriptions, notifications et paramètres.
- Ajout d’un espace Direction en français avec navigation latérale fixe, affichage responsive, recherches, filtres, profils détaillés et vue hebdomadaire des cours.
- Les états de présence restent `PRESENT`, `ABSENT` et `NOT_RECORDED`; l’écran des absences inclut une pagination pour parcourir tous les enregistrements.
- Les demandes peuvent être approuvées ou refusées. L’approbation active le compte correspondant. Un refus exige un motif conservé dans la demande et dans le journal d’audit. Une contrainte SQLite et une transaction empêchent la création de comptes parent en double.
- `test/phase1.test.js` couvre désormais les routes Direction, les filtres, les profils, l’activation et le refus des demandes, les permissions et les ressources de l’interface.

## Conservation de la base

Le tableau de bord a été testé sur une copie temporaire de la base. Les routes d’approbation et de refus n’ont donc pas changé les cinq demandes qui restent en attente dans la base du projet. Aucun import initial, effacement ou réinitialisation n’a été effectué pendant la Phase 2.

## Démarrage

Dans PowerShell, depuis ce dossier :

```powershell
npm start
```

Ouvrir ensuite `http://127.0.0.1:3000`. Connectez-vous avec le compte Direction initial pour voir le tableau de bord.

## Limites restantes

- Les listes et profils sont consultables; les écrans de création/modification des fiches élèves et enseignants ne font pas partie des exigences de cette phase.
- Le calendrier Direction est une vue des cours importés. La modification de l’emploi du temps et la validation des conflits seront traitées dans la phase dédiée.
- Le compteur de présence du jour utilise la date de `Africa/Casablanca`. Comme l’historique fourni s’arrête au 7 novembre 2026, le 10 novembre 2026 affiche zéro appel du jour jusqu’à ce que des appels datés du jour soient enregistrés.
- Les identités, coordonnées et historiques initiaux demeurent des données générées qui doivent être vérifiées avant un usage réel.
