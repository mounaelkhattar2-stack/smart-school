# Contrat futur de pointage ESP32/NFC

Ce document décrit le contrat à implémenter dans une Edge Function avant toute mise en service. Aucun appareil n’est actuellement autorisé et aucune Edge Function n’est déployée.

## Requête

`POST /functions/v1/esp32-nfc-scan` sur HTTPS, corps JSON inférieur à 2 Ko :

```json
{
  "device_id": "identifiant-enregistre",
  "event_id": "UUID stable pour cette lecture et ses nouvelles tentatives",
  "card_uid": "UID NFC",
  "scanned_at": "horodatage ISO-8601 UTC"
}
```

Le dispositif transmet son secret aléatoire dans `X-Device-Token`. Il ne transmet ni identifiant d’élève ni statut de présence. `event_id` doit rester identique lors d’une nouvelle tentative.

## Vérifications côté Edge Function

1. Accepter uniquement HTTPS et `POST`; limiter la taille et valider strictement les champs.
2. Charger `registered_devices` côté serveur, vérifier que l’appareil est actif et comparer en temps constant le SHA-256 du secret reçu à `credential_hash`.
3. Rejeter les lectures trop anciennes, futures ou déjà traitées. L’index unique `(device_id,event_id)` est la protection finale contre les répétitions concurrentes.
4. Résoudre `card_uid` vers une carte active et un élève actif. Ne jamais accepter un `student_id` transmis par le microcontrôleur.
5. Appeler une fonction PostgreSQL atomique qui revalide l’appareil, la carte, le cours courant, l’horaire de Casablanca, la classe, les absences non autorisées et les répétitions avant d’écrire présence, événement appareil et audit.
6. Retourner un accusé JSON sans données scolaires inutiles. Les répétitions doivent retourner le résultat déjà enregistré, sans créer une seconde présence.

## Secrets et stockage

- Le Secret Key Supabase reste uniquement dans les variables d’environnement de l’Edge Function. Il ne doit apparaître ni dans cette requête, ni dans le JavaScript public, ni dans le firmware.
- Chaque appareil reçoit un jeton différent, conservé dans NVS chiffré si disponible. La base conserve seulement son empreinte SHA-256. Révoquer un appareil revient à désactiver sa ligne `registered_devices` et à renseigner `revoked_at`.
- Prévoir rotation et révocation des jetons, limitation de débit et journalisation des refus sans inscrire les jetons ni UID complets dans les logs.

## État actuel

Les tables `nfc_cards`, `registered_devices` et `device_scan_events` sont présentes et protégées par RLS. Le RPC atomique dédié aux appareils ainsi que l’Edge Function restent à implémenter et à tester avant d’autoriser un appareil réel.
