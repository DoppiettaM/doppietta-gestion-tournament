"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Pause = { from: string; to: string };
type TournamentPause = Pause & { type?: string; exceptFields?: number[] };
type Tournament = { id: string; title: string; display_label: string | null; start_time: string; end_time: string; match_duration_min: number; rotation_duration_min: number; num_fields: number; field_names: string[]; pauses: TournamentPause[] | null; field_pauses: Record<string, Pause[]> | null };
type Match = { id: string; tournament_id: string; start_time: string; field_idx: number; home_team_id: string | null; away_team_id: string | null; home_source_label: string | null; away_source_label: string | null; home: { name: string } | null; away: { name: string } | null; referee_label: string | null };
type Team = { id: string; name: string; tournament_id: string };
type SchedulingRules = { max_match_count_gap?: number; min_rest_slots?: number; prevent_simultaneous?: boolean; rest_policy?: string };
const hhmm = (value: string) => String(value ?? "").slice(0, 5);
const minutes = (value: string) => { const [h, m] = hhmm(value).split(":").map(Number); return h * 60 + m; };
const asTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart;

function isTournamentPaused(tournament: Tournament | undefined, fieldIdx: number, startTime: string) {
  if (!tournament) return false;
  const start = minutes(startTime); const end = start + Math.max(1, tournament.match_duration_min + tournament.rotation_duration_min);
  const pauses = Array.isArray(tournament.pauses) ? tournament.pauses : [];
  for (const pause of pauses) {
    if (!pause?.from || !pause?.to || !overlaps(start, end, minutes(pause.from), minutes(pause.to))) continue;
    if (pause.type === "tournament_except" && Array.isArray(pause.exceptFields) && pause.exceptFields.includes(fieldIdx)) continue;
    if (!pause.type || pause.type === "tournament" || pause.type === "tournament_except") return true;
  }
  const fieldPauses = tournament.field_pauses && typeof tournament.field_pauses === "object" ? tournament.field_pauses[String(fieldIdx)] : [];
  return Array.isArray(fieldPauses) && fieldPauses.some(pause => pause?.from && pause?.to && overlaps(start, end, minutes(pause.from), minutes(pause.to)));
}

