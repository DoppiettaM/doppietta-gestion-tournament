"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type MatchRow = {
  id: string;
  start_time: string;
  field_idx: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home: { name: string } | null;
  away: { name: string } | null;
  played_at: string | null;
};

function normHHMM(t: string) {
  return (t ?? "").slice(0, 5);
}

export default function ResultsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [statusMsg, setStatusMsg] = useState("Chargement...");
  const [items, setItems] = useState<MatchRow[]>([]);
  const [fieldNames, setFieldNames] = useState<string[]>([]);

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

      const { data, error } = await supabase
        .from("matches")
        .select(
          "id,start_time,field_idx,status,home_score,away_score,played_at,home:home_team_id(name),away:away_team_id(name)"
        )
        .eq("tournament_id", tournamentId)
        .eq("status", "played")
        .order("played_at", { ascending: false })
        .order("start_time", { ascending: false });

      if (error) return setStatusMsg("Erreur résultats: " + error.message);

      setItems((data ?? []) as any);
      setStatusMsg("");
    }

    load();
  }, [router, tournamentId]);

  const total = items.length;

  const groupedByTime = useMemo(() => {
    // optionnel: regroupement simple par heure
    const map = new Map<string, MatchRow[]>();
    for (const m of items) {
      const k = normHHMM(m.start_time);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [items]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Résultats</h1>
            <p className="text-sm text-gray-500">
              Matchs validés uniquement. Total: {total}
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/matches`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Gestion des matchs
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/schedule`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Planning
            </button>
          </div>
        </div>

        {statusMsg && (
          <div className="bg-white rounded-xl shadow p-4 text-gray-700">{statusMsg}</div>
        )}

        {!statusMsg && total === 0 && (
          <div className="bg-white rounded-xl shadow p-6 text-gray-600">
            Aucun résultat pour l’instant. Va dans <strong>Gestion des matchs</strong> et valide un score.
          </div>
        )}

        {!statusMsg && total > 0 && (
          <div className="space-y-4">
            {groupedByTime.map(([hhmm, rows]) => (
              <div key={hhmm} className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-gray-800">Heure: {hhmm}</div>
                  <div className="text-sm text-gray-500">{rows.length} match(s)</div>
                </div>

                <div className="space-y-2">
                  {rows.map((m) => {
                    const terrain = fieldNames[(m.field_idx ?? 1) - 1] ?? `Terrain ${m.field_idx}`;
                    return (
                      <div key={m.id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
                        <div className="text-sm text-gray-600">
                          {terrain}
                        </div>

                        <div className="flex-1">
                          <div className="font-semibold">{m.home?.name ?? "Équipe A"}</div>
                          <div className="text-sm text-gray-500">vs</div>
                          <div className="font-semibold">{m.away?.name ?? "Équipe B"}</div>
                        </div>

                        <div className="text-xl font-bold text-gray-900">
                          {(m.home_score ?? 0)} : {(m.away_score ?? 0)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
          Prochaine étape: ajouter buteurs/passeurs/sanctions + MVP et afficher sous les scores.
        </div>
      </div>
    </main>
  );
}