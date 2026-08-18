"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  MICHEL_CLIPET_RULES,
  clipetFinalMatches,
  clipetPhase2,
  computeClipetFinalRanking,
  computeStandings,
  roundRobinPairs,
  type Result,
  type TeamSeed,
} from "@/lib/tournamentEngine";

type Tournament = {
  id: string; title: string; category: string | null; start_time: string; match_duration_min: number;
  rotation_duration_min: number; num_fields: number; field_names: string[] | null; competition_config: any;
};
type Team = TeamSeed & { clubName: string | null; teamNumber: number; disqualified: boolean; tieBreakLot: number | null };
type Match = Result & { id: string; startTime: string; fieldIdx: number; label: string | null };

function hhmmToMin(v: string) { const [h,m] = String(v).slice(0,5).split(":").map(Number); return h*60+m; }
function minToHHMM(v: number) { const n=((v%1440)+1440)%1440; return `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`; }

export default function ClipetControlPage(){
  const p=useParams(); const r=useRouter(); const tid=String(p.id);
  const [t,setT]=useState<Tournament|null>(null); const [teams,setTeams]=useState<Team[]>([]); const [matches,setMatches]=useState<Match[]>([]); const [status,setStatus]=useState("Chargement…");

  async function load(){
    const {data:u}=await supabase.auth.getUser(); if(!u.user){r.push("/login");return;}
    const [tr,te,mr]=await Promise.all([
      supabase.from("tournaments").select("id,title,category,start_time,match_duration_min,rotation_duration_min,num_fields,field_names,competition_config").eq("id",tid).single(),
      supabase.from("teams").select("id,name,club_name,team_number,disqualified,tie_break_lot").eq("tournament_id",tid).order("created_at"),
      supabase.from("matches").select("id,match_number,phase_key,match_label,start_time,field_idx,status,home_team_id,away_team_id,home_score,away_score,penalty_home,penalty_away").eq("tournament_id",tid).order("match_number")
    ]);
    if(tr.error){setStatus(tr.error.message);return;} setT(tr.data as any);
    setTeams((te.data??[]).map((x:any)=>({id:x.id,name:x.name,clubName:x.club_name,teamNumber:Number(x.team_number??1),disqualified:!!x.disqualified,tieBreakLot:x.tie_break_lot})));
    setMatches((mr.data??[]).map((x:any)=>({id:x.id,matchNumber:x.match_number,phaseKey:x.phase_key,label:x.match_label,startTime:x.start_time,fieldIdx:x.field_idx,status:x.status,homeTeamId:x.home_team_id,awayTeamId:x.away_team_id,homeScore:Number(x.home_score??NaN),awayScore:Number(x.away_score??NaN),penaltyHome:x.penalty_home,penaltyAway:x.penalty_away})));
    setStatus("");
  }
  useEffect(()=>{load()},[tid]);

  const phase1Results=useMemo(()=>matches.filter(m=>Number(m.matchNumber)>=1&&Number(m.matchNumber)<=45&&m.status==="played"&&Number.isFinite(m.homeScore)&&Number.isFinite(m.awayScore)),[matches]);
  const phase1Standings=useMemo(()=>computeStandings(teams,phase1Results,MICHEL_CLIPET_RULES),[teams,phase1Results]);
  const finalState=useMemo(()=>computeClipetFinalRanking(teams,matches),[teams,matches]);
  const byId=useMemo(()=>new Map(teams.map(x=>[x.id,x])),[teams]);

  function slotsFor(count:number,startMin:number){
    if(!t)return[]; const fields=Math.max(1,Number(t.num_fields||1)); const slot=Math.max(1,Number(t.match_duration_min||10)+Number(t.rotation_duration_min||3));
    return Array.from({length:count},(_,i)=>({start:minToHHMM(startMin+Math.floor(i/fields)*slot),field:(i%fields)+1}));
  }
  function nextStart(){ if(!t)return 9*60; const slot=Math.max(1,Number(t.match_duration_min||10)+Number(t.rotation_duration_min||3)); if(!matches.length)return hhmmToMin(t.start_time); return Math.max(...matches.map(m=>hhmmToMin(m.startTime)))+slot; }

  async function generatePhase1(){
    if(!t)return; if(teams.length!==10){setStatus(`Michel Clipet exige 10 équipes (${teams.length}/10).`);return;}
    if(!confirm("Regénérer M1 à M45 ? Les matchs existants de ce tournoi seront supprimés."))return;
    setStatus("Génération M1–M45…"); await supabase.from("referee_assignments").delete().eq("tournament_id",tid); await supabase.from("matches").delete().eq("tournament_id",tid);
    const rounds=roundRobinPairs(teams.map(x=>x.id)); const rows:any[]=[]; const fields=Math.max(1,t.num_fields||1); const slot=Math.max(1,(t.match_duration_min||10)+(t.rotation_duration_min||3)); let no=1; let time=hhmmToMin(t.start_time);
    for(const round of rounds){
      const roundSlots=Math.ceil(round.length/fields);
      round.forEach((pair,i)=>rows.push({tournament_id:tid,home_team_id:pair.home,away_team_id:pair.away,match_number:no++,phase_key:"phase1",match_label:`Phase 1 · Journée ${pair.round}`,start_time:minToHHMM(time+Math.floor(i/fields)*slot),field_idx:(i%fields)+1,status:"scheduled"}));
      time+=roundSlots*slot;
    }
    const {error}=await supabase.from("matches").insert(rows); if(error){setStatus(error.message);return;} setStatus("M1 à M45 générés."); await load();
  }

  async function generatePhase2(){
    if(phase1Results.length!==45){setStatus(`Phase 1 incomplète : ${phase1Results.length}/45 matchs validés.`);return;}
    if(matches.some(m=>Number(m.matchNumber)>=46)){setStatus("La phase 2 existe déjà.");return;}
    const rank=phase1Standings.map(x=>x.teamId); const plans=clipetPhase2(rank); const slots=slotsFor(plans.length,nextStart());
    const rows=plans.map((x,i)=>({tournament_id:tid,home_team_id:x.home,away_team_id:x.away,match_number:x.number,phase_key:x.phase,match_label:x.label,start_time:slots[i].start,field_idx:slots[i].field,status:"scheduled"}));
    const {error}=await supabase.from("matches").insert(rows); if(error){setStatus(error.message);return;} setStatus("M46 à M53 générés selon le classement de phase 1."); await load();
  }

  async function generateFinals(){
    const m46=matches.find(m=>Number(m.matchNumber)===46); const m47=matches.find(m=>Number(m.matchNumber)===47);
    if(!m46||!m47||m46.status!=="played"||m47.status!=="played"){setStatus("Validez M46 et M47 avant de générer M54/M55.");return;}
    const existingFinals=matches.filter(m=>[54,55].includes(Number(m.matchNumber)));
    if(existingFinals.some(m=>m.status==="played")){
      setStatus("M54/M55 ont déjà été joués : dévalidez-les avant de recalculer les finalistes.");
      return;
    }
    try{
      const plans=clipetFinalMatches(m46,m47);
      const start=existingFinals.length
        ? Math.min(...existingFinals.map(m=>hhmmToMin(m.startTime)))
        : nextStart();
      const slots=slotsFor(2,start);
      if(existingFinals.length){
        await supabase.from("referee_assignments").delete().in("match_id",existingFinals.map(m=>m.id));
        const {error:delErr}=await supabase.from("matches").delete().eq("tournament_id",tid).in("match_number",[54,55]);
        if(delErr){setStatus(delErr.message);return;}
      }
      const rows=plans.map((x,i)=>({tournament_id:tid,home_team_id:x.home,away_team_id:x.away,match_number:x.number,phase_key:x.phase,match_label:x.label,start_time:slots[i].start,field_idx:slots[i].field,status:"scheduled"}));
      const {error}=await supabase.from("matches").insert(rows); if(error){setStatus(error.message);return;}
      setStatus(existingFinals.length?"M54/M55 recalculés selon les vainqueurs/perdants actuels de M46/M47.":"M54 petite finale et M55 finale générés dynamiquement.");
      await load();
    }catch(e:any){setStatus(e.message)}
  }

  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-6xl mx-auto space-y-4">
    <div className="bg-white rounded-2xl shadow p-6 flex justify-between gap-3 flex-wrap"><div><div className="text-sm font-bold text-red-600">Challenge Michel Clipet · {t?.category??"Catégorie"}</div><h1 className="text-2xl font-black">{t?.title??"Tournoi"}</h1><p className="text-sm text-slate-500">Pilotage M1–M55 · 8/4/2 + 1 point par but · départage BP puis BC puis tirage.</p></div><button onClick={()=>r.push(`/dashboard/tournaments/${tid}`)} className="bg-slate-200 rounded-xl px-4 py-2">Retour tournoi</button></div>
    {status&&<div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">{status}</div>}
    <div className="grid md:grid-cols-3 gap-3"><button onClick={generatePhase1} className="bg-slate-900 text-white rounded-xl p-4 font-bold">1 · Générer M1–M45</button><button onClick={generatePhase2} className="bg-blue-600 text-white rounded-xl p-4 font-bold">2 · Générer M46–M53</button><button onClick={generateFinals} className="bg-red-600 text-white rounded-xl p-4 font-bold">3 · Générer / recalculer M54/M55</button></div>
    <div className="grid lg:grid-cols-2 gap-4"><div className="bg-white rounded-2xl shadow p-5"><h2 className="font-black text-lg">Classement phase 1</h2><div className="mt-3 space-y-2">{phase1Standings.map((x,i)=><div key={x.teamId} className="grid grid-cols-[35px_1fr_55px_55px_55px] gap-2 text-sm border-b pb-2"><b>{i+1}</b><span>{x.name}</span><b>{x.points} pts</b><span>{x.gf} BP</span><span>{x.ga} BC</span></div>)}</div></div>
    <div className="bg-white rounded-2xl shadow p-5"><h2 className="font-black text-lg">Classement final</h2>{finalState.complete?<div className="mt-3 space-y-2">{finalState.ranking.map((id,i)=><div key={id} className="flex justify-between border-b pb-2 text-sm"><span><b>{i+1}.</b> {byId.get(id)?.name??"Équipe"}</span><b>{21-(i+1)} pts Challenge</b></div>)}</div>:<p className="text-sm text-slate-500 mt-3">En attente : {finalState.reason}.</p>}</div></div>
  </div></main>
}
