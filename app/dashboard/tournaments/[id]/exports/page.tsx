"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type TournamentRow = {
  id: string;
  title: string | null;
  created_at: string | null;
};

type TeamRow = {
  id: string;
  name: string | null;
  email: string | null;
};

type PlayerRow = {
  id: string;
  team_id: string | null;
  first_name: string | null;
  last_name: string | null;
  jersey_number: number | null;
  license_number: string | null;
};

type MatchRow = {
  id: string;
  start_time: string | null;
  field_idx: number | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  home_team_id?: string;
  away_team_id?: string;
  home: { name: string | null } | null;
  away: { name: string | null } | null;
};

type EventRow = {
  id: string;
  created_at: string | null;
  event_type: string | null;
  minute: number | null;
  player: {
    first_name: string | null;
    last_name: string | null;
    jersey_number: number | null;
  } | null;
  team: { name: string | null } | null;
  match: {
    start_time: string | null;
    status: string | null;
    field_idx: number | null;
    home: { name: string | null } | null;
    away: { name: string | null } | null;
  } | null;
};

type StandingRow = {
  team_id: string;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
};

function hhmm(v: string | null) {
  if (!v) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const ms = Date.parse(v);
  if (!Number.isNaN(ms)) {
    return new Date(ms).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "";
}

function fullName(fn: string | null, ln: string | null) {
  const a = (fn ?? "").trim();
  const b = (ln ?? "").trim();
  return `${a} ${b}`.trim() || "Joueur";
}

function downloadText(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8"
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Record<string, any>[], headers: string[]) {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    const safe = s.replace(/"/g, '""');
    return `"${safe}"`;
  };
  const lines = [
    headers.map(esc).join(";"),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(";")),
  ];
  return lines.join("\n");
}

function computeStandingsFromPlayedMatches(matches: MatchRow[]) {
  const map = new Map<string, StandingRow>();

  const ensure = (id: string, name: string) => {
    const existing = map.get(id);
    if (existing) return existing;

    const row: StandingRow = {
      team_id: id,
      team_name: name || "Équipe",
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goals_for: 0,
      goals_against: 0,
      goal_diff: 0,
    };
    map.set(id, row);
    return row;
  };

  for (const m of matches) {
    const hs = typeof m.home_score === "number" ? m.home_score : null;
    const as = typeof m.away_score === "number" ? m.away_score : null;
    if (hs == null || as == null) continue;

    const homeId = String((m as any).home_team_id ?? "");
    const awayId = String((m as any).away_team_id ?? "");
    if (!homeId || !awayId) continue;

    const homeName = (m.home?.name ?? "").trim() || "Domicile";
    const awayName = (m.away?.name ?? "").trim() || "Extérieur";

    const H = ensure(homeId, homeName);
    const A = ensure(awayId, awayName);

    H.played += 1;
    A.played += 1;

    H.goals_for += hs;
    H.goals_against += as;

    A.goals_for += as;
    A.goals_against += hs;

    if (hs > as) {
      H.wins += 1;
      A.losses += 1;
      H.points += 3;
    } else if (hs < as) {
      A.wins += 1;
      H.losses += 1;
      A.points += 3;
    } else {
      H.draws += 1;
      A.draws += 1;
      H.points += 1;
      A.points += 1;
    }
  }

  for (const r of map.values()) {
    r.goal_diff = r.goals_for - r.goals_against;
  }

  const arr = Array.from(map.values());
  arr.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    return a.team_name.localeCompare(b.team_name);
  });

  return arr;
}

