-- L'écran public peut lire uniquement les challenges explicitement publiés.
-- La politique RLS public_challenges_read filtre déjà les lignes sur display_public = true.
grant select on table public.challenges to anon, authenticated;
