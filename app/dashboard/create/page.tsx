"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type Pause = { from: string; to: string };
type TournamentPause =
  | { type: "tournament"; from: string; to: string }
  | { type: "tournament_except"; from: string; to: string; exceptFields: number[] };

function clampInt(v: string, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export default function CreateTournamentPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");

  // Champs “pro”
  const [title, setTitle] = useState("DOPPI Cup");
  const [tournamentDate, setTournamentDate] = useState<string>(""); // YYYY-MM-DD
  const [minTeams, setMinTeams] = useState<string>("2");
  const [maxTeams, setMaxTeams] = useState<string>("24");

  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [matchDurationMin, setMatchDurationMin] = useState<string>("12");
  const [rotationDurationMin, setRotationDurationMin] = useState<string>("3");

  const [numFields, setNumFields] = useState<string>("2");
  const [fieldNames, setFieldNames] = useState<string[]>(["Terrain 1", "Terrain 2"]);

  const [minPlayersPerTeam, setMinPlayersPerTeam] = useState<string>("6");
  const [maxPlayersPerTeam, setMaxPlayersPerTeam] = useState<string>("7");

  // Pauses
  const [globalPauseFrom, setGlobalPauseFrom] = useState("");
  const [globalPauseTo, setGlobalPauseTo] = useState("");

  const [exceptPauseFrom, setExceptPauseFrom] = useState("");
  const [exceptPauseTo, setExceptPauseTo] = useState("");
  const [exceptFieldsCsv, setExceptFieldsCsv] = useState(""); // "1,3"

  // pauses par terrain: { "1": [{from,to}], "2": [...] }
  const [fieldPauses, setFieldPauses] = useState<Record<string, Pause[]>>({});

  const fieldCount = useMemo(() => Math.max(1, clampInt(numFields, 1)), [numFields]);

  // Maintenir fieldNames à la bonne taille
  useEffect(() => {
    setFieldNames((prev) => {
      const next = [...prev];
      while (next.length < fieldCount) next.push(`Terrain ${next.length + 1}`);
      while (next.length > fieldCount) next.pop();
      return next;
    });
  }, [fieldCount]);

  // Maintenir fieldPauses à la bonne taille
  useEffect(() => {
    setFieldPauses((prev) => {
      const next: Record<string, Pause[]> = { ...prev };
      for (let f = 1; f <= fieldCount; f++) {
        if (!next[String(f)]) next[String(f)] = [];
      }
      // supprimer clés inutiles
      for (const k of Object.keys(next)) {
        const idx = Number(k);
        if (!Number.isFinite(idx) || idx < 1 || idx > fieldCount) delete next[k];
      }
      return next;
    });
  }, [fieldCount]);

  function updateFieldName(i: number, v: string) {
    setFieldNames((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }

  function addFieldPause(fieldIdx: number) {
    setFieldPauses((prev) => {
      const key = String(fieldIdx);
      const arr = prev[key] ?? [];
      return { ...prev, [key]: [...arr, { from: "12:00", to: "12:30" }] };
    });
  }

  function updateFieldPause(fieldIdx: number, pauseIdx: number, key: "from" | "to", value: string) {
    setFieldPauses((prev) => {
      const fKey = String(fieldIdx);
      const arr = [...(prev[fKey] ?? [])];
      arr[pauseIdx] = { ...arr[pauseIdx], [key]: value };
      return { ...prev, [fKey]: arr };
    });
  }

  function removeFieldPause(fieldIdx: number, pauseIdx: number) {
    setFieldPauses((prev) => {
      const fKey = String(fieldIdx);
      const arr = [...(prev[fKey] ?? [])];
      arr.splice(pauseIdx, 1);
      return { ...prev, [fKey]: arr };
    });
  }

  function buildPausesPayload(): TournamentPause[] {
    const pauses: TournamentPause[] = [];

    if (globalPauseFrom && globalPauseTo) {
      pauses.push({ type: "tournament", from: globalPauseFrom, to: globalPauseTo });
    }

    if (exceptPauseFrom && exceptPauseTo) {
      const exceptFields = exceptFieldsCsv
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= fieldCount);

      pauses.push({
        type: "tournament_except",
        from: exceptPauseFrom,
        to: exceptPauseTo,
        exceptFields,
      });
    }

    return pauses;
  }

  function validateForm() {
    const minT = clampInt(minTeams, 2);
    const maxT = clampInt(maxTeams, 24);

    if (!title.trim()) return "Le titre est obligatoire.";
    if (minT < 2) return "min_teams doit être ≥ 2.";
    if (maxT < 2) return "max_teams doit être ≥ 2.";
    if (minT > maxT) return "min_teams ne peut pas être > max_teams.";
    if (endTime <= startTime) return "end_time doit être après start_time.";

    const minP = clampInt(minPlayersPerTeam, 1);
    const maxP = clampInt(maxPlayersPerTeam, 1);
    if (minP < 1) return "min joueurs/équipe doit être ≥ 1.";
    if (maxP < 1) return "max joueurs/équipe doit être ≥ 1.";
    if (minP > maxP) return "min joueurs/équipe ne peut pas être > max.";

    const md = clampInt(matchDurationMin, 1);
    const rd = clampInt(rotationDurationMin, 0);
    if (md < 1) return "Durée de match invalide.";
    if (rd < 0) return "Durée de rotation invalide.";

    return "";
  }

  async function createTournament() {
    const err = validateForm();
    if (err) {
      setStatus("Erreur: " + err);
      return;
    }

    setStatus("Création...");

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      router.push("/login");
      return;
    }

    const payload: any = {
      user_id: user.id,

      title: title.trim(),

      tournament_date: tournamentDate || null,
      min_teams: clampInt(minTeams, 2),
      max_teams: clampInt(maxTeams, 24),

      start_time: startTime,
      end_time: endTime,

      match_duration_min: clampInt(matchDurationMin, 12),
      rotation_duration_min: clampInt(rotationDurationMin, 3),

      num_fields: fieldCount,
      field_names: fieldNames,

      min_players_per_team: clampInt(minPlayersPerTeam, 6),
      max_players_per_team: clampInt(maxPlayersPerTeam, 7),

      pauses: buildPausesPayload(),
      field_pauses: fieldPauses,
    };

    const { data, error } = await supabase.from("tournaments").insert(payload).select("id").single();

    if (error) {
      setStatus("Erreur: " + error.message);
      return;
    }

    setStatus("Tournoi créé ✅");
    router.push(`/dashboard/tournaments/${data.id}/teams`);
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Créer un tournoi</h1>
            <p className="text-sm text-gray-500">Version “B” : min/max équipes + dates + horaires + pauses.</p>
          </div>
          <button
            onClick={() => router.push("/dashboard/tournaments")}
            className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
          >
            Mes tournois
          </button>
        </div>

        {status && <div className="bg-white rounded-xl shadow p-4 text-gray-700">{status}</div>}

        <div className="bg-white rounded-xl shadow p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600">Titre</label>
              <input
                className="w-full border rounded-lg p-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Date du tournoi</label>
              <input
                type="date"
                className="w-full border rounded-lg p-2"
                value={tournamentDate}
                onChange={(e) => setTournamentDate(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Min équipes (défaut 2)</label>
              <input
                type="number"
                className="w-full border rounded-lg p-2"
                value={minTeams}
                onChange={(e) => setMinTeams(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Max équipes (défaut 24)</label>
              <input
                type="number"
                className="w-full border rounded-lg p-2"
                value={maxTeams}
                onChange={(e) => setMaxTeams(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Heure début</label>
              <input
                type="time"
                className="w-full border rounded-lg p-2"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Heure fin</label>
              <input
                type="time"
                className="w-full border rounded-lg p-2"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Durée match (min)</label>
              <input
                type="number"
                className="w-full border rounded-lg p-2"
                value={matchDurationMin}
                onChange={(e) => setMatchDurationMin(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Durée rotation (min)</label>
              <input
                type="number"
                className="w-full border rounded-lg p-2"
                value={rotationDurationMin}
                onChange={(e) => setRotationDurationMin(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Min joueurs / équipe</label>
              <input
                type="number"
                className="w-full border rounded-lg p-2"
                value={minPlayersPerTeam}
                onChange={(e) => setMinPlayersPerTeam(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Max joueurs / équipe</label>
              <input
                type="number"
                className="w-full border rounded-lg p-2"
                value={maxPlayersPerTeam}
                onChange={(e) => setMaxPlayersPerTeam(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Nombre de terrains</label>
              <input
                type="number"
                className="w-full border rounded-lg p-2"
                value={numFields}
                onChange={(e) => setNumFields(e.target.value)}
              />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Noms des terrains</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldNames.map((n, i) => (
                <div key={i}>
                  <label className="text-sm text-gray-600">Terrain {i + 1}</label>
                  <input
                    className="w-full border rounded-lg p-2"
                    value={n}
                    onChange={(e) => updateFieldName(i, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Pause tournoi</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-600">Pause tournoi de</label>
                <input
                  type="time"
                  className="w-full border rounded-lg p-2"
                  value={globalPauseFrom}
                  onChange={(e) => setGlobalPauseFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">à</label>
                <input
                  type="time"
                  className="w-full border rounded-lg p-2"
                  value={globalPauseTo}
                  onChange={(e) => setGlobalPauseTo(e.target.value)}
                />
              </div>
            </div>

            <div className="font-semibold mt-3">Pause tournoi sauf terrain(s)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-sm text-gray-600">De</label>
                <input
                  type="time"
                  className="w-full border rounded-lg p-2"
                  value={exceptPauseFrom}
                  onChange={(e) => setExceptPauseFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">À</label>
                <input
                  type="time"
                  className="w-full border rounded-lg p-2"
                  value={exceptPauseTo}
                  onChange={(e) => setExceptPauseTo(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">Terrains autorisés (ex: 1,3)</label>
                <input
                  className="w-full border rounded-lg p-2"
                  value={exceptFieldsCsv}
                  onChange={(e) => setExceptFieldsCsv(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="font-semibold">Pauses par terrain</div>

            {Array.from({ length: fieldCount }, (_, idx) => {
              const fieldIdx = idx + 1;
              const pauses = fieldPauses[String(fieldIdx)] ?? [];
              return (
                <div key={fieldIdx} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{fieldNames[idx] ?? `Terrain ${fieldIdx}`}</div>
                    <button
                      onClick={() => addFieldPause(fieldIdx)}
                      className="bg-gray-100 px-3 py-2 rounded-lg hover:bg-gray-200 transition text-sm"
                      type="button"
                    >
                      + Ajouter pause
                    </button>
                  </div>

                  {pauses.length === 0 ? (
                    <div className="text-sm text-gray-500 mt-2">Aucune pause pour ce terrain.</div>
                  ) : (
                    <div className="space-y-2 mt-3">
                      {pauses.map((p, pIdx) => (
                        <div key={pIdx} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                          <div>
                            <label className="text-sm text-gray-600">De</label>
                            <input
                              type="time"
                              className="w-full border rounded-lg p-2"
                              value={p.from}
                              onChange={(e) => updateFieldPause(fieldIdx, pIdx, "from", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-sm text-gray-600">À</label>
                            <input
                              type="time"
                              className="w-full border rounded-lg p-2"
                              value={p.to}
                              onChange={(e) => updateFieldPause(fieldIdx, pIdx, "to", e.target.value)}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFieldPause(fieldIdx, pIdx)}
                            className="bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition"
                          >
                            Supprimer
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              onClick={createTournament}
              className="bg-blue-600 text-white px-5 py-3 rounded-lg hover:bg-blue-700 transition"
            >
              Créer le tournoi
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
