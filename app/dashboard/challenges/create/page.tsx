"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { SCORING_LABELS, ScoringMode, TIE_BREAKER_LABELS, TieBreaker } from "@/lib/challenge";

type Tournament = { id: string; title: string | null; tournament_date: string | null };
const ALL_TIES: TieBreaker[] = ["points", "goals_scored", "goal_difference", "goals_conceded", "penalty_shootout", "draw"];

export default function CreateChallengePage() {
  const router = useRouter();
  const [title, setTitle] = useState("Challenge Doppietta");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<ScoringMode>("placement_points");
  const [points, setPoints] = useState<number[]>([10, 8, 6, 5, 4, 3, 2, 1]);
  const [ties, setTies] = useState<TieBreaker[]>(["points", "goal_difference", "goals_scored"]);
  const [shared, setShared] = useState(false);
  const [status, setStatus] = useState("");
  const selectedRows = useMemo(() => selected.map(id => tournaments.find(t => t.id === id)).filter(Boolean) as Tournament[], [selected, tournaments]);

  useEffect(() => { (async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/login");
    const { data, error } = await supabase.from("tournaments").select("id,title,tournament_date").order("created_at", { ascending: false });
    if (error) setStatus("Erreur: " + error.message); else setTournaments((data ?? []) as Tournament[]);
  })(); }, [router]);

  function toggleTournament(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 6 ? [...prev, id] : prev);
  }
  function toggleTie(rule: TieBreaker) {
    setTies(prev => prev.includes(rule) ? (prev.length > 3 ? prev.filter(x => x !== rule) : prev) : (prev.length < 5 ? [...prev, rule] : prev));
  }
  function moveTie(index: number, delta: number) {
    setTies(prev => { const next = [...prev]; const to = index + delta; if (to < 0 || to >= next.length) return prev; [next[index], next[to]] = [next[to], next[index]]; return next; });
  }

  async function create() {
    if (!title.trim()) return setStatus("Le nom du challenge est obligatoire.");
    if (selected.length < 2 || selected.length > 6) return setStatus("Sélectionnez entre 2 et 6 tournois.");
    if (ties.length < 3 || ties.length > 5) return setStatus("Choisissez entre 3 et 5 critères de départage.");
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return router.push("/login");
    setStatus("Création...");
    const { data, error } = await supabase.from("challenges").insert({ user_id: auth.user.id, title: title.trim(), scoring_mode: mode, default_points_by_rank: points, tie_breakers: ties, shared_resources: shared }).select("id").single();
    if (error) return setStatus("Erreur: " + error.message + " — vérifiez que la migration Supabase a été appliquée.");
    const links = selected.map((tournament_id, i) => ({ challenge_id: data.id, tournament_id, position: i + 1, points_by_rank: mode === "placement_points" ? points : null }));
    const { error: linkError } = await supabase.from("challenge_tournaments").insert(links);
    if (linkError) { await supabase.from("challenges").delete().eq("id", data.id); return setStatus("Erreur association: " + linkError.message); }
    router.push(`/dashboard/challenges/${data.id}`);
  }

  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-5xl mx-auto space-y-4">
    <header className="bg-slate-950 text-white rounded-2xl p-6"><p className="text-amber-400 font-bold text-sm">NOUVEAU</p><h1 className="text-3xl font-black">Créer un challenge</h1><p className="text-white/60 mt-1">Définissez les tournois et les règles avant le début de la compétition.</p></header>
    {status && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4">{status}</div>}
    <section className="bg-white rounded-2xl shadow p-6 space-y-4">
      <label className="block font-bold">Nom du challenge<input value={title} onChange={e => setTitle(e.target.value)} className="block w-full border rounded-xl px-4 py-3 mt-2" /></label>
      <div><h2 className="font-bold">Tournois ({selected.length}/6)</h2><p className="text-sm text-gray-500 mb-3">Sélectionnez au minimum deux tournois, dans l’ordre du challenge.</p><div className="grid md:grid-cols-2 gap-2">{tournaments.map(t => <label key={t.id} className={`border rounded-xl p-3 flex gap-3 cursor-pointer ${selected.includes(t.id) ? "border-amber-400 bg-amber-50" : ""}`}><input type="checkbox" checked={selected.includes(t.id)} disabled={!selected.includes(t.id) && selected.length >= 6} onChange={() => toggleTournament(t.id)} /><span><strong>{t.title ?? "Tournoi"}</strong><small className="block text-gray-500">{t.tournament_date ?? "Date non définie"}</small></span></label>)}</div></div>
      <div><h2 className="font-bold mb-2">Calcul du score du challenge</h2><div className="grid md:grid-cols-3 gap-2">{(Object.keys(SCORING_LABELS) as ScoringMode[]).map(key => <button key={key} onClick={() => setMode(key)} className={`border rounded-xl p-3 text-left text-sm ${mode === key ? "bg-slate-950 text-white" : ""}`}>{SCORING_LABELS[key]}</button>)}</div></div>
      {mode === "placement_points" && <div><h3 className="font-bold">Barème selon la place</h3><p className="text-sm text-gray-500 mb-2">Ce barème est enregistré pour chaque tournoi et pourra ensuite être personnalisé tournoi par tournoi.</p><div className="flex flex-wrap gap-2">{points.map((value, i) => <label key={i} className="text-xs text-center">{i + 1}e<input type="number" value={value} onChange={e => setPoints(p => p.map((x, j) => j === i ? Number(e.target.value) : x))} className="block w-16 border rounded-lg p-2 mt-1" /></label>)}</div></div>}
      <div><h2 className="font-bold">Départage ({ties.length}/5, minimum 3)</h2><p className="text-sm text-gray-500 mb-2">L’ordre ci-dessous est l’ordre d’application.</p><div className="space-y-2">{ties.map((rule, i) => <div key={rule} className="flex items-center justify-between border rounded-xl p-3"><span><strong>{i + 1}.</strong> {TIE_BREAKER_LABELS[rule]}</span><span><button onClick={() => moveTie(i, -1)} className="px-2">↑</button><button onClick={() => moveTie(i, 1)} className="px-2">↓</button><button onClick={() => toggleTie(rule)} className="px-2 text-red-600">×</button></span></div>)}</div><div className="flex flex-wrap gap-2 mt-2">{ALL_TIES.filter(x => !ties.includes(x)).map(rule => <button key={rule} onClick={() => toggleTie(rule)} disabled={ties.length >= 5} className="border rounded-lg px-3 py-2 text-sm disabled:opacity-40">＋ {TIE_BREAKER_LABELS[rule]}</button>)}</div></div>
      <label className="flex gap-3 border rounded-xl p-4"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /><span><strong>Terrains et ressources partagés</strong><small className="block text-gray-500">Le futur planning global arbitrera les créneaux entre tous les tournois du challenge.</small></span></label>
      <div className="bg-slate-50 border rounded-xl p-4"><strong>Résumé</strong><p className="text-sm text-gray-600">{selectedRows.map(t => t.title).join(" + ") || "Aucun tournoi sélectionné"}</p></div>
      <div className="flex justify-end gap-2"><button onClick={() => router.back()} className="bg-gray-200 px-4 py-3 rounded-xl">Annuler</button><button onClick={create} className="bg-amber-400 px-5 py-3 rounded-xl font-black">Créer le challenge</button></div>
    </section>
  </div></main>;
}

