# Challenge Michel Clipet — mode d'emploi

## Structure

Un Challenge crée deux tournois liés : **U8 🔴** et **U9 ⚫️**. Chaque tournoi exige 10 équipes.

- Phase 1 : M1 à M45, poule unique, 9 matchs par équipe.
- Barème : victoire 8, nul 4, défaite 2, plus 1 point par but marqué.
- Départage : points, buts marqués, buts encaissés (le moins possible), puis tirage au sort manuel si égalité parfaite.
- Phase 2 : M46/M47 (1-4), M48-M50 (5-7), M51-M53 (8-10), M54 petite finale, M55 finale.
- M46, M47, M54, M55 : en cas d'égalité, renseigner les tirs au but pour désigner le vainqueur.

## Utilisation

1. Ouvrir **Mes tournois → Challenges → + Challenge Michel Clipet**.
2. Renseigner date, horaires et nombre de terrains. Les deux tournois sont créés avec 10 min de jeu et 3 min de rotation.
3. Dans chaque catégorie, ajouter exactement 10 équipes. Renseigner **Nom du club** et **N° d'équipe** pour associer Club 1 U8 à Club 1 U9, Club 2 U8 à Club 2 U9, etc.
4. Dans **Planning**, générer M1 à M45.
5. Saisir et valider les 45 scores.
6. Dans **Pilotage Michel Clipet**, figer la phase 1 et générer M46 à M53.
7. Après validation de M46/M47, générer M54/M55.
8. Le classement final de chaque tournoi attribue 20 points au 1er, 19 au 2e, ... 11 au 10e. Une équipe marquée absente/disqualifiée rapporte 0.
9. Le tableau du Challenge additionne automatiquement U8 + U9 par couple `club + numéro d'équipe`.

## Base de données

La migration correspondante est incluse dans `supabase/migrations/20260818_michel_clipet.sql`.
