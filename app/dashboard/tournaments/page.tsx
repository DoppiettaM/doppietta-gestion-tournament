"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type Tournament = {
  id: string;
  title: string;
  created_at: string;
};

export default function TournamentsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Tournament[]>([]);
  const [status, setStatus] = useState("Chargement...");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data, error } = await supabase
        .from("tournaments")
        .select("id,title,created_at")
        .order("created_at", { ascending: false });

      if (error) {
        setStatus("Erreur: " + error.message);
        return;
      }

      setItems((data ?? []) as Tournament[]);
      setStatus("");
    }

    load();
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Mes tournois</h1>
            <p className="text-sm text-gray-500">
              Accède aux équipes, planning, matchs et résultats.
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.push("/dashboard/create")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              + Nouveau
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Dashboard
            </button>
          </div>
        </div>

        {status && (
          <div className="bg-white rounded-xl shadow p-4 text-gray-600">{status}</div>
        )}

        {!status && items.length === 0 && (
          <div className="bg-white rounded-xl shadow p-6 text-gray-600">
            Aucun tournoi pour l’instant. Clique sur <strong>+ Nouveau</strong>.
          </div>
        )}

        <div className="space-y-3">
          {items.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-xl shadow p-4 flex items-center justify-between gap-3"
            >
              <div>
                <div className="font-semibold">{t.title}</div>
                <div className="text-sm text-gray-500">
                  Créé le {new Date(t.created_at).toLocaleString()}
                </div>
              </div>

              <div className="flex gap-2 flex-wrap justify-end">
                <button
                  onClick={() => router.push(`/dashboard/tournaments/${t.id}/teams`)}
                  className="bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition text-sm"
                >
                  Équipes
                </button>

                <button
                  onClick={() => router.push(`/dashboard/tournaments/${t.id}/schedule`)}
                  className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
                >
                  Planning
                </button>

                <button
                  onClick={() => router.push(`/dashboard/tournaments/${t.id}/matches`)}
                  className="bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition text-sm"
                >
                  Matchs
                </button>

                <button
                  onClick={() => router.push(`/dashboard/tournaments/${t.id}/results`)}
                  className="bg-amber-600 text-white px-3 py-2 rounded-lg hover:bg-amber-700 transition text-sm"
                >
                  Résultats
                </button>

                <button
                  onClick={() => router.push(`/dashboard/tournaments/${t.id}/settings`)}
                  className="bg-gray-100 px-3 py-2 rounded-lg hover:bg-gray-200 transition text-sm"
                >
                  Réglages
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
          Workflow: <strong>Équipes</strong> → <strong>Planning</strong> →{" "}
          <strong>Matchs</strong> → <strong>Résultats</strong>.
        </div>
      </div>
    </main>
  );
}
