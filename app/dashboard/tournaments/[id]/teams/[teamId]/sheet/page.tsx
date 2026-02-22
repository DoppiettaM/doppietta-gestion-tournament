"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../../../lib/supabaseClient";

type TeamRow = { id: string; name: string };
type TournamentRow = { id: string; title: string; max_players_per_team: number };

type PlayerForm = {
  jersey_number: string;
  first_name: string;
  last_name: string;
  license_number: string;
  birth_date: string; // YYYY-MM-DD
};

export default function TeamSheetPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);
  const teamId = String(params.teamId);

  const [status, setStatus] = useState("Chargement...");
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [tournament, setTournament] = useState<TournamentRow | null>(null);

  const [rows, setRows] = useState<PlayerForm[]>([]);
  const maxPlayers = useMemo(() => tournament?.max_players_per_team ?? 7, [tournament]);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data: tData, error: tErr } = await supabase
        .from("tournaments")
        .select("id,title,max_players_per_team")
        .eq("id", tournamentId)
        .single();

      if (tErr) return setStatus("Erreur tournoi: " + tErr.message);
      setTournament(tData as any);

      const { data: teamData, error: teamErr } = await supabase
        .from("teams")
        .select("id,name")
        .eq("id", teamId)
        .single();

      if (teamErr) return setStatus("Erreur équipe: " + teamErr.message);
      setTeam(teamData as any);

      const { data: playersData, error: pErr } = await supabase
        .from("players")
        .select("jersey_number,first_name,last_name,license_number,birth_date")
        .eq("tournament_id", tournamentId)
        .eq("team_id", teamId)
        .order("jersey_number", { ascending: true, nullsFirst: true });

      if (pErr) return setStatus("Erreur joueurs: " + pErr.message);

      const existing = (playersData ?? []).map((p: any) => ({
        jersey_number: p.jersey_number == null ? "" : String(p.jersey_number),
        first_name: p.first_name ?? "",
        last_name: p.last_name ?? "",
        license_number: p.license_number ?? "",
        birth_date: p.birth_date ?? "",
      })) as PlayerForm[];

      const filled: PlayerForm[] = [];
      for (let i = 0; i < maxPlayers; i++) {
        filled.push(
          existing[i] ?? {
            jersey_number: "",
            first_name: "",
            last_name: "",
            license_number: "",
            birth_date: "",
          }
        );
      }

      setRows(filled);
      setStatus("");
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId, teamId, maxPlayers]);

  function updateRow(idx: number, key: keyof PlayerForm, value: string) {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  }

  async function save() {
    if (!tournament || !team) return;

    setStatus("Enregistrement...");

    // On garde uniquement les lignes renseignées (au moins nom ou prénom)
    const payload = rows
      .map((r) => ({
        tournament_id: tournamentId,
        team_id: teamId,
        jersey_number: r.jersey_number === "" ? null : Number(r.jersey_number),
        first_name: r.first_name.trim() === "" ? null : r.first_name.trim(),
        last_name: r.last_name.trim() === "" ? null : r.last_name.trim(),
        license_number: r.license_number.trim() === "" ? null : r.license_number.trim(),
        birth_date: r.birth_date.trim() === "" ? null : r.birth_date.trim(),
      }))
      .filter((r) => r.first_name || r.last_name);

    // Stratégie simple: purge équipe puis insert propre (sans id !)
    const { error: delErr } = await supabase
      .from("players")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("team_id", teamId);

    if (delErr) return setStatus("Erreur delete: " + delErr.message);

    if (payload.length > 0) {
      const { error: insErr } = await supabase.from("players").insert(payload);
      if (insErr) return setStatus("Erreur insert: " + insErr.message);
    }

    setStatus("Sauvegardé ✅");
    setTimeout(() => setStatus(""), 1200);
  }

  if (!team || !tournament) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow p-6">{status}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Fiche de présence</h1>
            <p className="text-sm text-gray-500">
              Tournoi: <strong>{tournament.title}</strong> · Équipe: <strong>{team.name}</strong> · Max joueurs:{" "}
              <strong>{maxPlayers}</strong>
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.back()}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Retour
            </button>
            <button
              onClick={save}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              Sauvegarder
            </button>
          </div>
        </div>

        {status && <div className="bg-white rounded-xl shadow p-4 text-gray-700">{status}</div>}

        <div className="bg-white rounded-xl shadow p-6 overflow-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="text-left text-sm text-gray-600 border-b">
                <th className="p-3 w-20">#</th>
                <th className="p-3">Nom</th>
                <th className="p-3">Prénom</th>
                <th className="p-3">Licence</th>
                <th className="p-3 w-44">Naissance</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-b">
                  <td className="p-3">
                    <input
                      type="number"
                      className="w-16 border rounded-lg p-2"
                      value={r.jersey_number}
                      onChange={(e) => updateRow(idx, "jersey_number", e.target.value)}
                    />
                  </td>

                  <td className="p-3">
                    <input
                      className="w-full border rounded-lg p-2"
                      value={r.last_name}
                      onChange={(e) => updateRow(idx, "last_name", e.target.value)}
                    />
                  </td>

                  <td className="p-3">
                    <input
                      className="w-full border rounded-lg p-2"
                      value={r.first_name}
                      onChange={(e) => updateRow(idx, "first_name", e.target.value)}
                    />
                  </td>

                  <td className="p-3">
                    <input
                      className="w-full border rounded-lg p-2"
                      value={r.license_number}
                      onChange={(e) => updateRow(idx, "license_number", e.target.value)}
                    />
                  </td>

                  <td className="p-3">
                    <input
                      type="date"
                      className="border rounded-lg p-2"
                      value={r.birth_date}
                      onChange={(e) => updateRow(idx, "birth_date", e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
          Après sauvegarde: va dans <strong>Matchs → Détails</strong> pour ajouter ⚽/🎯/🟡/🔴 sur les joueurs.
        </div>
      </div>
    </main>
  );
}