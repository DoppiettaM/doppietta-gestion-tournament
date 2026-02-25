"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TournamentRow = {
  id: string;
  title: string | null;
  tournament_date: string | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string | null;
  max_teams: number | null;
  num_fields: number | null;
};

function prettyDate(d: string | null) {
  if (!d) return "—";
  // d peut être YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.split("-").reverse().join("/");
  try {
    return new Date(d).toLocaleDateString("fr-FR");
  } catch {
    return d;
  }
}

function hhmm(v: string | null) {
  if (!v) return "—";
  return String(v).slice(0, 5);
}

export default function TournamentsPage() {
  const router = useRouter();

  const [status, setStatus] = useState<string>("");
  const [busyId, setBusyId] = useState<string>("");
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const count = useMemo(() => tournaments.length, [tournaments]);

  useEffect(() => {
    async function boot() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }
      await refresh();
    }
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refresh() {
    setLoading(true);
    setStatus("");

    const { data, error } = await supabase
      .from("tournaments")
      .select("id,title,tournament_date,start_time,end_time,created_at,max_teams,num_fields")
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("Erreur chargement tournois: " + error.message);
      setTournaments([]);
      setLoading(false);
      return;
    }

    setTournaments((data ?? []) as any);
    setLoading(false);
  }

  async function deleteTournamentCascade(tournamentId: string, title: string | null) {
    const ok = window.confirm(
      `Supprimer définitivement le tournoi "${title ?? "Sans titre"}" ?\n\n⚠️ Cela supprimera aussi: équipes, joueurs, matchs, événements.`
    );
    if (!ok) return;

    setBusyId(tournamentId);
    setStatus("");

    // 1) récupérer IDs des matchs
    const { data: mData, error: mErr } = await supabase
      .from("matches")
      .select("id")
      .eq("tournament_id", tournamentId);

    if (mErr) {
      setStatus("Erreur lecture matches: " + mErr.message);
      setBusyId("");
      return;
    }

    const matchIds = (mData ?? []).map((m: any) => m.id);

    // 2) delete events liés aux matchs
    if (matchIds.length > 0) {
      const { error: eErr } = await supabase.from("match_events").delete().in("match_id", matchIds);
      if (eErr) {
        setStatus("Erreur suppression événements: " + eErr.message);
        setBusyId("");
        return;
      }
    }

    // 3) delete matches
    const { error: delMatchesErr } = await supabase
      .from("matches")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delMatchesErr) {
      setStatus("Erreur suppression matches: " + delMatchesErr.message);
      setBusyId("");
      return;
    }

    // 4) delete players
    const { error: delPlayersErr } = await supabase
      .from("players")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delPlayersErr) {
      setStatus("Erreur suppression joueurs: " + delPlayersErr.message);
      setBusyId("");
      return;
    }

    // 5) delete teams
    const { error: delTeamsErr } = await supabase
      .from("teams")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delTeamsErr) {
      setStatus("Erreur suppression équipes: " + delTeamsErr.message);
      setBusyId("");
      return;
    }

    // 6) delete tournament
    const { error: delTournamentErr } = await supabase.from("tournaments").delete().eq("id", tournamentId);

    if (delTournamentErr) {
      setStatus("Erreur suppression tournoi: " + delTournamentErr.message);
      setBusyId("");
      return;
    }

    setBusyId("");
    await refresh();
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Mes tournois</h1>
            <p className="text-sm text-gray-500">{count} tournoi(x)</p>
            {status && <p className="text-sm text-amber-700 mt-2">{status}</p>}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              ← Dashboard
            </button>

            <button
              onClick={() => router.push("/dashboard/create")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              ➕ Créer un tournoi
            </button>

            <button
              onClick={refresh}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
              title="Rafraîchir"
            >
              🔄
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          {loading ? (
            <div className="text-gray-600">Chargement...</div>
          ) : tournaments.length === 0 ? (
            <div className="text-gray-600">Aucun tournoi pour le moment.</div>
          ) : (
            <div className="space-y-3">
              {tournaments.map((t) => (
                <div
                  key={t.id}
                  className="border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-[260px]">
                    <div className="font-bold text-lg">{t.title ?? "Tournoi"}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      📅 {prettyDate(t.tournament_date)} · ⏱️ {hhmm(t.start_time)} → {hhmm(t.end_time)}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      🧩 Terrains: {t.num_fields ?? "—"} · 👥 Max équipes: {t.max_teams ?? 24}
                    </div>
                    <div className="text-xs text-gray-400 mt-1 font-mono">ID: {t.id}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/dashboard/tournaments/${t.id}`)}
                      className="bg-gray-200 px-3 py-2 rounded-lg hover:bg-gray-300 transition"
                      title="Ouvrir"
                    >
                      📂
                    </button>

                    <button
                      onClick={() => router.push(`/dashboard/tournaments/${t.id}/settings`)}
                      className="bg-gray-200 px-3 py-2 rounded-lg hover:bg-gray-300 transition"
                      title="Modifier / Réglages"
                    >
                      ⚙️
                    </button>

                    <button
                      onClick={() => deleteTournamentCascade(t.id, t.title)}
                      disabled={busyId === t.id}
                      className="bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
                      title="Supprimer"
                    >
                      {busyId === t.id ? "..." : "🗑️"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-gray-400 mt-4">
            Astuce: ⚙️ ouvre les réglages. Les changements se répercutent partout (planning/écran/hub) dès sauvegarde.
          </div>
        </div>
      </div>
    </main>
  );
}