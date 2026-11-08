import React from "react";
import { GuidedPlanner } from "./guided-planning";

function localISO(date) {
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+d;
}
function parseDate(value) { return new Date((value||localISO(new Date()))+"T12:00:00"); }
function dayKey(date) { return localISO(date); }
function addDays(date,count){const copy=new Date(date);copy.setDate(copy.getDate()+count);return copy;}
function startOfWeek(date){const d=new Date(date);d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
function getDisciplines(questions,answers) {
  const hit=new Map();
  for(const question of questions){
    if(!question.discipline)continue;
    const name=question.discipline;
    if(!hit.has(name))hit.set(name,{name,total:0,correct:0,questions:0});
    hit.get(name).questions++;
  }
  const map=new Map(questions.map(q=>[q.id,q]));
  for(const answer of answers){
    const q=map.get(answer.question_id);if(!q?.discipline)continue;
    const item=hit.get(q.discipline);if(!item)continue;
    item.total++;if(answer.is_correct)item.correct++;
  }
  return [...hit.values()].sort((a,b)=>{
    const ar=a.total?a.correct/a.total:-1,br=b.total?b.correct/b.total:-1;
    return ar-br || a.name.localeCompare(b.name);
  });
}

export function StudyPlanner({supabase,userId,notebookId,questions}) {
  const [plans,setPlans]=React.useState([]);
  const [tasks,setTasks]=React.useState([]);
  const [answers,setAnswers]=React.useState([]);
  const [editalTopics,setEditalTopics]=React.useState([]);
  const [selected,setSelected]=React.useState("");
  const [name,setName]=React.useState("Meu planejamento");
  const [examDate,setExamDate]=React.useState("");
  const [editalDate,setEditalDate]=React.useState("");
  const [target,setTarget]=React.useState(60);
  const [month,setMonth]=React.useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const [date,setDate]=React.useState(()=>dayKey(new Date()));
  const [discipline,setDiscipline]=React.useState("");
  const [subject,setSubject]=React.useState("");
  const [minutes,setMinutes]=React.useState(45);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState("");
  const [info,setInfo]=React.useState("");

  const reload=React.useCallback(async()=>{
    const [a,b]=await Promise.all([
      supabase.from("study_plans").select("*").eq("user_id",userId).eq("notebook_id",notebookId).order("created_at",{ascending:false}),
      supabase.from("answers").select("question_id,is_correct").eq("user_id",userId).eq("notebook_id",notebookId)
    ]);
    if(a.error||b.error){setError(a.error?.message||b.error?.message);return;}
    setPlans(a.data||[]);setAnswers(b.data||[]);
  },[supabase,userId,notebookId]);
  React.useEffect(()=>{setSelected("");setTasks([]);reload();},[reload]);
  React.useEffect(()=>{
    let active=true;
    setEditalTopics([]);
    supabase.from("provisional_notebook_specs").select("topics,exam_date").eq("notebook_id",notebookId)
      .maybeSingle().then(({data})=>{
        if(active){setEditalTopics(Array.isArray(data?.topics)?data.topics:[]);setEditalDate(data?.exam_date||"");}
      });
    return()=>{active=false;};
  },[supabase,notebookId]);
  React.useEffect(()=>{
    if(!plans.length){setSelected("");return;}
    setSelected(current=>plans.some(p=>p.id===current)?current:plans[0].id);
  },[plans]);
  React.useEffect(()=>{
    if(!selected){setTasks([]);return;}
    let active=true;
    supabase.from("study_plan_tasks").select("*").eq("user_id",userId).eq("plan_id",selected)
      .order("study_date",{ascending:true}).then(({data,error:err})=>{
        if(!active)return;
        if(err)setError(err.message);else setTasks(data||[]);
      });
    return()=>{active=false;};
  },[selected,supabase,userId]);

  const ranking=React.useMemo(()=>{
    const items=getDisciplines(questions,answers);
    const listed=new Set(items.map(item=>item.name));
    for(const topic of editalTopics){
      if(topic.discipline&&!listed.has(topic.discipline)){
        items.push({name:topic.discipline,total:0,correct:0,questions:0});
        listed.add(topic.discipline);
      }
    }
    return items;
  },[questions,answers,editalTopics]);
  const plan=plans.find(p=>p.id===selected);
  const today=dayKey(new Date()),weekStart=dayKey(startOfWeek(new Date())),weekEnd=dayKey(addDays(startOfWeek(new Date()),6));
  const weekTasks=tasks.filter(t=>t.study_date>=weekStart&&t.study_date<=weekEnd);
  const weekDone=weekTasks.filter(t=>t.done).length;
  const todayTasks=tasks.filter(t=>t.study_date===today);
  const completed=tasks.filter(t=>t.done).length;
  const dates=React.useMemo(()=>{
    const first=new Date(month.getFullYear(),month.getMonth(),1);
    const cells=[];const offset=(first.getDay()+6)%7;
    for(let i=0;i<offset;i++)cells.push(null);
    const end=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
    for(let d=1;d<=end;d++)cells.push(dayKey(new Date(month.getFullYear(),month.getMonth(),d)));
    return cells;
  },[month]);

  async function createPlan(e){
    e.preventDefault();setBusy(true);setError("");setInfo("");
    const {data,error:err}=await supabase.from("study_plans").insert({
      user_id:userId,notebook_id:notebookId,name:name.trim()||"Meu planejamento",
      exam_date:examDate||null,target_minutes:Number(target)||60,
    }).select("*").single();
    if(err)setError(err.message);else{await reload();setSelected(data.id);setInfo("Planejamento criado. Agora inclua suas atividades.");}
    setBusy(false);
  }
  async function addTask(e){
    e.preventDefault();if(!plan||!discipline)return;
    setBusy(true);setError("");setInfo("");
    const {error:err}=await supabase.from("study_plan_tasks").insert({
      plan_id:plan.id,user_id:userId,study_date:date,discipline,subject:subject.trim(),
      planned_minutes:Number(minutes)||30
    });
    if(err)setError(err.message);else {const {data}=await supabase.from("study_plan_tasks").select("*").eq("plan_id",plan.id).eq("user_id",userId).order("study_date");setTasks(data||[]);setInfo("Atividade adicionada.");}
    setBusy(false);
  }
  async function setDone(task,done){
    const {error:err}=await supabase.from("study_plan_tasks").update({
      done,completed_minutes:done?task.planned_minutes:0
    }).eq("id",task.id).eq("user_id",userId);
    if(err){setError(err.message);return;}
    setTasks(current=>current.map(t=>t.id===task.id?{...t,done,completed_minutes:done?t.planned_minutes:0}:t));
  }
  async function removeTask(task){
    const {error:err}=await supabase.from("study_plan_tasks").delete().eq("id",task.id).eq("user_id",userId);
    if(err)setError(err.message);else setTasks(current=>current.filter(t=>t.id!==task.id));
  }
  async function suggestSchedule(){
    if(!plan||!ranking.length)return setError("Este caderno ainda não possui disciplinas para sugerir.");
    if(tasks.length>0)return setError("Para evitar duplicações, as sugestões automáticas só podem ser criadas em um planejamento vazio.");
    const todayDate=new Date();
    const last=plan.exam_date?parseDate(plan.exam_date):addDays(todayDate,27);
    const maxDays=Math.min(28,Math.max(1,Math.ceil((last-todayDate)/86400000)));
    const rows=[];
    for(let i=0;i<maxDays;i++){
      const current=addDays(todayDate,i);
      if(current.getDay()===0)continue;
      const picked=ranking[i%ranking.length];
      rows.push({plan_id:plan.id,user_id:userId,study_date:dayKey(current),
        discipline:picked.name,subject:"",planned_minutes:plan.target_minutes});
    }
    if(!rows.length)return;
    setBusy(true);setError("");
    const {error:err}=await supabase.from("study_plan_tasks").insert(rows);
    if(err)setError(err.message);else {
      const {data}=await supabase.from("study_plan_tasks").select("*").eq("plan_id",plan.id).eq("user_id",userId).order("study_date");
      setTasks(data||[]);setInfo("Sugestão de até quatro semanas criada, priorizando matérias de menor aproveitamento.");
    }
    setBusy(false);
  }

  return <section className="planner-page">
    <div className="planner-heading"><div><span className="eyebrow">ORGANIZAÇÃO DOS ESTUDOS</span>
      <h1>Planejamento</h1><p>Organize sua rotina e acompanhe as metas deste caderno.</p></div>
      {plans.length>0&&<select aria-label="Planejamento" value={selected} onChange={e=>setSelected(e.target.value)}>
        {plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    </div>
    {!plan&&<GuidedPlanner key={notebookId} supabase={supabase} userId={userId}
      notebookId={notebookId} editalTopics={editalTopics} questions={questions} onSaved={()=>reload()}/>}
    {plan&&<>
      <div className="planner-summary">
        <article className="card"><small>Atividades concluídas</small><b>{completed}/{tasks.length}</b></article>
        <article className="card"><small>Meta semanal cumprida</small><b>{weekDone}/{weekTasks.length}</b></article>
        <article className="card"><small>Para hoje</small><b>{todayTasks.filter(t=>!t.done).length}</b></article>
        <article className="card"><small>Prova prevista</small><b>{plan.exam_date?new Date(plan.exam_date+"T12:00:00").toLocaleDateString("pt-BR"):"Sem data"}</b></article>
      </div>
      {ranking.length>0&&<section className="card planner-recommend"><h2>Foco recomendado</h2>
        <p>Priorize <strong>{ranking[0].name}</strong> — {ranking[0].total?
          Math.round(ranking[0].correct/ranking[0].total*100)+"% de acertos": "ainda sem respostas neste caderno"}.</p>
        <button type="button" className="light" disabled={busy||tasks.length>0} onClick={suggestSchedule}>Sugerir até 4 semanas de estudos</button>
        <small>O planejamento utiliza as disciplinas disponíveis e seu desempenho, sem alterar os ciclos.</small>
      </section>}
      <div className="planner-layout">
        <section className="card planner-calendar"><div className="planner-month-head">
          <button className="light" type="button" aria-label="Mês anterior" onClick={()=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()-1,1))}>‹</button>
          <h2>{month.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</h2>
          <button className="light" type="button" aria-label="Mês seguinte" onClick={()=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()+1,1))}>›</button>
        </div><div className="planner-days">{["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(d=><b key={d}>{d}</b>)}
          {dates.map((day,i)=><button type="button" key={day||"empty-"+i} disabled={!day}
            className={(day===date?" selected":"")+(day===today?" today":"")} onClick={()=>day&&setDate(day)}>
            {day?Number(day.slice(-2)):""}
            {day&&tasks.some(t=>t.study_date===day)&&<i aria-label="Com atividade" />}
          </button>)}
        </div></section>
        <section className="card planner-agenda"><h2>Atividades — {parseDate(date).toLocaleDateString("pt-BR")}</h2>
          {tasks.filter(t=>t.study_date===date).length===0&&<p>Nenhuma atividade programada.</p>}
          {tasks.filter(t=>t.study_date===date).map(t=><div className="planner-task" key={t.id}>
            <label><input type="checkbox" checked={t.done} onChange={e=>setDone(t,e.target.checked)}/><span>
              <strong>{t.discipline}</strong><small>{t.subject||"Revisão da disciplina"} · {t.planned_minutes} min</small>
            </span></label><button className="light" type="button" onClick={()=>removeTask(t)} aria-label="Excluir atividade">×</button>
          </div>)}
          <form className="planner-add" onSubmit={addTask}><h3>Adicionar estudo</h3>
            <label>Disciplina<select required value={discipline} onChange={e=>setDiscipline(e.target.value)}>
              <option value="">Selecione</option>{ranking.map(d=><option key={d.name}>{d.name}</option>)}
              </select></label>
            <label>Assunto (opcional)<input value={subject} onChange={e=>setSubject(e.target.value)} maxLength="240"/></label>
            <label>Minutos<input type="number" min="5" max="720" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
            <button disabled={busy||!discipline}>Adicionar atividade</button>
          </form>
        </section>
      </div>
    </>}
    {info&&<p className="form-message">{info}</p>}
    {error&&<p className="form-message" role="alert">{error}</p>}
  </section>;
}
