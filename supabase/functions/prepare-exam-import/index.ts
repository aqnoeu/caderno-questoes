import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SITE_ORIGIN=Deno.env.get("SITE_ORIGIN")||"https://caderno-questoes.vercel.app";
const GROQ_MODEL=Deno.env.get("GROQ_MODEL")||"openai/gpt-oss-120b";
const GEMINI_MODEL=Deno.env.get("GEMINI_MODEL")||"gemini-3.6-flash";
function corsFor(request:Request){
 const origin=request.headers.get("Origin")||"";
 const allowed=origin===SITE_ORIGIN||/^https:\/\/caderno-questoes[a-z0-9-]*\.vercel\.app$/.test(origin)||/^http:\/\/localhost:\d+$/.test(origin);
 return {"Access-Control-Allow-Origin":allowed?origin:SITE_ORIGIN,"Vary":"Origin","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
}
function parseJson(value:unknown){
 return JSON.parse(String(value||"{}").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
}
async function analyze(provider:string,prompt:string){
 if(provider==="gemini"){
  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key)throw new Error("GEMINI_API_KEY ausente.");
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",temperature:0.05}})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error?.message||"Gemini indisponível.");
  return parseJson(data.candidates?.[0]?.content?.parts?.[0]?.text);
 }
 const key=Deno.env.get("GROQ_API_KEY");
 if(!key)throw new Error("GROQ_API_KEY ausente.");
 const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"system",content:"Você extrai informações de provas brasileiras com fidelidade literal. Responda somente JSON válido."},{role:"user",content:prompt}],response_format:{type:"json_object"},temperature:0.05})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error?.message||"Groq indisponível.");
 return parseJson(data.choices?.[0]?.message?.content);
}
Deno.serve(async(request)=>{
 const cors=corsFor(request);
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
 if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(request.method!=="POST")return json({error:"Método não permitido."},405);
 try{
  const admin=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
  const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const {data:session,error:authError}=await admin.auth.getUser(token);
  if(authError||!session.user)return json({error:"Sessão inválida."},401);
  const {data:profile}=await admin.from("profiles").select("role").eq("id",session.user.id).maybeSingle();
  if(profile?.role!=="admin")return json({error:"Acesso restrito ao administrador."},403);
  const body=await request.json().catch(()=>({}));
  const questions=Array.isArray(body.questions)?body.questions:[];
  if(!questions.length||questions.length>6)return json({error:"Envie de 1 a 6 questões por lote."},400);
  const compact=questions.map((q:any)=>({question_number:Number(q.question_number),statement:String(q.statement||"").slice(0,14000),alternatives:Array.isArray(q.alternatives)?q.alternatives.slice(0,8).map((a:any)=>({letter:String(a.letter||""),text:String(a.text||"").slice(0,7000)})):[]}));
  const characters=JSON.stringify(compact).length;
  if(characters>44000)return json({error:"Lote excede o limite de texto. Divida a importação."},400);
  const {data:settings}=await admin.from("ai_provider_settings").select("first_pass_provider").eq("id",true).single();
  const provider=settings?.first_pass_provider||"groq";
  const prompt=`Você é um extrator de questões OBJETIVAS, sem qualquer tarefa de corrigir o conteúdo jurídico. Sua única tarefa é limpar artefatos de PDF e reconstruir com fidelidade enunciados e alternativas que já foram identificados preliminarmente. Remova cabeçalhos, rodapés, numeração de páginas, publicidade, avisos, instruções gerais, questionários de avaliação, marcas editoriais fora do texto da questão. Preserve referências legislativas, citações jurídicas, quebras relevantes, íntegra do enunciado, alternativas e numeração. Nunca invente alternativa ou informação ausente. Se a questão estiver truncada, informe alerta e não complemente por adivinhação. Identifique concurso, banca, ano e edição SOMENTE quando existirem indícios claros nos dados fornecidos. Não atribua gabarito. Retorne JSON exatamente neste formato: {"metadata":{"concurso":"","banca":"","ano":null,"edicao":"","cargo":""},"questions":[{"question_number":1,"statement":"texto limpo","alternatives":[{"letter":"A","text":"texto"}],"warnings":[]}]}. Mantenha exatamente os números e letras presentes no lote original. Não introduza nem exclua questões. Os metadados sugeridos NÃO substituem a revisão do administrador.\n\nMetadados fornecidos:${JSON.stringify(body.metadata||{})}\nContexto do início da prova:${String(body.source_text||"").slice(0,6500)}\nQUESTÕES PRELIMINARES:${JSON.stringify(compact)}`;
  const output=await analyze(provider,prompt);
  const originals=new Map(compact.map((q:any)=>[q.question_number,q]));
  const normalized=[];
  for(const row of Array.isArray(output.questions)?output.questions:[]){
   const original=originals.get(Number(row?.question_number));
   if(!original)continue;
   const originalLetters=new Set(original.alternatives.map((a:any)=>a.letter.toUpperCase()));
   const candidate=Array.isArray(row.alternatives)?row.alternatives.map((a:any)=>({letter:String(a.letter||"").toUpperCase(),text:String(a.text||"").trim()})):[];
   const valid=candidate.length===original.alternatives.length&&candidate.every((a:any)=>originalLetters.has(a.letter)&&a.text);
   normalized.push({question_number:original.question_number,statement:String(row.statement||"").trim()||original.statement,alternatives:valid?candidate:original.alternatives,warnings:Array.isArray(row.warnings)?row.warnings.map(String).slice(0,5):[]});
  }
  if(normalized.length!==compact.length)return json({error:"A IA não preservou todas as questões. O material original deve ser revisto."},422);
  return json({provider,metadata:output.metadata||{},questions:normalized});
 }catch(err){return json({error:err instanceof Error?err.message:"Falha na extração com IA."},500);}
});