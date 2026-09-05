"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { computeChallengeStandings, rankTournamentTeams, SCORING_LABELS, ScoringMode, TeamStats, TIE_BREAKER_LABELS, TieBreaker } from "@/lib/challenge";
import { rankMichelFinal, rankPhase, resolveMichelAssignments } from "@/lib/tournamentPhases";

type Challenge = { id: string; title: string; scoring_mode: ScoringMode; default_points_by_rank: number[]; tie_breakers: TieBreaker[]; shared_resources: boolean; field_names:string[]; referee_names:string[]; publish_standings:boolean };
type Link = { tournament_id: string; position: number; points_by_rank: number[] | null; tournament: { id: string; title: string; display_label?:string|null; format?:string|null; tournament_date: string | null; scoring_rules?: { win?: number; draw?: number; loss?: number; goal_bonus?: number } | null; start_time:string; end_time:string; match_duration_min:number; rotation_duration_min:number; num_fields:number; pauses:unknown; field_pauses:unknown; publish_standings:boolean } | null };
type Team = { id: string; tournament_id: string; name: string; challenge_name: string | null };
type Match = { id:string; tournament_id: string; match_number:number|null; stage:string|null; start_time:string; field_idx:number; referee_label:string|null; home_team_id: string|null; away_team_id: string|null; home_source_label:string|null; away_source_label:string|null; home_score: number | null; away_score: number | null; status: string };