export default function ExportsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [tournament, setTournament] = useState<TournamentRow | null>(null);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data, error } = await supabase
        .from("tournaments")
        .select("id,title,created_at")
        .eq("id", tournamentId)
        .single();

      if (error) {
        setStatus("Erreur tournoi: " + error.message);
        return;
      }

      setTournament((data ?? null) as any);
      setStatus("");
    }
    load();
  }, [router, tournamentId]);

  async function exportTeamsCsv() {
    setStatus("Export équipes...");
    const { data, error } = await supabase
      .from("teams")
      .select("id,name,email")
      .eq("tournament_id", tournamentId)
      .order("name", { ascending: true });

    if (error) return setStatus("Erreur export équipes: " + error.message);

    const rows = (data ?? []) as any as TeamRow[];
    const csv = toCsv(
      rows.map((t) => ({ id: t.id, name: t.name ?? "", email: t.email ?? "" })),
      ["id", "name", "email"]
    );
    downloadText(`teams_${tournamentId}.csv`, csv, "text/csv;charset=utf-8");
    setStatus("");
  }

  async function exportPlayersCsv() {
    setStatus("Export joueurs...");
    const { data, error } = await supabase
      .from("players")
      .select("id,team_id,first_name,last_name,jersey_number,license_number")
      .eq("tournament_id", tournamentId)
      .order("team_id", { ascending: true });

    if (error) return setStatus("Erreur export joueurs: " + error.message);

    const rows = (data ?? []) as any as PlayerRow[];
    const csv = toCsv(
      rows.map((p) => ({
        id: p.id,
        team_id: p.team_id ?? "",
        first_name: p.first_name ?? "",
        last_name: p.last_name ?? "",
        jersey_number: p.jersey_number ?? "",
        license_number: p.license_number ?? "",
      })),
      ["id", "team_id", "first_name", "last_name", "jersey_number", "license_number"]
    );

    downloadText(`players_${tournamentId}.csv`, csv, "text/csv;charset=utf-8");
    setStatus("");
  }

  async function exportMatchesCsv() {
    setStatus("Export matchs...");
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (error) return setStatus("Erreur export matchs: " + error.message);

    const rows = (data ?? []) as any as MatchRow[];
    const csv = toCsv(
      rows.map((m) => ({
        id: m.id,
        start_time: m.start_time ?? "",
        hhmm: hhmm(m.start_time),
        field_idx: m.field_idx ?? "",
        status: m.status ?? "",
        home: m.home?.name ?? "",
        away: m.away?.name ?? "",
        home_score: m.home_score ?? "",
        away_score: m.away_score ?? "",
      })),
      ["id", "start_time", "hhmm", "field_idx", "status", "home", "away", "home_score", "away_score"]
    );

    downloadText(`matches_${tournamentId}.csv`, csv, "text/csv;charset=utf-8");
    setStatus("");
  }

  async function exportResultsCsv() {
    setStatus("Export résultats (validés)...");
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home:home_team_id(name),away:away_team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .eq("status", "played")
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (error) return setStatus("Erreur export résultats: " + error.message);

    const rows = (data ?? []) as any as MatchRow[];
    const csv = toCsv(
      rows.map((m) => ({
        id: m.id,
        hhmm: hhmm(m.start_time),
        field_idx: m.field_idx ?? "",
        home: m.home?.name ?? "",
        away: m.away?.name ?? "",
        home_score: m.home_score ?? "",
        away_score: m.away_score ?? "",
      })),
      ["id", "hhmm", "field_idx", "home", "away", "home_score", "away_score"]
    );

    downloadText(`results_${tournamentId}.csv`, csv, "text/csv;charset=utf-8");
    setStatus("");
  }

  async function exportEventsCsv() {
    setStatus("Export événements (validés)...");

    const { data, error } = await supabase
      .from("match_events")
      .select(
        "id,created_at,event_type,minute,player:player_id(first_name,last_name,jersey_number),team:team_id(name),match:match_id(start_time,status,field_idx,home:home_team_id(name),away:away_team_id(name))"
      )
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true });

    if (error) return setStatus("Erreur export événements: " + error.message);

    const all = (data ?? []) as any as EventRow[];
    const rows = all.filter((e) => (e.match?.status ?? "").toLowerCase() === "played");

    const csv = toCsv(
      rows.map((e) => ({
        id: e.id,
        created_at: e.created_at ?? "",
        event_type: e.event_type ?? "",
        minute: e.minute ?? "",
        player: `${fullName(e.player?.first_name ?? null, e.player?.last_name ?? null)}${
          e.player?.jersey_number != null ? ` #${e.player.jersey_number}` : ""
        }`,
        team: e.team?.name ?? "",
        match_time: hhmm(e.match?.start_time ?? null),
        field_idx: e.match?.field_idx ?? "",
        home: e.match?.home?.name ?? "",
        away: e.match?.away?.name ?? "",
      })),
      ["id", "created_at", "event_type", "minute", "player", "team", "match_time", "field_idx", "home", "away"]
    );

    downloadText(`events_played_${tournamentId}.csv`, csv, "text/csv;charset=utf-8");
    setStatus("");
  }

  async function exportResultsPdfSimple() {
    setStatus("Génération PDF résultats...");
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home:home_team_id(name),away:away_team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .eq("status", "played")
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (error) return setStatus("Erreur PDF: " + error.message);

    const rows = (data ?? []) as any as MatchRow[];

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const title = tournament?.title ?? "Tournoi";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`${title} — Résultats`, 40, 50);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, 40, 68);

    autoTable(doc, {
      startY: 90,
      head: [["Heure", "Terrain", "Domicile", "Score", "Extérieur"]],
      body: rows.map((m) => [
        hhmm(m.start_time),
        String(m.field_idx ?? ""),
        m.home?.name ?? "",
        `${m.home_score ?? ""} - ${m.away_score ?? ""}`,
        m.away?.name ?? "",
      ]),
      styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    doc.save(`results_${tournamentId}.pdf`);
    setStatus("");
  }

  async function exportTournamentFullPdf() {
    setStatus("Génération PDF Tournoi complet...");

    // 1) Récupère tous les matchs validés (avec ids équipes pour classement)
    const { data: playedData, error: playedErr } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .eq("status", "played")
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (playedErr) {
      setStatus("Erreur matchs validés: " + playedErr.message);
      return;
    }

    const playedMatches = (playedData ?? []) as any as MatchRow[];

    // 2) Classement calculé à la volée
    const standings = computeStandingsFromPlayedMatches(playedMatches);

    // 3) Top buteurs (goal) uniquement sur matchs validés
    const playedIds = playedMatches.map((m) => m.id).filter(Boolean);
    let topScorers: { name: string; goals: number }[] = [];

    if (playedIds.length > 0) {
      const { data: goalsData, error: goalsErr } = await supabase
        .from("match_events")
        .select("player_id,event_type,player:player_id(first_name,last_name)")
        .in("match_id", playedIds)
        .eq("event_type", "goal");

      if (!goalsErr) {
        const c = new Map<string, { name: string; goals: number }>();
        for (const g of goalsData ?? []) {
          const pid = String((g as any).player_id ?? "");
          if (!pid) continue;
          const p = (g as any).player;
          const name = fullName(p?.first_name ?? null, p?.last_name ?? null);
          const cur = c.get(pid) ?? { name, goals: 0 };
          cur.goals += 1;
          c.set(pid, cur);
        }
        topScorers = Array.from(c.values())
          .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
          .slice(0, 20);
      }
    }

    // PDF
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const title = tournament?.title ?? "Tournoi";

    // Page 1: couverture
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text(title, 40, 70);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Tournoi complet (matchs validés uniquement)`, 40, 95);
    doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, 40, 112);

    // Page 2: Résultats
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Résultats (validés)", 40, 60);

    autoTable(doc, {
      startY: 90,
      head: [["Heure", "Terrain", "Domicile", "Score", "Extérieur"]],
      body: playedMatches.map((m) => [
        hhmm(m.start_time),
        String(m.field_idx ?? ""),
        m.home?.name ?? "",
        `${m.home_score ?? ""} - ${m.away_score ?? ""}`,
        m.away?.name ?? "",
      ]),
      styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    // Page 3: Classement
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Classement (calculé)", 40, 60);

    autoTable(doc, {
      startY: 90,
      head: [["#", "Équipe", "Pts", "J", "G", "N", "P", "BP", "BC", "Diff"]],
      body: standings.map((s, idx) => [
        String(idx + 1),
        s.team_name,
        String(s.points),
        String(s.played),
        String(s.wins),
        String(s.draws),
        String(s.losses),
        String(s.goals_for),
        String(s.goals_against),
        String(s.goal_diff),
      ]),
      styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    // Page 4: Top buteurs
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Top buteurs", 40, 60);

    autoTable(doc, {
      startY: 90,
      head: [["#", "Joueur", "Buts"]],
      body: topScorers.map((p, idx) => [String(idx + 1), p.name, String(p.goals)]),
      styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    doc.save(`tournoi_complet_${tournamentId}.pdf`);
    setStatus("");
  }

  const titleLabel = useMemo(() => tournament?.title ?? tournamentId, [tournament, tournamentId]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Exports</h1>
            <p className="text-sm text-gray-500">
              Tournoi: <span className="font-semibold">{titleLabel}</span>
            </p>
            {status && <p className="text-sm text-amber-700 mt-2">{status}</p>}
          </div>

          <button
            onClick={() => router.push(`/dashboard/tournaments/${tournamentId}`)}
            className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
          >
            ← Retour
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <h2 className="font-semibold">Excel (CSV)</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={exportTeamsCsv} className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition">
              📤 Équipes (CSV)
            </button>

            <button onClick={exportPlayersCsv} className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition">
              📤 Joueurs (CSV)
            </button>

            <button onClick={exportMatchesCsv} className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition">
              📤 Matchs (CSV)
            </button>

            <button onClick={exportResultsCsv} className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition">
              📤 Résultats validés (CSV)
            </button>

            <button onClick={exportEventsCsv} className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition">
              📤 Événements validés (CSV)
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-2">
            CSV séparateur “;” (Excel FR). “Validés” = matchs status = played.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <h2 className="font-semibold">PDF</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={exportResultsPdfSimple}
              className="bg-black text-white px-4 py-3 rounded-lg hover:bg-gray-900 transition"
            >
              🧾 PDF Résultats (validés)
            </button>

            <button
              onClick={exportTournamentFullPdf}
              className="bg-black text-white px-4 py-3 rounded-lg hover:bg-gray-900 transition"
            >
              📘 PDF Tournoi complet
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-2">
            “Tournoi complet” calcule le classement à partir des matchs validés.
          </p>
        </div>
      </div>
    </main>
  );
}