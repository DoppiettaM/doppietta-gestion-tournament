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
      if (!userData.user) {
        router.push("/login");
        return;
      }

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
              Gère tes tournois, les réglages (pauses) et l’aperçu planning.
            </p>
          </div>

          <div className="flex gap-2">
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
          <div className="bg-white rounded-xl shadow p-4 text-gray-600">
            {status}
          </div>
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
                  onClick={() => router.push(`/dashboard/tournaments/${t.id}/settings`)}
                  className="bg-gray-100 px-3 py-2 rounded-lg hover:bg-gray-200 transition text-sm"
                >
                  Réglages
                </button>

                <button
                  onClick={() => router.push(`/dashboard/tournaments/${t.id}/schedule`)}
                  className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
                >
                  Planning
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
          Astuce: commence par <strong>Réglages</strong> pour définir les pauses, puis va sur{" "}
          <strong>Planning</strong> pour voir l’aperçu des créneaux.
        </div>
      </div>
    </main>
  );
}