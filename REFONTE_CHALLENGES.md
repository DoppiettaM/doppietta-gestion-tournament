# Doppietta Gestion Tournament — Refonte Challenges

## Contenu de cette version

- Accueil simplifié : présentation courte, connexion, inscription, récupération de mot de passe et trois offres commerciales.
- Parcours `Mot de passe oublié` puis `/reset-password`.
- Challenges multi-tournois avec modèle Michel Clipet.
- Création automatique de deux tournois Michel Clipet : U8 et U9.
- Moteur de classement paramétrable dans `lib/tournamentEngine.ts`.
- Michel Clipet :
  - 10 équipes par tournoi ;
  - M1 à M45 en poule unique ;
  - 8 points victoire / 4 nul / 2 défaite + 1 point par but marqué ;
  - départage : points, buts marqués, buts encaissés, tirage au sort ;
  - M46 : 1er–4e ; M47 : 2e–3e ;
  - M48–M50 : poule places 5–7 ;
  - M51–M53 : poule places 8–10 ;
  - M54 petite finale et M55 finale générées/recalculées à partir des perdants/vainqueurs M46/M47 ;
  - tirs au but enregistrables sur M46, M47, M54, M55 en cas d'égalité ;
  - classement final 1 à 10 ;
  - conversion Challenge : 20 points au 1er jusqu'à 11 au 10e ;
  - 0 point Challenge pour une équipe absente/disqualifiée ;
  - agrégation U8 + U9 par `club_name` + `team_number` (Club 1 avec Club 1, Club 2 avec Club 2).
- Gestion des arbitres :
  - liste des arbitres par tournoi ;
  - génération automatique équilibrée ;
  - pas de double affectation simultanée ;
  - évitement d'une même équipe sur deux affectations successives ;
  - créneau de repos entre deux arbitrages si les effectifs le permettent ;
  - modifications manuelles après génération ;
  - arbitre visible sur l'écran de diffusion administrateur et public.

## Migration Supabase

Appliquer avant de tester la nouvelle version :

`supabase/migrations/20260818_challenges_referees.sql`

La migration est idempotente et contient une compatibilité avec les colonnes utilisées par la précédente tentative Michel Clipet (`title/challenge_date`, `squad_number`, `challenge_disqualified`).

## Ordre conseillé de test Michel Clipet

1. Créer un Challenge Michel Clipet depuis `Dashboard > Challenges`.
2. Ouvrir U8 et saisir exactement 10 équipes en renseignant le club et le numéro d'équipe.
3. Faire de même pour U9.
4. Dans le pilotage Michel Clipet U8/U9, générer M1–M45.
5. Saisir/valider les 45 résultats.
6. Générer M46–M53.
7. Valider M46/M47 avec tirs au but si nécessaire.
8. Générer/recalculer M54/M55.
9. Valider M48–M55.
10. Vérifier le classement final U8/U9 puis le classement général du Challenge.
11. Ajouter les arbitres, générer les affectations et vérifier l'écran public.

## Important

Les règles disciplinaires détaillées des séances de tirs au but (ordre des 3 tireurs, interdiction de retirer avant le passage de tous les joueurs, gardien non remplaçable exclusivement pour la séance) relèvent du règlement sportif. L'application stocke actuellement le résultat de la séance et le vainqueur, mais ne journalise pas encore chaque tireur individuellement.
