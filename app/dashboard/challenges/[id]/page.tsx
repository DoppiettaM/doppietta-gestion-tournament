"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { aggregateClipetChallenge, computeClipetFinalRanking, type TeamSeed, type Result } from "@/lib/tournamentEngine";

type Tournament = { id:string; title:string; category:string|null; competition_config:any };
type Team = TeamSeed;

export default function ChallengeDetail(){
  const p=useParams(); const r=useRouter(); const cid=String(p.id);
  const [name,setName]=useState("Challenge"); const [tournaments,setTournaments]=useState<Tournament[]>([]);
  const [teamsByTournament,setTeamsByTournament]=useState<Record<string,Team[]>>({});
  const [matchesByTournament,setMatchesByTournament]=useState<Record<string,Result[]>>({}); const [status,setStatus]=useState("Chargement…");

  async function load(){
    const {data:u}=await supabase.auth.getUser(); if(!u.user){r.push('/login');return;}
    const [c,tr]=await Promise.all([
      supabase.from('challenges').select('id,name,template').eq('id',cid).single(),
      supabase.from('tournaments').select('id,title,category,competition_config').eq('challenge_id',cid).order('category')
    ]);
    if(c.error){setStatus(c.error.message);return;} setName(c.data.name); const ts=(tr.data??[]) as Tournament[]; setTournaments(ts);
    const tb:Record<string,Team[]>={}; const mb:Record<string,Result[]>={};
    for(const t of ts){
      const [te,ma]=await Promise.all([
        supabase.from('teams').select('id,name,club_name,team_number,disqualified,tie_break_lot').eq('tournament_id',t.id),
        supabase.from('matches').select('id,match_number,phase_key,status,home_team_id,away_team_id,home_score,away_score,penalty_home,penalty_away').eq('tournament_id',t.id)
      ]);
      tb[t.id]=(te.data??[]).map((x:any)=>({id:x.id,name:x.name,clubName:x.club_name,teamNumber:x.team_number,disqualified:x.disqualified,tieBreakLot:x.tie_break_lot}));
      mb[t.id]=(ma.data??[]).map((x:any)=>({id:x.id,matchNumber:x.match_number,phaseKey:x.phase_key,status:x.status,homeTeamId:x.home_team_id,awayTeamId:x.away_team_id,homeScore:Number(x.home_score??NaN),awayScore:Number(x.away_score??NaN),penaltyHome:x.penalty_home,penaltyAway:x.penalty_away}));
    }
    setTeamsByTournament(tb); setMatchesByTournament(mb); setStatus('');
  }
  useEffect(()=>{load()},[cid]);

  const categoryResults=useMemo(()=>tournaments.map(t=>{
    const teams=teamsByTournament[t.id]??[]; const final=computeClipetFinalRanking(teams,matchesByTournament[t.id]??[]);
    return {category:t.category??t.title,ranking:final.complete?final.ranking:[],teams,complete:final.complete,reason:final.reason,tournament:t};
  }),[tournaments,teamsByTournament,matchesByTournament]);
  const completeCategories=categoryResults.filter(x=>x.complete);
  const allComplete=categoryResults.length>0&&completeCategories.length===categoryResults.length;
  const overall=useMemo(()=>aggregateClipetChallenge(completeCategories.map(x=>({category:x.category,ranking:x.ranking,teams:x.teams}))),[categoryResults]);

  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-6xl mx-auto space-y-4">
    <div className="bg-white rounded-2xl shadow p-6 flex justify-between gap-3 flex-wrap"><div><div className="text-sm text-blue-600 font-bold">Challenge multi-tournois</div><h1 className="text-2xl font-black">{name}</h1><p className="text-sm text-slate-500">Classement général calculé automatiquement à partir des classements finaux U8/U9.</p></div><div className="flex gap-2"><button onClick={()=>r.push('/dashboard/challenges')} className="bg-slate-200 rounded-xl px-4 py-2">Retour</button><button onClick={load} className="bg-slate-900 text-white rounded-xl px-4 py-2">Actualiser</button></div></div>
    {status&&<div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">{status}</div>}
    <div className="grid md:grid-cols-2 gap-4">{categoryResults.map(x=>{const byId=new Map(x.teams.map(t=>[t.id,t]));return <div key={x.tournament.id} className="bg-white rounded-2xl shadow p-5"><div className="flex justify-between gap-2"><div><div className="font-black text-xl">{x.category}</div><div className="text-sm text-slate-500">{x.tournament.title}</div></div><button onClick={()=>r.push(`/dashboard/tournaments/${x.tournament.id}/clipet`)} className="bg-blue-600 text-white rounded-xl px-3 py-2 text-sm font-bold">Piloter</button></div><div className={`mt-4 text-sm font-bold ${x.complete?'text-green-700':'text-amber-700'}`}>{x.complete?'Classement final disponible':`En attente : ${x.reason}`}</div>{x.complete&&<div className="mt-3 space-y-1">{x.ranking.map((teamId,i)=><div key={teamId} className="flex justify-between gap-2 border-b py-1 text-sm"><span><b>{i+1}.</b> {byId.get(teamId)?.name??'Équipe'}</span><b>{byId.get(teamId)?.disqualified?0:20-i} pt{20-i>1?'s':''}</b></div>)}</div>}</div>})}</div>
    <div className="bg-white rounded-2xl shadow p-5"><div className="flex items-center gap-2 flex-wrap"><h2 className="font-black text-xl">🏆 Classement général du Challenge</h2>{overall.length>0&&<span className={`text-xs px-2 py-1 rounded-full font-bold ${allComplete?'bg-green-100 text-green-800':'bg-amber-100 text-amber-800'}`}>{allComplete?'FINAL':'PROVISOIRE'}</span>}</div><p className="text-sm text-slate-500 mt-1">Association automatique par nom de club + numéro d'équipe. Une équipe absente/disqualifiée vaut 0 point. Tant que tous les tournois ne sont pas terminés, le classement reste provisoire.</p>{overall.length===0?<p className="mt-4 text-slate-500">Le classement apparaîtra dès qu'au moins un tournoi aura son classement final.</p>:<div className="overflow-auto mt-4"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">#</th><th>Club / équipe</th>{categoryResults.map(x=><th key={x.category}>{x.category}</th>)}<th>Total</th></tr></thead><tbody>{overall.map((x,i)=><tr key={x.key} className="border-b"><td className="py-2 font-black">{i+1}</td><td className="font-semibold">{x.clubName} {x.teamNumber}</td>{categoryResults.map(c=><td key={c.category}>{x.byCategory[c.category]??(c.complete?0:'—')}</td>)}<td className="font-black">{x.total}</td></tr>)}</tbody></table></div>}</div>
  </div></main>
}
