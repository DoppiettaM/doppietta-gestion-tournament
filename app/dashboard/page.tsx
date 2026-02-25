"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type Tournament = {
  id: string;
  title: string;
  date: string | null;
  created_at: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [status, setStatus] = useState("Chargement...");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      await refresh();
      setStatus("");
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refresh() {
    const { data, error } = await supabase
      .from("tournaments")
      .select("id,title,date,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("Erreur: " + error.message);
      return;
    }

    setTournaments((data ?? []) as any);
  }

  async function deleteTournament(tournamentId: string, title: string) {
    const ok = window.confirm(
      `Supprimer définitivement le tournoi "${title}" ?\n\n⚠️ Cela supprimera aussi les équipes, joueurs, matchs et événements liés.`
    );
    if (!ok) return;

    setBusyId(tournamentId);
    setStatus("");

    // 1) Récupérer les match ids pour effacer match_events proprement
    const { data: mData, error: mErr } = await supabase
      .from("matches")
      .select("id")
      .eq("tournament_id", tournamentId);

    if (mErr) {
      setStatus("Erreur lecture matches: " + mErr.message);
      setBusyId(null);
      return;
    }

    const matchIds = (mData ?? []).map((m: any) => m.id);

    // 2) Supprimer match_events (si table liée à match_id)
    if (matchIds.length > 0) {
      const { error: eErr } = await supabase
        .from("match_events")
        .delete()
        .in("match_id", matchIds);

      if (eErr) {
        setStatus("Erreur suppression events: " + eErr.message);
        setBusyId(null);
        return;
      }
    }

    // 3) Supprimer matches
    const { error: delMatchesErr } = await supabase
      .from("matches")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delMatchesErr) {
      setStatus("Erreur suppression matches: " + delMatchesErr.message);
      setBusyId(null);
      return;
    }

    // 4) Supprimer players
    const { error: delPlayersErr } = await supabase
      .from("players")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delPlayersErr) {
      setStatus("Erreur suppression players: " + delPlayersErr.message);
      setBusyId(null);
      return;
    }

    // 5) Supprimer teams
    const { error: delTeamsErr } = await supabase
      .from("teams")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delTeamsErr) {
      setStatus("Erreur suppression teams: " + delTeamsErr.message);
      setBusyId(null);
      return;
    }

    // 6) Supprimer tournament
    const { error: delTournamentErr } = await supabase
      .from("tournaments")
      .delete()
      .eq("id", tournamentId);

    if (delTournamentErr) {
      setStatus("Erreur suppression tournoi: " + delTournamentErr.message);
      setBusyId(null);
      return;
    }

    // 7) UI refresh
    setTournaments((prev) => prev.filter((t) => t.id !== tournamentId));
    setBusyId(null);
    setStatus("✅ Tournoi supprimé.");
    setTimeout(() => setStatus(""), 1500);
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">Dashboard</h1>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/dashboard/create")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              + Créer un tournoi
            </button>
            <button
              onClick={() => refresh()}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
              title="Rafraîchir"
            >
              🔄
            </button>
          </div>
        </div>

        {status && (
          <div className="bg-white rounded-xl shadow p-4 text-gray-700">
            {status}
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-6">
          {tournaments.length === 0 ? (
            <p className="text-gray-600">Aucun tournoi pour le moment.</p>
          ) : (
            <div className="space-y-3">
              {tournaments.map((t) => (
                <div
                  key={t.id}
                  className="border rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap hover:bg-slate-50"
                >
                  <div>
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-sm text-gray-500">
                      {t.date ? `Date: ${t.date}` : "Date non renseignée"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/dashboard/tournaments/${t.id}`)}
                      className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
                    >
                      Ouvrir
                    </button>

                    <button
                      onClick={() => deleteTournament(t.id, t.title)}
                      disabled={busyId === t.id}
                      className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
                      title="Supprimer ce tournoi"
                    >
                      {busyId === t.id ? "Suppression..." : "🗑️ Supprimer"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-4">
            Astuce: on peut aussi ajouter plus tard une “archive” (sans suppression) si tu veux garder l’historique.
          </p>
        </div>
      </div>
    </main>
  );
}