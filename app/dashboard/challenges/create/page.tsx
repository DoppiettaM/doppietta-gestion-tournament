"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { CLIPET_FORMAT } from "@/lib/clipet";

export default function CreateChallengePage() {
  const router = useRouter();
  const [title, setTitle] = useState("Challenge Michel Clipet");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [numFields, setNumFields] = useState("4");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function createChallenge() {
    const nFields = Math.max(1, Math.min(24, Number(numFields) || 1));
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/login");
    if (!title.trim()) return setStatus("Le nom du challenge est obligatoire.");

    setBusy(true);
    setStatus("Création du challenge…");

    const { data: challenge, error: cErr } = await supabase
      .from("challenges")
      .insert({ user_id: auth.user.id, title: title.trim(), challenge_date: date || null })
      .select("id")
      .single();
    if (cErr || !challenge) {
      setBusy(false);
      return setStatus("Erreur challenge: " + (cErr?.message ?? "inconnue"));
    }

    const common = {
      user_id: auth.user.id,
      challenge_id: challenge.id,
      tournament_date: date || null,
      min_teams: 10,
      max_teams: 10,
      start_time: startTime,
      end_time: endTime,
      match_duration_min: 10,
      rotation_duration_min: 3,
      num_fields: nFields,
      field_names: Array.from({ length: nFields }, (_, i) => `Terrain ${i + 1}`),
      min_players_per_team: 5,
      max_players_per_team: 9,
      format: CLIPET_FORMAT,
      group_count: 1,
      group_names: null,
      phase1_locked: false,
      pauses: [],
      field_pauses: {},
    };

    const { error: tErr } = await supabase.from("tournaments").insert([
      { ...common, title: `${title.trim()} — U8 🔴`, category: "U8" },
      { ...common, title: `${title.trim()} — U9 ⚫️`, category: "U9" },
    ]);

    if (tErr) {
      await supabase.from("challenges").delete().eq("id", challenge.id);
      setBusy(false);
      return setStatus("Erreur création U8/U9: " + tErr.message);
    }

    router.push(`/dashboard/challenges/${challenge.id}`);
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl shadow p-6">
          <h1 className="text-2xl font-extrabold">Créer le Challenge Michel Clipet</h1>
          <p className="text-sm text-gray-500 mt-1">Création simultanée des tournois U8 🔴 et U9 ⚫️, 10 équipes chacun, matchs de 10 min + rotation de 3 min.</p>
        </div>
        {status && <div className="bg-white rounded-xl shadow p-4">{status}</div>}
        <div className="bg-white rounded-2xl shadow p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="md:col-span-2 text-sm font-semibold">Nom du challenge
            <input className="mt-1 w-full border rounded-xl p-3 font-normal" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="text-sm font-semibold">Date
            <input type="date" className="mt-1 w-full border rounded-xl p-3 font-normal" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="text-sm font-semibold">Nombre de terrains
            <input type="number" min={1} max={24} className="mt-1 w-full border rounded-xl p-3 font-normal" value={numFields} onChange={(e) => setNumFields(e.target.value)} />
          </label>
          <label className="text-sm font-semibold">Début
            <input type="time" className="mt-1 w-full border rounded-xl p-3 font-normal" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="text-sm font-semibold">Fin
            <input type="time" className="mt-1 w-full border rounded-xl p-3 font-normal" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
          <div className="md:col-span-2 flex gap-2 justify-end">
            <button onClick={() => router.push("/dashboard/challenges")} className="px-4 py-3 rounded-xl bg-gray-200">Annuler</button>
            <button disabled={busy} onClick={createChallenge} className="px-4 py-3 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-50">{busy ? "Création…" : "Créer U8 + U9"}</button>
          </div>
        </div>
      </div>
    </main>
  );
}
