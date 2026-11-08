import React from "react";

const DAY_NAMES=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const ISO=(date)=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
const add=(d,days)=>{const x=new Date(d);x.setDate(d.getDate()+days);return x;};

export function GuidedPlanner({supabase,userId,notebookId,editalTopics=[],questions=[],onSaved}){
 const [days,setDays]=React.useState([1,2,3,4,5,6]);
 const [minutes,setMinutes]=React.useState(60);
 const [examDate,setExamDate]=React.useState("");
 const [step,setStep]=React.useState("preferences");
 const [draft,setDraft]=React.useState([]);
 const [recommendation,setRecommendation]=React.useState(null);
 const [busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState("");
 const [name,setName]=React.useState("Meu plano de estudos");
 const topics=React.useMemo(()=>{
   const found=[];
   const seen=new Set();
   for(const row of editalTopics.length?editalTopics:questions){
     const value=String(row.discipline||"").trim();
     if(value&&!seen.has(value.toLocaleLowerCase("pt-BR"))){
       seen.add(value.toLocaleLowerCase("pt-BR"));
       found.push({discipline:value,weight:Number(row.weight)||1});
     }
   }
   return found;
 },[editalTopics,questions]);
 React.useEffect(()=>{
   let alive=true;
   supabase.from("provisional_notebook_specs").select("exam_date").eq("notebook_id",notebookId).maybeSingle()
     .then(({data})=>{if(alive&&data?.exam_date)setExamDate(data.exam_date);});
   return()=>{alive=false;};
 },[supabase,notebookId]);
 function generate(priorities){
   const ranked=[...topics].sort((a,b)=>{
     const ai=(x)=>priorities.findIndex(item=>String(item.discipline||"").trim().toLocaleLowerCase("pt-BR")===x.discipline.toLocaleLowerCase("pt-BR"));
     const aa=ai(a),bb=ai(b);
     return (aa<0?999:aa)-(bb<0?999:bb)||b.weight-a.weight;
   });
   if(!ranked.length)throw Error("Este caderno não possui matérias para planejar.");
   const start=new Date(),until=examDate?new Date(examDate+"T12:00:00"):add(start,27);
   const span=Math.min(28,Math.max(7,Math.floor((until-start)/86400000)+1));
   const draftRows=[];
   let ordinal=0;
   for(let i=0;i<span;i++){
     const date=add(start,i);
     if(!days.includes(date.getDay()))continue;
     const subject=ranked[ordinal%ranked.length];
     draftRows.push({
       key:i,date:ISO(date),discipline:subject.discipline,
       planned_minutes:Number(minutes),subject:ordinal%4===3?"Revisão e questões":"Estudo e questões"
     });
     ordinal++;
   }
   return draftRows;
 }
 async function askAI(){
   if(!days.length)return setError("Escolha ao menos um dia da semana.");
   if(!topics.length)return setError("Não há matérias no caderno. Volte e confira o edital.");
   setBusy(true);setError("");
   try{
     const {data,error:invokeError}=await supabase.functions.invoke("analyze-edital",{
       body:{mode:"plan",topics:editalTopics.length?editalTopics:topics,exam_date:examDate||null,
         minutes:Number(minutes),days}
     });
     if(invokeError||data?.error)throw new Error(data?.error||invokeError?.message||"Não foi possível gerar a proposta.");
     const priorities=Array.isArray(data?.result?.priorities)?data.result.priorities:[];
     setRecommendation(data.result);
     setDraft(generate(priorities));
     setStep("review");
   }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 function update(key,field,value){setDraft(items=>items.map(t=>t.key===key?{...t,[field]:value}:t));}
 async function save(){
   if(!draft.length)return setError("Inclua ao menos um dia de estudo.");
   setBusy(true);setError("");
   let createdId=null;
   try{
     const {data,error:planError}=await supabase.from("study_plans").insert({
       user_id:userId,notebook_id:notebookId,name:name.trim()||"Meu plano de estudos",
       exam_date:examDate||null,target_minutes:Number(minutes)
     }).select("id").single();
     if(planError)throw planError;
     createdId=data.id;
     const payload=draft.map(item=>({
       plan_id:data.id,user_id:userId,study_date:item.date,
       discipline:item.discipline,subject:item.subject||"",
       planned_minutes:Number(item.planned_minutes)||30
     }));
     const {error:taskError}=await supabase.from("study_plan_tasks").insert(payload);
     if(taskError)throw taskError;
     onSaved?.();
   }catch(e){
     if(createdId)await supabase.from("study_plans").delete().eq("id",createdId).eq("user_id",userId);
     setError(e.message);
   }finally{setBusy(false);}
 }

 return <section className="card guided-plan">
   {step==="preferences"?<>
     <span className="eyebrow">SEU PLANEJAMENTO</span>
     <h2>Vamos montar uma rotina que caiba no seu dia? 📅</h2>
     <p>Eu já tenho as matérias do seu caderno. Só preciso saber quanto tempo você tem disponível.</p>
     <label>Como quer chamar seu planejamento?
       <input maxLength="120" value={name} onChange={e=>setName(e.target.value)}/>
     </label>
     <p><strong>Quais dias você consegue estudar?</strong></p>
     <div className="guided-weekdays">{DAY_NAMES.map((label,i)=><button type="button" key={i}
       className={days.includes(i)?"active":""} aria-pressed={days.includes(i)}
       onClick={()=>setDays(current=>current.includes(i)?current.filter(n=>n!==i):[...current,i].sort())}>{label}</button>)}</div>
     <label>Quanto tempo por dia?
       <select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>
         {[30,45,60,90,120,150,180,240].map(v=><option value={v} key={v}>{v<60?v+" minutos":v/60+" hora(s)"}</option>)}
       </select>
     </label>
     <label>Data prevista da prova <small>(pode ser ajustada)</small>
       <input type="date" value={examDate} onChange={e=>setExamDate(e.target.value)}/>
     </label>
     <button disabled={busy||!topics.length} onClick={askAI}>{busy?"Preparando sua rotina…":"Sugerir uma rotina de estudos →"}</button>
     {!topics.length&&<p>Seu caderno ainda não tem matérias cadastradas.</p>}
   </>:<>
     <span className="eyebrow">SUGESTÃO EDITÁVEL</span>
     <h2>{recommendation?.intro||"Olha a rotina que preparei para você! ✨"}</h2>
     <p>Organizei {draft.length} sessões de estudo. Você pode modificar as matérias, os tempos ou retirar um dia.</p>
     <div className="guided-schedule">
       {draft.map(item=><div className="guided-session" key={item.key}>
         <div><strong>{new Date(item.date+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short"})}</strong></div>
         <select aria-label="Disciplina do dia" value={item.discipline} onChange={e=>update(item.key,"discipline",e.target.value)}>
           {topics.map(t=><option value={t.discipline} key={t.discipline}>{t.discipline}</option>)}
         </select>
         <input aria-label="Duração em minutos" type="number" min="5" max="720" value={item.planned_minutes}
           onChange={e=>update(item.key,"planned_minutes",e.target.value)}/>
         <button type="button" className="light compact" aria-label="Remover dia" onClick={()=>setDraft(current=>current.filter(x=>x.key!==item.key))}>×</button>
       </div>)}
     </div>
     {Array.isArray(recommendation?.tips)&&recommendation.tips.length>0&&<details><summary>Dicas para manter o ritmo</summary>
       {recommendation.tips.slice(0,3).map((tip,i)=><p key={i}>{tip}</p>)}</details>}
     <div className="guided-actions">
       <button type="button" className="light" onClick={()=>setStep("preferences")}>← Ajustar disponibilidade</button>
       <button type="button" disabled={busy||!draft.length} onClick={save}>{busy?"Salvando…":"Salvar meu planejamento ✓"}</button>
     </div>
   </>}
   {error&&<p className="form-message" role="alert">{error}</p>}
 </section>;
}
