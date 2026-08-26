"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { SCORING_LABELS, ScoringMode } from "@/lib/challenge";

type Challenge = { id: string; title: string; scoring_mode: ScoringMode; shared_resources: boolean; created_at: string };

export default function ChallengesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Challenge[]>([]);
  const [status, setStatus] = useState("Chargement...");

  async function refresh() {
    const { data, error } = await supabase.from("challenges").select("id,title,scoring_mode,shared_resources,created_at").order("created_at", { ascending: false });
    if (error) return setStatus("Erreur: " + error.message + " — appliquez d’abord la migration Supabase challenges.");
    setRows((data ?? []) as Challenge[]);
    setStatus("");
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => data.user ? refresh() : router.push("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return <main className="min-h-screen bg-slate-100 p-6">
    <div className="max-w-6xl mx-auto space-y-4">
      <header className="bg-slate-950 text-white rounded-2xl shadow p-6 flex justify-between gap-4 flex-wrap">
        <div><p className="text-amber-400 font-bold text-sm">DOPPIETTA</p><h1 className="text-3xl font-black">Mes challenges</h1><p className="text-white/60 mt-1">Un challenge réunit de 2 à 6 tournois.</p></div>
        <div className="flex gap-2 items-start">
          <button onClick={() => router.push("/dashboard/tournaments")} className="bg-white/10 px-4 py-2 rounded-xl">← Tournois</button>
          <button onClick={() => router.push("/dashboard/challenges/create")} className="bg-amber-400 text-slate-950 px-4 py-2 rounded-xl font-bold">＋ Créer un challenge</button>
        </div>
      </header>
      {status && <div className="bg-white rounded-xl shadow p-4 text-amber-700">{status}</div>}
      <section className="grid md:grid-cols-2 gap-4">
        {rows.map((row) => <button key={row.id} onClick={() => router.push(`/dashboard/challenges/${row.id}`)} className="bg-white rounded-2xl shadow p-5 text-left hover:ring-2 hover:ring-amber-400 transition">
          <div className="flex justify-between gap-3"><h2 className="font-black text-xl">🏆 {row.title}</h2><span className="text-xs rounded-full bg-slate-100 px-3 py-1">{row.shared_resources ? "Terrains partagés" : "Terrains séparés"}</span></div>
          <p className="text-sm text-gray-600 mt-3">{SCORING_LABELS[row.scoring_mode]}</p>
        </button>)}
        {!status && rows.length === 0 && <div className="bg-white rounded-2xl shadow p-8 text-gray-500">Aucun challenge. Créez d’abord vos tournois, puis regroupez-les ici.</div>}
      </section>
    </div>
  </main>;
}

