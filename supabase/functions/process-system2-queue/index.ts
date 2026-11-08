import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "https://caderno-questoes.vercel.app";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
function corsFor(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === SITE_ORIGIN || /^https:\/\/caderno-questoes[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  return { "Access-Control-Allow-Origin": allowed ? origin : SITE_ORIGIN, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-system2-cron-key" };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanList = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : String(value || "").split(/[·;|]/).map((item) => item.trim()).filter(Boolean);
async function askGemini(apiKey: string, prompt: string) {
  let status = 500, message = "Falha na análise pelo Gemini.";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key":apiKey }, body:JSON.stringify({ contents:[{ parts:[{ text:prompt }] }], generationConfig:{ responseMimeType:"application/json", temperature:.08 } }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      return JSON.parse(text);
    }
    status = response.status; message = data?.error?.message || message;
    const quota = /quota|billing/i.test(message);
    if ((status === 503 || status === 500 || (status === 429 && !quota)) && attempt < 3) { await sleep(attempt * 1500); continue; }
    break;
  }
  throw new Error(message);
}

const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
async function askGroq(prompt: string) {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY não configurada.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model:GROQ_MODEL, messages:[{ role:"system", content:"Responda exclusivamente em JSON válido. Não invente fundamentos jurídicos." },{ role:"user",content:prompt }], response_format:{ type:"json_object" }, temperature:0.08 }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Groq indisponível (${response.status}).`);
  const output = String(payload?.choices?.[0]?.message?.content || "{}").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
  return JSON.parse(output);
}
async function askProvider(provider: string, prompt: string) {
  if (provider === "groq") return askGroq(prompt);
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY não configurada.");
  return askGemini(key, prompt);
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response("ok", { headers:cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth:{ persistSession:false } });
  let claimed: any = null;
  try {
    const { data: settings, error: settingsError } = await admin.from("system2_ai_settings").select("enabled, cron_secret").eq("id", true).single();
    if (settingsError || !settings) return json({ error:"A configuração do Filtro de IA não foi encontrada." }, 500);
    const isScheduled = request.headers.get("x-system2-cron-key") === settings.cron_secret;
    const body = await request.json().catch(() => ({}));
    if (!isScheduled) {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData.user) return json({ error:"Acesso não autorizado." }, 401);
      const { data: profile } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
      if (profile?.role !== "admin") return json({ error:"Acesso restrito ao administrador." }, 403);
    }
    const { data: claimData, error: claimError } = await admin.rpc("claim_system2_full_question", { p_trigger:isScheduled ? "scheduled" : "manual", p_question_id:body?.question_id || null });
    if (claimError) throw claimError;
    claimed = claimData;
    if (!claimed?.claimed) return json(claimed || { claimed:false, reason:"Nenhuma questão disponível." });
    const { data: source, error: sourceError } = await admin.from("questions_v2").select("id, question_number, statement, alternatives, answer_key_option, ai_stage, analysis_steps, discipline, subjects, subtopics, legal_concepts, difficulty, legal_basis, central_rule, option_error_analysis, correct_answer_explanation, ai_confidence, ai_result, import:question_imports(concurso, edicao, ano, banca, cargo)").eq("id", claimed.question_id).single();
    if (sourceError || !source) throw new Error("A questão selecionada não foi encontrada.");
    const { data: providers } = await admin.from("ai_provider_settings").select("first_pass_provider,reasoning_provider").eq("id",true).single();
    const question = { number:source.question_number, statement:source.statement, alternatives:source.alternatives, correct_option:source.answer_key_option, metadata:source.import || {} };
    const stages: Array<Record<string, unknown>> = [];
    const initialStage = Number(source.ai_stage || 0) + 1;
    for (let stage = initialStage; stage <= 3; stage++) {
    const providerForStage = stage === 1 ? (providers?.first_pass_provider || "groq") : (providers?.reasoning_provider || "gemini");
    let patch: Record<string, unknown> = {}, summary: Record<string, unknown> = { stage, provider:providerForStage };
    if (stage === 1) {
      const result = await askProvider(providerForStage, `Você é a primeira etapa de análise de uma questão objetiva jurídica brasileira. Preserve o enunciado e não invente jurisprudência, lei ou fato. Identifique a alternativa correta usando o gabarito informado. Esta etapa NÃO diagnostica alternativas erradas. Retorne APENAS JSON válido.\n\nQUESTÃO:${JSON.stringify(question)}\n\nFormato: {"discipline":"string","subjects":["tema"],"subtopics":["subtema"],"legal_concepts":["conceito"],"difficulty":"facil|media|dificil","central_rule":"resumo objetivo da regra que torna a alternativa correta","legal_basis":"fundamentos legais seguros e pertinentes","correct_answer_summary":"explicação curta e direta da alternativa correta","confidence":0.0}`);
      const difficultyMap: Record<string, string> = { fácil:"facil", facil:"facil", média:"media", media:"media", difícil:"dificil", dificil:"dificil" };
      const confidence = Math.max(0, Math.min(1, Number(result.confidence || 0)));
      patch = { discipline:String(result.discipline || "").trim() || null, subjects:cleanList(result.subjects), subtopics:cleanList(result.subtopics), legal_concepts:cleanList(result.legal_concepts), difficulty:difficultyMap[String(result.difficulty || "").toLowerCase()] || "media", central_rule:String(result.central_rule || "").trim() || null, legal_basis:String(result.legal_basis || "").trim() || null, correct_answer_explanation:String(result.correct_answer_summary || "").trim() || null, ai_confidence:confidence, ai_stage:1, analysis_steps:{ ...(source.analysis_steps || {}), classification:"complete", wrong_options:"pending", correct_answer:"pending" }, ai_result:{ stage_1:result }, status:"processing_ai", ai_last_error:null };
      summary = { stage, discipline:patch.discipline, confidence };
    } else if (stage === 2) {
      const result = await askProvider(providerForStage, `Você é a segunda etapa de análise pedagógica de uma questão objetiva jurídica. A classificação e a regra central já foram produzidas. Para CADA alternativa, identifique o raciocínio do aluno que a escolheria. Na correta, marque is_correct true e explique por que ela atende à regra. Em cada errada, diferencie erros semelhantes com precisão. Produza um conteúdo-base curto, prático e específico para corrigir apenas aquele erro; não faça texto genérico nem repita a fundamentação geral. Retorne APENAS JSON válido.\n\nQUESTÃO:${JSON.stringify(question)}\n\nETAPA 1:${JSON.stringify({ discipline:source.discipline, subjects:source.subjects, central_rule:source.central_rule, legal_basis:source.legal_basis, correct_answer_summary:source.correct_answer_explanation })}\n\nFormato: {"alternatives":[{"letter":"A","is_correct":false,"mistake_type":"string","wrong_reasoning":"qual é a premissa equivocada","student_feedback":"explicação didática do erro","study_content":"texto curto específico para estudo dirigido"}]}`);
      const diagnostics: Record<string, unknown> = {};
      for (const item of result.alternatives || []) if (item?.letter) diagnostics[String(item.letter).toUpperCase()] = { is_correct:Boolean(item.is_correct), mistake_type:String(item.mistake_type || ""), wrong_reasoning:String(item.wrong_reasoning || ""), student_feedback:String(item.student_feedback || ""), study_content:String(item.study_content || "") };
      patch = { option_error_analysis:diagnostics, ai_stage:2, analysis_steps:{ ...(source.analysis_steps || {}), classification:"complete", wrong_options:"complete", correct_answer:"pending" }, ai_result:{ stage_1:source.ai_result?.stage_1 || source.ai_result || {}, stage_2:result }, status:"processing_ai", ai_last_error:null };
      summary = { stage, alternatives:Object.keys(diagnostics).length };
    } else {
      const result = await askProvider(providerForStage, `Você é a terceira e última etapa de análise pedagógica. Revise os dados já produzidos para a questão e escreva uma explicação final clara do gabarito, mostrando o caminho jurídico correto. Não repita o diagnóstico individual das alternativas erradas; ele já existe. Não invente informações. Retorne APENAS JSON válido.\n\nQUESTÃO:${JSON.stringify(question)}\n\nANÁLISE JÁ PRODUZIDA:${JSON.stringify({ central_rule:source.central_rule, legal_basis:source.legal_basis, alternative_diagnostics:source.option_error_analysis })}\n\nFormato: {"correct_answer_explanation":"explicação final da alternativa correta, curta e didática","confidence":0.0}`);
      const confidence = Math.max(Number(source.ai_confidence || 0), Math.min(1, Number(result.confidence || 0)));
      const complete = Boolean(source.discipline && cleanList(source.subjects).length && source.central_rule && source.legal_basis && Object.keys(source.option_error_analysis || {}).length >= 2 && String(result.correct_answer_explanation || "").trim());
      const finalStatus = complete && confidence >= .6 ? "approved" : "needs_review";
      patch = { correct_answer_explanation:String(result.correct_answer_explanation || "").trim() || source.correct_answer_explanation || null, ai_confidence:confidence, ai_stage:3, analysis_steps:{ ...(source.analysis_steps || {}), classification:"complete", wrong_options:"complete", correct_answer:"complete" }, ai_result:{ stage_1:source.ai_result?.stage_1 || {}, stage_2:source.ai_result?.stage_2 || {}, stage_3:result }, status:finalStatus, ai_processed_at:new Date().toISOString(), ai_last_error:null };
      summary = { stage, confidence, final_status:finalStatus };
    }
    // Persistir cada etapa ANTES de começar a próxima. A análise incompleta
    // retoma da última etapa salva após qualquer falha ou queda da função.
    const { data: saved, error:updateError } = await admin.from("questions_v2")
      .update(patch).eq("id",source.id).eq("ai_stage",stage-1).select("id").maybeSingle();
    if (updateError || !saved) throw new Error(updateError?.message || "O estado da questão mudou durante a análise.");
    Object.assign(source,patch);
    stages.push({ stage, provider:providerForStage, ...summary });
    }
    // O intervalo entre questões começa SOMENTE após a etapa 3.
    const { data: released, error: finishError } = await admin.rpc("finish_system2_full_question", {
      p_question_id:source.id, p_run_id:claimed.run_id,
      p_run_status:String(source.status), p_summary:{ starting_stage:initialStage, stages },
      p_error:null,
    });
    if (finishError || !released) throw new Error(finishError?.message || "Não foi possível liberar a fila após concluir a questão.");
    return json({ claimed:true, question_id:source.id,question_number:source.question_number,
      starting_stage:initialStage,stage:3,status:source.status,progress:100,stages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado no Filtro de IA.";
    if (claimed?.question_id) {
      const transient = /(high demand|temporar|429|resource[ _-]?exhausted|try again later|unavailable|quota|rate.?limit)/i.test(message);
      const retryAt = new Date(Date.now() + 10 * 60_000).toISOString();
      await admin.from("questions_v2").update(transient ? { status:"pending_ai", ai_last_error:message, next_attempt_at:retryAt } : { status:"needs_review", ai_last_error:message }).eq("id", claimed.question_id);
      if (claimed.run_id) await admin.rpc("finish_system2_full_question", {
        p_question_id:claimed.question_id,p_run_id:claimed.run_id,p_run_status:"failed",
        p_summary:{ failed_stage:claimed.starting_stage,mode:"complete_question" },p_error:message,
      });
    }
    return json({ error:message, question_id:claimed?.question_id || null }, 500);
  }
});
