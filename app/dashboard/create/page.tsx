"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function CreateTournamentPage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [matchDurationMin, setMatchDurationMin] = useState(12);
  const [rotationMin, setRotationMin] = useState(3);
  const [numFields, setNumFields] = useState(1);
  const [status, setStatus] = useState("");

  // Protection : si pas connecté → login
  useEffect(() => {
    async function guard() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.push("/login");
      }
    }
    guard();
  }, [router]);

  async function createTournament() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    setStatus("Création...");

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      setStatus("Erreur: " + userError.message);
      return;
    }

    const user = userData.user;

    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase.from("tournaments").insert([
      {
        user_id: user.id,
        title: cleanTitle,
        start_time: startTime,
        match_duration_min: matchDurationMin,
        rotation_duration_min: rotationMin,
        num_fields: numFields,
        field_names: Array.from(
          { length: numFields },
          (_, i) => `Terrain ${i + 1}`
        ),
        pauses: [],
        field_pauses: {},
      },
    ]);

    if (error) {
      setStatus("Erreur: " + error.message);
      return;
    }

    router.push("/dashboard/tournaments");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white shadow-lg rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">
          Créer un tournoi
        </h1>

        <label className="block text-sm font-medium text-gray-700 mb-2">
          Titre du tournoi
        </label>
        <input
          className="w-full border rounded-lg p-3 mb-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Doppi Cup"
        />

        <label className="block text-sm font-medium text-gray-700 mb-2">
          Heure de début du tournoi
        </label>
        <input
          className="w-full border rounded-lg p-3 mb-4"
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />

        <label className="block text-sm font-medium text-gray-700 mb-2">
          Durée d’un match (minutes)
        </label>
        <input
          className="w-full border rounded-lg p-3 mb-4"
          type="number"
          min={1}
          value={matchDurationMin}
          onChange={(e) => setMatchDurationMin(Number(e.target.value))}
        />

        <label className="block text-sm font-medium text-gray-700 mb-2">
          Durée d’une rotation (minutes)
        </label>
        <input
          className="w-full border rounded-lg p-3 mb-4"
          type="number"
          min={0}
          value={rotationMin}
          onChange={(e) => setRotationMin(Number(e.target.value))}
        />

        <label className="block text-sm font-medium text-gray-700 mb-2">
          Nombre de terrains
        </label>
        <input
          className="w-full border rounded-lg p-3 mb-6"
          type="number"
          min={1}
          value={numFields}
          onChange={(e) =>
            setNumFields(Math.max(1, Number(e.target.value)))
          }
        />

        <button
          onClick={createTournament}
          disabled={!title.trim()}
          className="w-full bg-blue-600 text-white p-3 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          Créer
        </button>

        {status && (
          <p className="text-sm text-center mt-4 text-gray-500">
            {status}
          </p>
        )}

        <button
          onClick={() => router.push("/dashboard")}
          className="w-full mt-4 bg-gray-100 p-3 rounded-lg hover:bg-gray-200 transition"
        >
          Retour dashboard
        </button>
      </div>
    </main>
  );
}