export default function SharedChallengeSchedulePage() {
  const router = useRouter(); const challengeId = String(useParams().id);
  const [title, setTitle] = useState("Challenge"); const [shared, setShared] = useState(false); const [challengeFields, setChallengeFields] = useState<string[]>([]); const [referees, setReferees] = useState<string[]>([]); const [rules, setRules] = useState<SchedulingRules>({max_match_count_gap:1,min_rest_slots:1,prevent_simultaneous:true,rest_policy:"prefer_then_relax"}); const [tournaments, setTournaments] = useState<Tournament[]>([]); const [teams, setTeams] = useState<Team[]>([]); const [matches, setMatches] = useState<Match[]>([]); const [status, setStatus] = useState("Chargement...");
  async function refresh() {
    const { data: c, error: ce } = await supabase.from("challenges").select("title,shared_resources,field_names,referee_names,scheduling_rules").eq("id", challengeId).single(); if (ce) return setStatus("Erreur: " + ce.message);
    const { data: links, error: le } = await supabase.from("challenge_tournaments").select("tournament_id").eq("challenge_id", challengeId); if (le) return setStatus("Erreur: " + le.message);
    const ids = (links ?? []).map(link => link.tournament_id); if (!ids.length) return setStatus("Aucun tournoi associé.");
    const [{ data: ts, error: te }, { data: teamRows, error: teamError }, { data: ms, error: me }] = await Promise.all([
      supabase.from("tournaments").select("id,title,display_label,start_time,end_time,match_duration_min,rotation_duration_min,num_fields,field_names,pauses,field_pauses").in("id", ids),
      supabase.from("teams").select("id,name,tournament_id").in("tournament_id", ids),
      supabase.from("matches").select("id,tournament_id,start_time,field_idx,home_team_id,away_team_id,home_source_label,away_source_label,referee_label,home:home_team_id(name),away:away_team_id(name)").in("tournament_id", ids).order("start_time").order("field_idx")
    ]); if (te || teamError || me) return setStatus("Erreur: " + (te?.message ?? teamError?.message ?? me?.message));
    setTitle(c.title); setShared(c.shared_resources); setChallengeFields(Array.isArray(c.field_names)?c.field_names:[]); setReferees(Array.isArray(c.referee_names)&&c.referee_names.length?c.referee_names:Array.from({length:12},(_,i)=>`Arbitre ${i+1}`)); setRules(c.scheduling_rules&&typeof c.scheduling_rules==="object"?c.scheduling_rules:{max_match_count_gap:1,min_rest_slots:1,prevent_simultaneous:true,rest_policy:"prefer_then_relax"}); setTournaments((ts ?? []) as Tournament[]); setTeams((teamRows??[]) as Team[]); setMatches((ms ?? []) as unknown as Match[]); setStatus("");
  }
  useEffect(() => { supabase.auth.getUser().then(({ data }) => data.user ? refresh() : router.push("/login")); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [challengeId, router]);
  const tournamentMap = useMemo(() => new Map(tournaments.map(t => [t.id, t])), [tournaments]);
  const synchronizedPauses = useMemo(() => tournaments.flatMap(tournament => {
    const label = tournament.display_label ?? tournament.title;
    const global = (Array.isArray(tournament.pauses) ? tournament.pauses : []).filter(pause => pause?.from && pause?.to).map(pause => ({ key: `${tournament.id}-${pause.type}-${pause.from}-${pause.to}`, label, detail: pause.type === "tournament_except" ? `Pause générale sauf terrain(s) ${(pause.exceptFields ?? []).join(", ")}` : "Pause générale", from: hhmm(pause.from), to: hhmm(pause.to) }));
    const perField = Object.entries(tournament.field_pauses ?? {}).flatMap(([field, pauses]) => (Array.isArray(pauses) ? pauses : []).filter(pause => pause?.from && pause?.to).map(pause => ({ key: `${tournament.id}-field-${field}-${pause.from}-${pause.to}`, label, detail: `Pause terrain ${field}`, from: hhmm(pause.from), to: hhmm(pause.to) })));
    return [...global, ...perField];
  }).sort((a,b)=>minutes(a.from)-minutes(b.from)), [tournaments]);
  const conflicts = useMemo(() => { const map = new Map<string, Match[]>(); for (const match of matches) { const key = `${hhmm(match.start_time)}|${match.field_idx}`; map.set(key, [...(map.get(key) ?? []), match]); } return new Set(Array.from(map.entries()).filter(([, rows]) => rows.length > 1).map(([key]) => key)); }, [matches]);
  const pauseConflicts = useMemo(() => new Set(matches.filter(match => isTournamentPaused(tournamentMap.get(match.tournament_id),match.field_idx,hhmm(match.start_time))).map(match=>match.id)), [matches,tournamentMap]);
  const teamCounts = useMemo(() => { const map = new Map<string, { name: string; count: number }>(); for (const match of matches) for (const side of [{ id: match.home_team_id, name: match.home?.name }, { id: match.away_team_id, name: match.away?.name }]) if (side.id) map.set(side.id, { name: side.name ?? "Équipe", count: (map.get(side.id)?.count ?? 0) + 1 }); return Array.from(map.values()).sort((a, b) => a.count - b.count); }, [matches]);
  const consecutiveMatches = useMemo(() => {
    const slotMinutes = Math.max(1,...tournaments.map(t=>t.match_duration_min+t.rotation_duration_min));
    const appearances=new Map<string,Array<{time:number;tournamentId:string}>>();
    for(const match of matches) for(const teamId of [match.home_team_id,match.away_team_id].filter(Boolean) as string[]) appearances.set(teamId,[...(appearances.get(teamId)??[]),{time:minutes(match.start_time),tournamentId:match.tournament_id}]);
    const rows:Array<{key:string;team:string;mark:string;from:string;to:string}>=[];
    for(const [teamId,entries] of appearances){
      const ordered=[...entries].sort((a,b)=>a.time-b.time); const team=teams.find(t=>t.id===teamId);
      for(let i=1;i<ordered.length;i++) if(ordered[i].time>ordered[i-1].time&&ordered[i].time-ordered[i-1].time<=slotMinutes){
        const tournament=tournamentMap.get(ordered[i].tournamentId); rows.push({key:`${teamId}-${ordered[i-1].time}-${ordered[i].time}`,team:team?.name??"Équipe",mark:tournament?.display_label??tournament?.title??"",from:asTime(ordered[i-1].time),to:asTime(ordered[i].time)});
      }
    }
    return rows.sort((a,b)=>minutes(a.from)-minutes(b.from)||a.team.localeCompare(b.team,"fr"));
  },[matches,teams,tournaments,tournamentMap]);

  async function rebalance() {
    if (!shared || !tournaments.length) return setStatus("Activez d’abord « terrains et ressources partagés » dans le challenge.");
    if (!window.confirm("Réorganiser tous les matchs du challenge sur un planning commun sans conflit de terrain ?")) return;
    const start = Math.min(...tournaments.map(t => minutes(t.start_time))); const end = Math.max(...tournaments.map(t => minutes(t.end_time))); const slot = Math.max(...tournaments.map(t => t.match_duration_min + t.rotation_duration_min)); const fields = challengeFields.length || Math.max(...tournaments.map(t => t.num_fields));
    const slots: Array<{ start_time: string; field_idx: number }> = []; for (let time = start; time + slot <= end; time += slot) for (let field = 1; field <= fields; field++) slots.push({ start_time: asTime(time), field_idx: field });
    if (matches.length > slots.length) return setStatus(`Planning impossible: ${matches.length} matchs pour ${slots.length} créneaux communs.`);
    const ordered = [...matches].sort((a, b) => minutes(a.start_time) - minutes(b.start_time));
    const teamIds = teams.map(team=>team.id); const maxGap = 1; const minRest = Math.max(1,Number(rules.min_rest_slots??1));
    function buildPlan(allowConsecutive:boolean) {
      const remaining=[...ordered]; const counts=new Map(teamIds.map(id=>[id,0])); const lastRound=new Map<string,number>(); const placed:Array<{match:Match;slot:number}>=[];
      for(let round=0;round<Math.ceil(slots.length/fields)&&remaining.length;round++){
        const busy=new Set<string>();
        for(let fieldOffset=0;fieldOffset<fields&&remaining.length;fieldOffset++){
          const slotIndex=round*fields+fieldOffset; const slotRow=slots[slotIndex]; if(!slotRow)continue;
          let best=-1; let bestScore=Number.POSITIVE_INFINITY;
          for(let i=0;i<remaining.length;i++){
            const match=remaining[i]; const tournament=tournamentMap.get(match.tournament_id); if(isTournamentPaused(tournament,slotRow.field_idx,slotRow.start_time))continue;
            const participants=[match.home_team_id,match.away_team_id].filter(Boolean) as string[]; if(participants.some(id=>busy.has(id)))continue;
            const consecutive=participants.some(id=>round-(lastRound.get(id)??-9999)<=minRest); if(consecutive&&!allowConsecutive)continue;
            const nextCounts=teamIds.map(id=>(counts.get(id)??0)+(participants.includes(id)?1:0)); if(nextCounts.length&&Math.max(...nextCounts)-Math.min(...nextCounts)>maxGap)continue;
            const score=i+(consecutive?10000:0); if(score<bestScore){best=i;bestScore=score;}
          }
          if(best<0)continue;
          const [match]=remaining.splice(best,1); const participants=[match.home_team_id,match.away_team_id].filter(Boolean) as string[];
          for(const id of participants){busy.add(id);counts.set(id,(counts.get(id)??0)+1);lastRound.set(id,round);} placed.push({match,slot:slotIndex});
        }
      }
      return {placed,remaining,counts};
    }
    let plan=buildPlan(false); let restRelaxed=false; if(plan.remaining.length){plan=buildPlan(true);restRelaxed=true;}
    if(plan.remaining.length)return setStatus(`Répartition refusée : ${plan.remaining.length} match(s) ne peuvent pas être placés sans dépasser l’écart obligatoire d’un match entre les équipes.`);
    const placed=plan.placed;
    const finalCounts=Array.from(plan.counts.values()); if(finalCounts.length&&Math.max(...finalCounts)-Math.min(...finalCounts)>maxGap)return setStatus("Répartition refusée : contrôle final d’équité non conforme.");
    const names = referees.length?referees:Array.from({length:12},(_,i)=>`Arbitre ${i+1}`); if(names.length<fields)return setStatus(`Ajoutez au moins ${fields} arbitres pour couvrir les ${fields} terrains simultanément.`);
    const results = await Promise.all(placed.map(({ match, slot: index }, order) => supabase.from("matches").update({ ...slots[index], referee_team_id: null, referee_label: names[(Math.floor(index/fields)*fields+(index%fields))%names.length], schedule_order: order + 1 }).eq("id", match.id))); const error = results.find(x => x.error)?.error; if (error) return setStatus("Erreur: " + error.message); await refresh(); setStatus("Planning commun réorganisé sans collision de terrain ni d’arbitre.");
    setStatus(restRelaxed?"Planning conforme à l’équité stricte. Quelques enchaînements ont été conservés uniquement faute de planning complet avec récupération systématique.":"Planning conforme : équité stricte, aucun match simultané et au moins un créneau de récupération pour chaque équipe.");
  }

  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-7xl mx-auto space-y-4"><header className="bg-slate-950 text-white rounded-2xl p-6 flex justify-between gap-3 flex-wrap"><div><p className="text-amber-400 font-bold text-sm">RESSOURCES PARTAGÉES</p><h1 className="text-3xl font-black">Planning global · {title}</h1><p className="text-white/60">{matches.length} matchs · {conflicts.size} collision(s) de terrain · {pauseConflicts.size} match(s) sur une pause</p><p className="mt-1 text-amber-300">{consecutiveMatches.length} enchaînement(s) de deux matchs consécutifs à surveiller</p></div><div className="flex gap-2"><button onClick={rebalance} className="bg-amber-400 text-slate-950 px-4 py-2 rounded-xl font-bold">Répartir sans conflit</button><button onClick={() => router.push(`/dashboard/challenges/${challengeId}`)} className="bg-white/10 px-4 py-2 rounded-xl">← Challenge</button></div></header>
    {status && <div className="bg-white rounded-xl shadow p-4 text-amber-700">{status}</div>}
    <section className={`rounded-2xl border p-5 shadow ${consecutiveMatches.length?"border-amber-300 bg-amber-50":"border-emerald-200 bg-emerald-50"}`}><div className="flex items-center justify-between gap-3"><div><h2 className="font-black">Enchaînements à surveiller</h2><p className="text-sm text-gray-600">Information destinée à l’organisateur : ces enchaînements restent autorisés et ne bloquent pas le planning.</p></div><strong className={`rounded-full px-3 py-1 ${consecutiveMatches.length?"bg-amber-200 text-amber-900":"bg-emerald-200 text-emerald-900"}`}>{consecutiveMatches.length}</strong></div>{consecutiveMatches.length?<div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{consecutiveMatches.map(row=><div key={row.key} className="rounded-xl border border-amber-200 bg-white p-3 text-sm"><strong className="block break-words">{row.mark} {row.team}</strong><span className="text-amber-800">{row.from} → {row.to} · deux matchs de suite</span></div>)}</div>:<p className="mt-3 text-sm font-semibold text-emerald-800">Aucune équipe ne joue deux matchs de suite.</p>}</section>
    <section className="grid gap-3 md:grid-cols-3"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><strong>Équité obligatoire</strong><span className="block text-sm text-gray-600">Écart maximal enregistré : 1 match.</span></div><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><strong>Double présence interdite</strong><span className="block text-sm text-gray-600">Contrôle sur tous les terrains du challenge.</span></div><div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><strong>Récupération prioritaire</strong><span className="block text-sm text-gray-600">{Math.max(1,Number(rules.min_rest_slots??1))} créneau(x) sans jouer entre deux matchs, si réalisable.</span></div></section>
    <section className="rounded-2xl bg-white p-5 shadow"><div className="flex items-center justify-between gap-3"><div><h2 className="font-black">Pauses synchronisées</h2><p className="text-sm text-gray-500">Chargées automatiquement depuis les réglages de chaque tournoi et bloquées pendant la répartition.</p></div><strong className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">{synchronizedPauses.length}</strong></div>{synchronizedPauses.length>0?<div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{synchronizedPauses.map(pause=><div key={pause.key} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><strong>{pause.from} → {pause.to} · {pause.label}</strong><span className="block text-gray-600">{pause.detail}</span></div>)}</div>:<p className="mt-3 text-sm text-gray-500">Aucune pause renseignée dans les tournois du challenge.</p>}</section>
    <section className="grid lg:grid-cols-4 gap-4"><div className="lg:col-span-3 bg-white rounded-2xl shadow p-6 space-y-2">{matches.map(match => { const key = `${hhmm(match.start_time)}|${match.field_idx}`; const tournament = tournamentMap.get(match.tournament_id); const fieldName = challengeFields[match.field_idx - 1] ?? tournament?.field_names?.[match.field_idx - 1] ?? `Terrain ${match.field_idx}`; const onPause=pauseConflicts.has(match.id); return <div key={match.id} className={`border rounded-xl p-3 grid md:grid-cols-4 gap-2 ${conflicts.has(key)||onPause ? "border-red-400 bg-red-50" : ""}`}><strong>{hhmm(match.start_time)} · {fieldName}{onPause&&<small className="block text-red-700">⚠ Pause du tournoi</small>}</strong><span className="text-xs font-bold text-gray-500">{tournament?.display_label ?? tournament?.title}</span><span>{match.home?.name ?? match.home_source_label ?? "À déterminer"} — {match.away?.name ?? match.away_source_label ?? "À déterminer"}</span><span className="text-sm text-gray-500">Arbitre: {match.referee_label ?? "à attribuer"}</span></div>; })}</div><aside className="bg-white rounded-2xl shadow p-5"><h2 className="font-black">Équité des matchs</h2>{teamCounts.map(team => <div key={team.name} className="flex justify-between border-b py-2 text-sm"><span>{team.name}</span><strong>{team.count}</strong></div>)}</aside></section>
  </div></main>;
}
