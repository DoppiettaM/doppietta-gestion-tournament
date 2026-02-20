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
  pauses: any;
  field_pauses: any;
};

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToTime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

export default function SchedulePreviewPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [t, setT] = useState<Tournament | null>(null);
  const [status, setStatus] = useState("Chargement...");
  const [horizonHours, setHorizonHours] = useState(6); // aperçu 6h
  const slotMinutes = useMemo(() => {
    if (!t) return 15;
    return Math.max(1, (t.match_duration_min ?? 12) + (t.rotation_duration_min ?? 0));
  }, [t]);

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

      setT(data as Tournament);
      setStatus("");
    }

    load();
  }, [router, tournamentId]);

  const slotsByField = useMemo(() => {
    if (!t) return [];

    const start = timeToMin(t.start_time || "09:00");
    const end = start + horizonHours * 60;

    const pausesArr = Array.isArray(t.pauses) ? t.pauses : [];
    const pTournament = pausesArr.find((p: any) => p?.type === "tournament");
    const pExcept = pausesArr.find((p: any) => p?.type === "tournament_except");

    const globalPauses: Pause[] = [];
    if (pTournament?.from && pTournament?.to) globalPauses.push({ from: pTournament.from, to: pTournament.to });

    const exceptPause = pExcept?.from && pExcept?.to
      ? { from: pExcept.from, to: pExcept.to, exceptFields: Array.isArray(pExcept.exceptFields) ? pExcept.exceptFields : [] }
      : null;

    const fieldPausesObj = t.field_pauses && typeof t.field_pauses === "object" ? t.field_pauses : {};

    const results: { fieldIdx: number; fieldName: string; slots: { start: string; status: "match" | "pause" }[] }[] =
      [];

    const fieldCount = t.num_fields ?? 1;
    const fieldNames = t.field_names ?? Array.from({ length: fieldCount }, (_, i) => `Terrain ${i + 1}`);

    for (let f = 1; f <= fieldCount; f++) {
      const fieldName = fieldNames[f - 1] ?? `Terrain ${f}`;

      const fp: Pause[] = Array.isArray(fieldPausesObj[String(f)])
        ? fieldPausesObj[String(f)].filter((x: any) => x?.from && x?.to).map((x: any) => ({ from: x.from, to: x.to }))
        : [];

      const slots: { start: string; status: "match" | "pause" }[] = [];

      for (let cur = start; cur < end; cur += slotMinutes) {
        const curEnd = cur + slotMinutes;

        // pause globale?
        let isPause = globalPauses.some((p) => overlaps(cur, curEnd, timeToMin(p.from), timeToMin(p.to)));

        // pause tournoi sauf terrains
        if (!isPause && exceptPause) {
          const inExceptWindow = overlaps(cur, curEnd, timeToMin(exceptPause.from), timeToMin(exceptPause.to));
          if (inExceptWindow) {
            // si le terrain n'est PAS dans exceptFields => pause
            const allowed = exceptPause.exceptFields.includes(f);
            if (!allowed) isPause = true;
          }
        }

        // pause spécifique terrain
        if (!isPause) {
          isPause = fp.some((p) => overlaps(cur, curEnd, timeToMin(p.from), timeToMin(p.to)));
        }

        slots.push({ start: minToTime(cur), status: isPause ? "pause" : "match" });
      }

      results.push({ fieldIdx: f, fieldName, slots });
    }

    return results;
  }, [t, horizonHours, slotMinutes]);

  if (!t) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">{status}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Planning: {t.title}</h1>
            <p className="text-sm text-gray-500">
              Début {t.start_time} · Slot = match ({t.match_duration_min}) + rotation ({t.rotation_duration_min}) = {slotMinutes} min
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${t.id}/settings`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Réglages
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Mes tournois
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <label className="text-sm text-gray-600">Aperçu sur (heures)</label>
          <input
            className="w-full"
            type="range"
            min={2}
            max={12}
            value={horizonHours}
            onChange={(e) => setHorizonHours(Number(e.target.value))}
          />
          <div className="text-sm text-gray-600 mt-1">{horizonHours} heures</div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {slotsByField.map((f) => (
            <div key={f.fieldIdx} className="bg-white rounded-xl shadow p-6">
              <h2 className="font-semibold mb-3">{f.fieldName}</h2>
              <div className="grid grid-cols-2 gap-2">
                {f.slots.map((s, i) => (
                  <div
                    key={i}
                    className={`rounded-lg p-2 text-sm flex items-center justify-between ${
                      s.status === "pause" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"
                    }`}
                  >
                    <span>{s.start}</span>
                    <span className="font-semibold">{s.status === "pause" ? "PAUSE" : "MATCH"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
          Ce planning est un aperçu “créneaux”. Prochaine étape (après C): remplir avec les matchs réels et appliquer les contraintes intelligentes (équité, pas 2 matchs au même horaire, etc.).
        </div>
      </div>
    </main>
  );
}