export default function ChallengeDashboardPage() {
  const router = useRouter(); const params = useParams(); const challengeId = String(params.id);
  const [challenge, setChallenge] = useState<Challenge | null>(null); const [links, setLinks] = useState<Link[]>([]);
  const [teams, setTeams] = useState<Team[]>([]); const [matches, setMatches] = useState<Match[]>([]); const [scores,setScores]=useState<Record<string,{home:string;away:string}>>({}); const [status, setStatus] = useState("Chargement...");

  async function refresh() {
    const { data: c, error } = await supabase.from("challenges").select("id,title,scoring_mode,default_points_by_rank,tie_breakers,shared_resources,field_names,referee_names,publish_standings").eq("id", challengeId).single();
    if (error) return setStatus("Erreur challenge: " + error.message);
    const { data: l, error: le } = await supabase.from("challenge_tournaments").select("tournament_id,position,points_by_rank,tournament:tournament_id(id,title,display_label,format,tournament_date,scoring_rules,start_time,end_time,match_duration_min,rotation_duration_min,num_fields,pauses,field_pauses,publish_standings)").eq("challenge_id", challengeId).order("position");
    if (le) return setStatus("Erreur tournois: " + le.message);
    const linkRows = (l ?? []) as unknown as Link[]; const ids = linkRows.map(x => x.tournament_id);
    const [{ data: teamRows, error: te }, { data: matchRows, error: me }] = await Promise.all([
      supabase.from("teams").select("id,tournament_id,name,challenge_name").in("tournament_id", ids),
      supabase.from("matches").select("id,tournament_id,match_number,stage,start_time,field_idx,referee_label,home_team_id,away_team_id,home_source_label,away_source_label,home_score,away_score,status").in("tournament_id", ids).order("start_time").order("field_idx"),
    ]);
    if (te || me) return setStatus("Erreur données: " + (te?.message ?? me?.message));
    const loaded=(matchRows ?? []) as Match[]; setChallenge(c as Challenge); setLinks(linkRows); setTeams((teamRows ?? []) as Team[]); setMatches(loaded); setScores(Object.fromEntries(loaded.map(m=>[m.id,{home:m.home_score==null?"":String(m.home_score),away:m.away_score==null?"":String(m.away_score)}]))); setStatus("");
  }
  useEffect(() => { supabase.auth.getUser().then(({ data }) => data.user ? refresh() : router.push("/login")); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [router, challengeId]);

  const rankedTeams = useMemo(() => {
    const result: TeamStats[] = [];
    for (const link of links) {
      const subset = teams.filter(t => t.tournament_id === link.tournament_id);
      if(link.tournament?.format==="hybrid"){result.push(...rankMichelFinal(teams,matches.filter(m=>m.tournament_id===link.tournament_id),link.tournament_id,link.tournament.scoring_rules??{}));continue}
      const raw = subset.map(team => {
        let played = 0, points = 0, goalsFor = 0, goalsAgainst = 0;
        const rules = links.find(l => l.tournament_id === team.tournament_id)?.tournament?.scoring_rules ?? {};
        const win = Number(rules.win ?? 3), draw = Number(rules.draw ?? 1), loss = Number(rules.loss ?? 0), goalBonus = Number(rules.goal_bonus ?? 0);
        for (const m of matches.filter(x => x.tournament_id === link.tournament_id)) {
          if (m.status !== "played") continue;
          const home = m.home_team_id === team.id, away = m.away_team_id === team.id;
          if ((!home && !away) || m.home_score == null || m.away_score == null) continue;
          played++; const gf = home ? m.home_score : m.away_score; const ga = home ? m.away_score : m.home_score;
          goalsFor += gf; goalsAgainst += ga; points += (gf > ga ? win : gf === ga ? draw : loss) + gf * goalBonus;
        }
        return { id: team.id, name: team.name, challengeName: team.challenge_name?.trim() || team.name, tournamentId: team.tournament_id, played, points, goalsFor, goalsAgainst };
      });
      result.push(...rankTournamentTeams(raw));
    }
    return result;
  }, [teams, matches, links]);

  const standings = useMemo(() => {
    if (!challenge) return [];
    const overrides = Object.fromEntries(links.map(x => [x.tournament_id, x.points_by_rank ?? challenge.default_points_by_rank]));
    return computeChallengeStandings(rankedTeams, challenge.scoring_mode, challenge.default_points_by_rank, overrides, challenge.tie_breakers);
  }, [challenge, links, rankedTeams]);

  const teamName=(id:string|null,label:string|null)=>teams.find(t=>t.id===id)?.name??label??"À déterminer";
  async function saveMatch(match:Match,validate:boolean){
    const edit=scores[match.id]??{home:"",away:""}; const home=edit.home===""?null:Number(edit.home),away=edit.away===""?null:Number(edit.away);
    if(validate&&(home==null||away==null))return setStatus("Renseignez les deux scores avant validation.");
    const referee=match.referee_label??challenge?.referee_names?.[0]??"Arbitre 1";
    const {error}=await supabase.from("matches").update({home_score:home,away_score:away,status:validate?"played":"scheduled",referee_label:referee}).eq("id",match.id); if(error)return setStatus("Erreur score: "+error.message);
    if(validate){
      const tournamentTeams=teams.filter(t=>t.tournament_id===match.tournament_id); const tournamentMatches=matches.map(m=>m.id===match.id?{...m,home_score:home,away_score:away,status:"played"}:m).filter(m=>m.tournament_id===match.tournament_id);
      const rules=links.find(l=>l.tournament_id===match.tournament_id)?.tournament?.scoring_rules??{};
      const phaseOne=rankPhase(tournamentTeams,tournamentMatches,match.tournament_id,rules,["group","league","phase_1"]);
      const assignments=resolveMichelAssignments(phaseOne,tournamentMatches);
      await Promise.all(assignments.map(row=>supabase.from("matches").update({home_team_id:row.home_team_id,away_team_id:row.away_team_id}).eq("id",row.id)));
    }
    await refresh(); setStatus(validate?"Score validé et phase suivante actualisée.":"Score enregistré en brouillon.");
  }
  async function changeReferee(matchId:string,name:string){const {error}=await supabase.from("matches").update({referee_label:name||null,referee_team_id:null}).eq("id",matchId);if(error)return setStatus("Erreur arbitre: "+error.message);setMatches(p=>p.map(m=>m.id===matchId?{...m,referee_label:name}:m));}

  async function setStandingsPublication(target:"challenge"|"tournament",id:string,published:boolean){
    const table=target==="challenge"?"challenges":"tournaments";
    const {error}=await supabase.from(table).update({publish_standings:published}).eq("id",id);
    if(error)return setStatus("Erreur de publication : "+error.message);
    await refresh();
    setStatus(published?"Classement publié sur l’écran public.":"Classement masqué sur l’écran public.");
  }

  const toMinutes=(value:string)=>{const [hour,minute]=String(value).slice(0,5).split(":").map(Number);return hour*60+minute};
  const toTime=(value:number)=>`${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
  function fieldPaused(tournament:NonNullable<Link["tournament"]>,field:number,start:string){
    const minute=toMinutes(start),slot=Math.max(1,Number(tournament.match_duration_min??12)+Number(tournament.rotation_duration_min??0));
    const overlaps=(from:string,to:string)=>minute<toMinutes(to)&&toMinutes(from)<minute+slot;
    const pauses=Array.isArray(tournament.pauses)?tournament.pauses as Array<{type?:string;from?:string;to?:string;exceptFields?:number[]}>:[];
    if(pauses.some(p=>p.from&&p.to&&p.type==="tournament"&&overlaps(p.from,p.to)))return true;
    if(pauses.some(p=>p.from&&p.to&&p.type==="tournament_except"&&!p.exceptFields?.includes(field)&&overlaps(p.from,p.to)))return true;
    const perField=tournament.field_pauses&&typeof tournament.field_pauses==="object"?tournament.field_pauses as Record<string,Array<{from:string;to:string}>>:{};
    return (perField[String(field)]??[]).some(p=>p.from&&p.to&&overlaps(p.from,p.to));
  }

  async function generateMichelPhaseTwo(link:Link){
    const tournament=link.tournament;
    if(!tournament||tournament.format!=="hybrid")return setStatus("Ce tournoi n’utilise pas le format hybride.");
    const tournamentMatches=matches.filter(m=>m.tournament_id===link.tournament_id);
    const phaseOne=tournamentMatches.filter(m=>["group","league","phase_1"].includes(m.stage??""));
    if(phaseOne.length!==45)return setStatus(`La phase 1 doit contenir exactement 45 matchs (${phaseOne.length}/45 actuellement).`);
    if(!phaseOne.every(m=>m.status==="played"&&m.home_score!=null&&m.away_score!=null))return setStatus("Tous les résultats de la phase 1 doivent être validés avant de générer la phase 2.");
    if(tournamentMatches.some(m=>String(m.stage??"").startsWith("phase_2")))return setStatus("La phase 2 de ce tournoi existe déjà.");
    const tournamentTeams=teams.filter(team=>team.tournament_id===link.tournament_id);
    const ranking=rankPhase(tournamentTeams,phaseOne,link.tournament_id,tournament.scoring_rules??{},["group","league","phase_1"]);
    if(ranking.length<10)return setStatus("Le classement de phase 1 ne contient pas les 10 équipes attendues.");
    const teamAt=(rank:number)=>ranking[rank-1]?.id??null;
    const definitions=[
      {n:46,round:0,home:teamAt(1),away:teamAt(4),h:"1er de la phase 1",a:"4e de la phase 1",stage:"phase_2_knockout",destination:"final_table",label:"Demi-finale"},
      {n:47,round:0,home:teamAt(2),away:teamAt(3),h:"2e de la phase 1",a:"3e de la phase 1",stage:"phase_2_knockout",destination:"final_table",label:"Demi-finale"},
      {n:48,round:1,home:teamAt(5),away:teamAt(6),h:"5e de la phase 1",a:"6e de la phase 1",stage:"phase_2_group_a",destination:"group_a",label:"Poule places 5 à 7"},
      {n:51,round:1,home:teamAt(8),away:teamAt(9),h:"8e de la phase 1",a:"9e de la phase 1",stage:"phase_2_group_b",destination:"group_b",label:"Poule places 8 à 10"},
      {n:49,round:2,home:teamAt(7),away:teamAt(5),h:"7e de la phase 1",a:"5e de la phase 1",stage:"phase_2_group_a",destination:"group_a",label:"Poule places 5 à 7"},
      {n:52,round:2,home:teamAt(10),away:teamAt(8),h:"10e de la phase 1",a:"8e de la phase 1",stage:"phase_2_group_b",destination:"group_b",label:"Poule places 8 à 10"},
      {n:50,round:3,home:teamAt(6),away:teamAt(7),h:"6e de la phase 1",a:"7e de la phase 1",stage:"phase_2_group_a",destination:"group_a",label:"Poule places 5 à 7"},
      {n:53,round:3,home:teamAt(9),away:teamAt(10),h:"9e de la phase 1",a:"10e de la phase 1",stage:"phase_2_group_b",destination:"group_b",label:"Poule places 8 à 10"},
      {n:54,round:4,home:null,away:null,h:"Perdant M46",a:"Perdant M47",stage:"phase_2_knockout",destination:"final_table",label:"Petite finale"},
      {n:55,round:4,home:null,away:null,h:"Vainqueur M46",a:"Vainqueur M47",stage:"phase_2_knockout",destination:"final_table",label:"Finale"},
    ];
    const slot=Math.max(1,Number(tournament.match_duration_min??12)+Number(tournament.rotation_duration_min??0));
    const lastPhaseOne=Math.max(...phaseOne.map(m=>toMinutes(m.start_time)));
    const occupied=new Set(matches.map(m=>`${String(m.start_time).slice(0,5)}|${m.field_idx}`));
    const roundSlots=new Map<number,Array<{time:string;field:number}>>();
    let cursor=lastPhaseOne+slot;
    for(let round=0;round<5;round++){
      let found:Array<{time:string;field:number}>=[];
      while(cursor<=toMinutes(tournament.end_time)){
        const time=toTime(cursor);
        found=Array.from({length:challenge?.field_names?.length||tournament.num_fields||1},(_,index)=>index+1).filter(field=>!occupied.has(`${time}|${field}`)&&!fieldPaused(tournament,field,time)).slice(0,2).map(field=>({time,field}));
        if(found.length===2)break;
        cursor+=slot;
      }
      if(found.length<2)return setStatus("Pas assez de créneaux libres pour placer les cinq tours de la phase 2.");
      roundSlots.set(round,found); found.forEach(s=>occupied.add(`${s.time}|${s.field}`)); cursor+=slot;
    }
    const counters=new Map<number,number>();
    const rows=definitions.map(def=>{const index=counters.get(def.round)??0;counters.set(def.round,index+1);const position=roundSlots.get(def.round)![index];return{tournament_id:link.tournament_id,home_team_id:def.home,away_team_id:def.away,field_idx:position.field,start_time:position.time,match_number:def.n,stage:def.stage,phase_key:"phase_2",destination_key:def.destination,round_label:def.label,home_source_label:def.h,away_source_label:def.a,schedule_order:def.n,referee_label:null,referee_team_id:null}});
    const {error}=await supabase.from("matches").insert(rows);
    if(error)return setStatus("Erreur de génération de la phase 2 : "+error.message);
    await refresh();setStatus("Phase 2 générée : demi-finales, poules 5–7 et 8–10, petite finale et finale.");
  }

  const challengeFinalReady=links.length>0&&links.every(link=>{const phaseTwo=matches.filter(m=>m.tournament_id===link.tournament_id&&String(m.stage??"").startsWith("phase_2"));return phaseTwo.length===10&&phaseTwo.every(m=>m.status==="played"&&m.home_score!=null&&m.away_score!=null)});

  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-7xl mx-auto space-y-4">
    <header className="bg-slate-950 text-white rounded-2xl shadow p-6 flex justify-between gap-4 flex-wrap"><div><p className="text-amber-400 font-bold text-sm">DASHBOARD CHALLENGE</p><h1 className="text-3xl font-black">🏆 {challenge?.title ?? "Challenge"}</h1>{challenge && <p className="text-white/60 mt-1">{SCORING_LABELS[challenge.scoring_mode]} · {challenge.shared_resources ? "ressources partagées" : "ressources séparées"}</p>}</div><div className="flex gap-2 items-start flex-wrap"><button onClick={() => router.push(`/dashboard/challenges/${challengeId}/settings`)} className="bg-white text-slate-950 font-bold px-4 py-2 rounded-xl">Réglages & affichage</button><button onClick={() => window.open(`/challenges/${challengeId}/screen`, "_blank")} className="bg-sky-500 text-white font-bold px-4 py-2 rounded-xl">🖥 Écran public</button><button onClick={() => window.open(`/challenges/${challengeId}/screen/mobile`, "_blank")} className="bg-violet-500 text-white font-bold px-4 py-2 rounded-xl">📱 Affichage smartphone</button><button onClick={() => router.push(`/dashboard/challenges/${challengeId}/schedule`)} className="bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-xl">Planning global</button><button onClick={refresh} className="bg-white/10 px-4 py-2 rounded-xl">↻ Actualiser</button><button onClick={() => router.push("/dashboard/challenges")} className="bg-white/10 px-4 py-2 rounded-xl">← Challenges</button></div></header>
    {status && <div className="bg-white rounded-xl shadow p-4 text-amber-700">{status}</div>}
    <section className="grid lg:grid-cols-3 gap-4"><div className="lg:col-span-2 bg-white rounded-2xl shadow p-6"><div className="flex justify-between mb-4 gap-3 flex-wrap"><div><h2 className="font-black text-xl">Classement général</h2><span className="text-sm text-gray-500">{standings.length} clubs</span></div><button disabled={!challengeFinalReady&&!challenge?.publish_standings} onClick={()=>challenge&&setStandingsPublication("challenge",challenge.id,!challenge.publish_standings)} className={`rounded-xl px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-45 ${challenge?.publish_standings?"bg-emerald-600 text-white":"bg-slate-200 text-slate-700"}`}>{challenge?.publish_standings?"Publié sur l’écran":challengeFinalReady?"Publier le classement du challenge":"Publication après les deux phases 2"}</button></div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-gray-500"><th className="p-2">#</th><th>Nom challenge</th><th>Score</th><th>Tournois</th><th>Pts matchs</th><th>BP</th><th>BC</th><th>Diff.</th></tr></thead><tbody>{standings.map((row, i) => <tr key={row.name} className="border-b"><td className="p-2 font-black">{i + 1}</td><td className="font-bold">{row.name}<small className="block font-normal text-gray-400">{row.details.map(d => `${d.teamName}: ${d.score}`).join(" · ")}</small></td><td className="font-black text-amber-600">{row.score}</td><td>{row.tournamentsPlayed}</td><td>{row.tournamentPoints}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td></tr>)}</tbody></table>{!status && standings.length === 0 && <p className="text-gray-500 py-8 text-center">Ajoutez aux équipes un « nom d’équipe pour le challenge » et validez des matchs pour alimenter le classement.</p>}</div></div>
      <aside className="bg-white rounded-2xl shadow p-6"><h2 className="font-black text-xl mb-3">Règlement</h2><p className="text-sm font-semibold">Départage dans l’ordre :</p><ol className="mt-2 space-y-2">{challenge?.tie_breakers.map((rule, i) => <li key={rule} className="bg-slate-50 rounded-xl p-3"><strong>{i + 1}.</strong> {TIE_BREAKER_LABELS[rule]}</li>)}</ol></aside></section>
    <section className="bg-white rounded-2xl shadow p-6"><h2 className="font-black text-xl mb-4">Tournois du challenge ({links.length}/6)</h2><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{links.map(link => <button key={link.tournament_id} onClick={() => router.push(`/dashboard/tournaments/${link.tournament_id}`)} className="border rounded-xl p-4 text-left hover:border-amber-400"><span className="text-xs text-gray-400">TOURNOI {link.position}</span><strong className="block mt-1">{link.tournament?.title ?? link.tournament_id}</strong><small className="text-gray-500">{link.tournament?.tournament_date ?? "Date non définie"}</small></button>)}</div></section>
    <section className="bg-white rounded-2xl shadow p-6"><div className="mb-4"><h2 className="font-black text-xl">Passage en phase 2 et publication</h2><p className="text-sm text-gray-500">La génération devient disponible uniquement lorsque les 45 scores de phase 1 sont validés.</p></div><div className="grid gap-3 md:grid-cols-2">{links.map(link=>{const phaseOne=matches.filter(m=>m.tournament_id===link.tournament_id&&["group","league","phase_1"].includes(m.stage??""));const completed=phaseOne.length===45&&phaseOne.every(m=>m.status==="played"&&m.home_score!=null&&m.away_score!=null);const generated=matches.some(m=>m.tournament_id===link.tournament_id&&String(m.stage??"").startsWith("phase_2"));return <article key={link.tournament_id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><strong className="text-lg">{link.tournament?.display_label??link.tournament?.title}</strong><p className="text-xs text-gray-500">Phase 1 : {phaseOne.filter(m=>m.status==="played"&&m.home_score!=null&&m.away_score!=null).length}/45 résultats</p></div><button onClick={()=>setStandingsPublication("tournament",link.tournament_id,!link.tournament?.publish_standings)} className={`rounded-lg px-3 py-2 text-xs font-black ${link.tournament?.publish_standings?"bg-emerald-600 text-white":"bg-slate-200"}`}>{link.tournament?.publish_standings?"Classement publié":"Publier le classement"}</button></div><button disabled={!completed||generated} onClick={()=>generateMichelPhaseTwo(link)} className="mt-4 w-full rounded-lg bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400">{generated?"Phase 2 déjà générée":completed?"Générer la phase 2":"En attente de tous les résultats"}</button></article>})}</div></section>
    <section className="bg-white rounded-2xl shadow p-6 space-y-4"><div><h2 className="font-black text-xl">Régie des scores du challenge</h2><p className="text-sm text-gray-500">Saisissez et validez ici les scores des deux tournois. La validation déplace immédiatement le match dans « matchs réalisés » sur l’écran public et actualise les reversements de phase 2.</p></div><div className="space-y-3">{matches.map(match=>{const tournament=links.find(l=>l.tournament_id===match.tournament_id)?.tournament;const edit=scores[match.id]??{home:"",away:""};return <article key={match.id} className={`grid gap-3 rounded-xl border p-4 lg:grid-cols-[110px_1fr_190px_170px] ${match.status==="played"?"bg-emerald-50 border-emerald-200":""}`}><div><strong>M{match.match_number??"—"} · {String(match.start_time).slice(0,5)}</strong><small className="block text-gray-500">{tournament?.display_label??tournament?.title} · {challenge?.field_names?.[match.field_idx-1]??`Terrain ${match.field_idx}`}</small></div><div className="grid grid-cols-[1fr_64px_20px_64px_1fr] items-center gap-2 text-center"><strong className="break-words text-right">{teamName(match.home_team_id,match.home_source_label)}</strong><input type="number" min={0} className="rounded-lg border p-2 text-center font-black" value={edit.home} onChange={e=>setScores(p=>({...p,[match.id]:{...edit,home:e.target.value}}))}/><span>–</span><input type="number" min={0} className="rounded-lg border p-2 text-center font-black" value={edit.away} onChange={e=>setScores(p=>({...p,[match.id]:{...edit,away:e.target.value}}))}/><strong className="break-words text-left">{teamName(match.away_team_id,match.away_source_label)}</strong></div><select className="rounded-lg border p-2" value={match.referee_label??""} onChange={e=>changeReferee(match.id,e.target.value)}><option value="">Arbitre à attribuer</option>{(challenge?.referee_names??[]).map(name=><option key={name}>{name}</option>)}</select><div className="flex gap-2"><button onClick={()=>saveMatch(match,false)} className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-bold">Brouillon</button><button onClick={()=>saveMatch(match,match.status!=="played")} className={`rounded-lg px-3 py-2 text-sm font-black ${match.status==="played"?"bg-amber-200":"bg-emerald-600 text-white"}`}>{match.status==="played"?"Rouvrir":"Valider"}</button></div></article>})}</div></section>
  </div></main>;
}
