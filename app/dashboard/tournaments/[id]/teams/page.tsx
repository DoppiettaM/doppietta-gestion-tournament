"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type TeamRow = {
  id: string;
  name: string;
};

export default function TeamsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [teams, setTeams] = useState<TeamRow[]>([]);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      await refreshTeams();
      setStatus("");
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  async function refreshTeams() {
    const { data, error } = await supabase
      .from("teams")
      .select("id,name")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true });

    if (error) return setStatus("Erreur: " + error.message);

    setTeams((data ?? []) as any);
  }

  function goSheet(teamId: string) {
    router.push(`/dashboard/tournaments/${tournamentId}/teams/${teamId}/sheet`);
  }

  function goBack() {
    router.push(`/dashboard/tournaments/${tournamentId}/matches`);
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Équipes</h1>
            <p className="text-sm text-gray-500">
              Accède à la fiche de présence pour renseigner les joueurs.
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={goBack}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Retour Matchs
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/schedule`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Planning
            </button>
          </div>
        </div>

        {status && (
          <div className="bg-white rounded-xl shadow p-4 text-gray-700">{status}</div>
        )}

        <div className="bg-white rounded-xl shadow p-6">
          {teams.length === 0 ? (
            <div className="text-gray-600">
              Aucune équipe. Ajoute des équipes dans la création du tournoi ou la page correspondante.
            </div>
          ) : (
            <div className="space-y-2">
              {teams.map((t) => (
                <div
                  key={t.id}
                  className="border rounded-lg p-3 flex items-center justify-between gap-3"
                >
                  <div className="font-semibold text-gray-900">{t.name}</div>

                  <div className="flex gap-2 flex-wrap justify-end">
                    <button
                      onClick={() => goSheet(t.id)}
                      className="bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition"
                    >
                      Fiche
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
          Après avoir rempli les fiches: va dans <strong>Matchs → Détails</strong> pour ajouter ⚽/🎯/🟡/🔴.
        </div>
      </div>
    </main>
  );
}