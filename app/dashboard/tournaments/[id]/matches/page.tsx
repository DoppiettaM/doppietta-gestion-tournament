"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type MatchRow = {
  id: string;
  start_time: string; // time (souvent HH:MM:SS)
  field_idx: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home: { name: string } | null;
  away: { name: string } | null;
};

function normHHMM(t: string) {
  return (t ?? "").slice(0, 5);
}

export default function MatchesPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [statusMsg, setStatusMsg] = useState("Chargement...");
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [fieldNames, setFieldNames] = useState<string[]>([]);

  // buffer d’édition des scores
  const edits = useMemo(() => new Map<string, { home: string; away: string }>(), []);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data: tData, error: tErr } = await supabase
        .from("tournaments")
        .select("field_names,num_fields")
        .eq("id", tournamentId)
        .single();

      if (tErr) return setStatusMsg("Erreur tournoi: " + tErr.message);

      const names =
        (tData?.field_names as string[]) ??
        Array.from({ length: tData?.num_fields ?? 1 }, (_, i) => `Terrain ${i + 1}`);

      setFieldNames(names);

      await refreshMatches();
      setStatusMsg("");
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  async function refreshMatches() {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home:home_team_id(name),away:away_team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (error) {
      setStatusMsg("Erreur matches: " + error.message);
      return;
    }

    setMatches((data ?? []) as any);
  }

  function setEdit(id: string, side: "home" | "away", value: string) {
    const cur = edits.get(id) ?? { home: "", away: "" };
    edits.set(id, { ...cur, [side]: value });
    setMatches((prev) => [...prev]); // refresh UI
  }

  function readScore(m: MatchRow, side: "home" | "away") {
    const cur = edits.get(m.id);
    const raw = cur?.[side] ?? "";
    if (raw === "") return side === "home" ? m.home_score : m.away_score;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  async function validateMatch(m: MatchRow) {
    const home = readScore(m, "home");
    const away = readScore(m, "away");

    if (home == null || away == null) {
      setStatusMsg("Entre 2 scores valides avant de valider.");
      return;
    }

    setStatusMsg("Validation...");

    const { error } = await supabase
      .from("matches")
      .update({
        home_score: home,
        away_score: away,
        status: "played",
        played_at: new Date().toISOString(),
      })
      .eq("id", m.id);

    if (error) return setStatusMsg("Erreur: " + error.message);

    setStatusMsg("Match validé ✅");
    await refreshMatches();
    setTimeout(() => setStatusMsg(""), 1200);
  }

  function goDetails(matchId: string) {
    router.push(`/dashboard/tournaments/${tournamentId}/matches/${matchId}`);
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Gestion des matchs</h1>
            <p className="text-sm text-gray-500">
              Scores + validation. Détails = buts/passes/cartons/MVP.
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/schedule`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Planning
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/results`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Résultats
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/teams`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Équipes
            </button>
          </div>
        </div>

        {statusMsg && (
          <div className="bg-white rounded-xl shadow p-4 text-gray-700">{statusMsg}</div>
        )}

        <div className="bg-white rounded-xl shadow p-6 overflow-auto">
          <table className="w-full min-w-[1050px]">
            <thead>
              <tr className="text-left text-sm text-gray-600 border-b">
                <th className="p-3">Heure</th>
                <th className="p-3">Terrain</th>
                <th className="p-3">Match</th>
                <th className="p-3 w-48">Score</th>
                <th className="p-3 w-56">Actions</th>
              </tr>
            </thead>

            <tbody>
              {matches.map((m) => {
                const terrain = fieldNames[(m.field_idx ?? 1) - 1] ?? `Terrain ${m.field_idx}`;
                const played = m.status === "played";

                return (
                  <tr key={m.id} className="border-b align-top">
                    <td className="p-3 font-semibold text-gray-700">{normHHMM(m.start_time)}</td>
                    <td className="p-3 text-gray-700">{terrain}</td>

                    <td className="p-3">
                      <div className="font-semibold">{m.home?.name ?? "Équipe A"}</div>
                      <div className="text-sm text-gray-500">vs</div>
                      <div className="font-semibold">{m.away?.name ?? "Équipe B"}</div>
                      {played && (
                        <div className="text-xs text-green-700 font-semibold mt-2">VALIDÉ</div>
                      )}
                    </td>

                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          className="w-16 border rounded-lg p-2"
                          defaultValue={m.home_score ?? undefined}
                          placeholder={m.home_score == null ? "-" : String(m.home_score)}
                          onChange={(e) => setEdit(m.id, "home", e.target.value)}
                        />
                        <span className="text-gray-500 font-semibold">:</span>
                        <input
                          type="number"
                          className="w-16 border rounded-lg p-2"
                          defaultValue={m.away_score ?? undefined}
                          placeholder={m.away_score == null ? "-" : String(m.away_score)}
                          onChange={(e) => setEdit(m.id, "away", e.target.value)}
                        />
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => validateMatch(m)}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                        >
                          Valider
                        </button>

                        <button
                          onClick={() => goDetails(m.id)}
                          className="bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition"
                        >
                          Détails
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {matches.length === 0 && (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={5}>
                    Aucun match. Génère d’abord les matchs dans Planning.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
          Note: la page Détails affichera des joueurs seulement quand on aura alimenté la table <strong>players</strong>
          (via fiche de présence). On va faire ça juste après.
        </div>
      </div>
    </main>
  );
}