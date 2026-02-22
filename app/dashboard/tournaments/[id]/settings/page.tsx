"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type Pause = { from: string; to: string };
type Tournament = {
  id: string;
  title: string;
  start_time: string;
  match_duration_min: number;
  rotation_duration_min: number;
  num_fields: number;
  field_names: string[];
  pauses: any; // jsonb
  field_pauses: any; // jsonb
};

function emptyPause(): Pause {
  return { from: "12:00", to: "12:30" };
}

export default function TournamentSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [t, setT] = useState<Tournament | null>(null);
  const [status, setStatus] = useState<string>("Chargement...");
  const [saving, setSaving] = useState(false);

  // Edition locale
  const [pauseTournamentEnabled, setPauseTournamentEnabled] = useState(false);
  const [pauseTournamentFrom, setPauseTournamentFrom] = useState("12:00");
  const [pauseTournamentTo, setPauseTournamentTo] = useState("12:30");
  const [pauseTournamentExceptEnabled, setPauseTournamentExceptEnabled] =
    useState(false);
  const [pauseTournamentExceptFrom, setPauseTournamentExceptFrom] = useState("13:00");
  const [pauseTournamentExceptTo, setPauseTournamentExceptTo] = useState("14:00");
  const [pauseTournamentExceptFields, setPauseTournamentExceptFields] = useState<string>("2"); // "2,3"

  const [fieldPauses, setFieldPauses] = useState<Record<string, Pause[]>>({}); // {"1":[{from,to}]}

  const fieldCount = t?.num_fields ?? 1;
  const fieldNames = t?.field_names ?? Array.from({ length: fieldCount }, (_, i) => `Terrain ${i + 1}`);

  const fieldOptions = useMemo(
    () => Array.from({ length: fieldCount }, (_, i) => ({ idx: i + 1, name: fieldNames[i] })),
    [fieldCount, fieldNames]
  );

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id,title,start_time,match_duration_min,rotation_duration_min,num_fields,field_names,pauses,field_pauses"
        )
        .eq("id", tournamentId)
        .single();

      if (error) {
        setStatus("Erreur: " + error.message);
        return;
      }

      const tour = data as Tournament;
      setT(tour);

      // Hydratation pauses globales (format V1)
      const pausesArr = Array.isArray(tour.pauses) ? tour.pauses : [];
      const pTournament = pausesArr.find((p: any) => p?.type === "tournament");
      const pExcept = pausesArr.find((p: any) => p?.type === "tournament_except");

      if (pTournament) {
        setPauseTournamentEnabled(true);
        setPauseTournamentFrom(pTournament.from ?? "12:00");
        setPauseTournamentTo(pTournament.to ?? "12:30");
      }

      if (pExcept) {
        setPauseTournamentExceptEnabled(true);
        setPauseTournamentExceptFrom(pExcept.from ?? "13:00");
        setPauseTournamentExceptTo(pExcept.to ?? "14:00");
        setPauseTournamentExceptFields(
          Array.isArray(pExcept.exceptFields) ? pExcept.exceptFields.join(",") : "2"
        );
      }

      // Hydratation pauses par terrain
      const fp = tour.field_pauses && typeof tour.field_pauses === "object" ? tour.field_pauses : {};
      const normalized: Record<string, Pause[]> = {};
      for (const key of Object.keys(fp)) {
        const arr = Array.isArray(fp[key]) ? fp[key] : [];
        normalized[key] = arr
          .filter((x: any) => x?.from && x?.to)
          .map((x: any) => ({ from: x.from, to: x.to }));
      }
      setFieldPauses(normalized);

      setStatus("");
    }

    load();
  }, [router, tournamentId]);

  function addFieldPause(fieldIdx: number) {
    const key = String(fieldIdx);
    setFieldPauses((prev) => ({
      ...prev,
      [key]: [...(prev[key] ?? []), emptyPause()],
    }));
  }

  function updateFieldPause(fieldIdx: number, pauseIdx: number, patch: Partial<Pause>) {
    const key = String(fieldIdx);
    setFieldPauses((prev) => {
      const arr = [...(prev[key] ?? [])];
      arr[pauseIdx] = { ...arr[pauseIdx], ...patch };
      return { ...prev, [key]: arr };
    });
  }

  function removeFieldPause(fieldIdx: number, pauseIdx: number) {
    const key = String(fieldIdx);
    setFieldPauses((prev) => {
      const arr = [...(prev[key] ?? [])];
      arr.splice(pauseIdx, 1);
      return { ...prev, [key]: arr };
    });
  }

  async function save() {
    if (!t) return;

    setSaving(true);
    setStatus("Enregistrement...");

    // pauses globales (jsonb array)
    const pauses: any[] = [];
    if (pauseTournamentEnabled) {
      pauses.push({
        type: "tournament",
        from: pauseTournamentFrom,
        to: pauseTournamentTo,
      });
    }
    if (pauseTournamentExceptEnabled) {
      const exceptFields = pauseTournamentExceptFields
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= (t.num_fields ?? 1));
      pauses.push({
        type: "tournament_except",
        from: pauseTournamentExceptFrom,
        to: pauseTournamentExceptTo,
        exceptFields,
      });
    }

    // field_pauses (jsonb object)
    const fp: Record<string, Pause[]> = {};
    for (const k of Object.keys(fieldPauses)) {
      fp[k] = (fieldPauses[k] ?? []).filter((p) => p.from && p.to);
    }

    const { error } = await supabase
      .from("tournaments")
      .update({ pauses, field_pauses: fp })
      .eq("id", t.id);

    if (error) {
      setStatus("Erreur: " + error.message);
      setSaving(false);
      return;
    }

    setStatus("Sauvegardé ✅");
    setSaving(false);
  }

  if (!t) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">{status}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Réglages: {t.title}</h1>
              <p className="text-sm text-gray-500">
                Début {t.start_time} · Match {t.match_duration_min} min · Rotation {t.rotation_duration_min} min · Terrains {t.num_fields}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => router.push(`/dashboard/tournaments`)}
                className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
              >
                Mes tournois
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                Sauvegarder
              </button>
            </div>
          </div>

          {status && <p className="text-sm mt-3 text-gray-600">{status}</p>}
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-xl font-semibold">Pauses tournoi</h2>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={pauseTournamentEnabled}
              onChange={(e) => setPauseTournamentEnabled(e.target.checked)}
            />
            Pause tournoi totale (tous terrains)
          </label>

          {pauseTournamentEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm text-gray-600 mb-1">De</div>
                <input className="w-full border rounded-lg p-2" type="time" value={pauseTournamentFrom}
                  onChange={(e) => setPauseTournamentFrom(e.target.value)} />
              </div>
              <div>
                <div className="text-sm text-gray-600 mb-1">À</div>
                <input className="w-full border rounded-lg p-2" type="time" value={pauseTournamentTo}
                  onChange={(e) => setPauseTournamentTo(e.target.value)} />
              </div>
            </div>
          )}

          <hr />

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={pauseTournamentExceptEnabled}
              onChange={(e) => setPauseTournamentExceptEnabled(e.target.checked)}
            />
            Pause tournoi sauf certains terrains (exceptions)
          </label>

          {pauseTournamentExceptEnabled && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-gray-600 mb-1">De</div>
                  <input className="w-full border rounded-lg p-2" type="time" value={pauseTournamentExceptFrom}
                    onChange={(e) => setPauseTournamentExceptFrom(e.target.value)} />
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">À</div>
                  <input className="w-full border rounded-lg p-2" type="time" value={pauseTournamentExceptTo}
                    onChange={(e) => setPauseTournamentExceptTo(e.target.value)} />
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-600 mb-1">
                  Terrains qui continuent (ex: 2,3)
                </div>
                <input
                  className="w-full border rounded-lg p-2"
                  value={pauseTournamentExceptFields}
                  onChange={(e) => setPauseTournamentExceptFields(e.target.value)}
                  placeholder="2,3"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Terrains existants: {fieldOptions.map((f) => `${f.idx}=${f.name}`).join(" · ")}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-xl font-semibold">Pauses par terrain</h2>

          {fieldOptions.map((f) => {
            const key = String(f.idx);
            const arr = fieldPauses[key] ?? [];
            return (
              <div key={key} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{f.name}</div>
                  <button
                    onClick={() => addFieldPause(f.idx)}
                    className="bg-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 transition text-sm"
                  >
                    + Pause
                  </button>
                </div>

                {arr.length === 0 && (
                  <div className="text-sm text-gray-500">Aucune pause sur ce terrain.</div>
                )}

                {arr.map((p, i) => (
                  <div key={i} className="grid grid-cols-5 gap-2 items-center">
                    <div className="col-span-2">
                      <input
                        className="w-full border rounded-lg p-2"
                        type="time"
                        value={p.from}
                        onChange={(e) => updateFieldPause(f.idx, i, { from: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        className="w-full border rounded-lg p-2"
                        type="time"
                        value={p.to}
                        onChange={(e) => updateFieldPause(f.idx, i, { to: e.target.value })}
                      />
                    </div>
                    <button
                      onClick={() => removeFieldPause(f.idx, i)}
                      className="bg-red-500 text-white px-3 py-2 rounded-lg hover:bg-red-600 transition text-sm"
                    >
                      Suppr
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <button
            onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/schedule`)}
            className="w-full bg-blue-600 text-white p-3 rounded-lg hover:bg-blue-700 transition"
          >
            Générer l’aperçu planning (Option B) →
          </button>
        </div>
      </div>
    </main>
  );
}