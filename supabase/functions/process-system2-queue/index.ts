import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-system2-cron-key" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const cleanList = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : String(value || "").split(/[·;|]/).map((item) => item.trim()).filter(Boolean);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false } });
  let claimed: any = null;
  try {
    const { data: settings, error: settingsError } = await admin.from("system2_ai_settings").select("enabled, cron_secret").eq("id", true).single();
    if (settingsError || !settings) return json({ error: "A configuração do Filtro de IA não foi encontrada. Execute o SQL do Sistema 2.0." }, 500);
    const isScheduled = request.headers.get("x-system2-cron-key") === settings.cron_secret;
    if (!isScheduled) {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "Acesso não autorizado." }, 401);
      const { data: profile } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
      if (profile?.role !== "admin") return json({ error: "Acesso restrito ao administrador." }, 403);
    }
    if (!settings.enabled) return json({ claimed: false, reason: "A automação está pausada." });
    const body = await request.json().catch(() => ({}));
    const { data: claimData, error: claimError } = await admin.rpc("claim_system2_ai_question", { p_trigger: isScheduled ? "scheduled" : body?.trigger === "manual" ? "manual" : "manual" });
    if (claimError) throw claimError;
    claimed = claimData;
    if (!claimed?.claimed) return json(claimed || { claimed: false, reason: "Nenhuma questão disponível." });

    const { data: source } = await admin.from("questions_v2").select("id, question_number, statement, alternatives, answer_key_option, import:question_imports(concurso, edicao, ano, banca, cargo)").eq("id", claimed.question_id).single();
    if (!source) throw new Error("A questão selecionada não foi encontrada.");
    const prompt = `Você é o Filtro de IA de uma plataforma brasileira de estudos para concursos. Analise exclusivamente a questão objetiva abaixo. Preserve o texto original: não o reescreva. Classifique com cautela e, quando a informação não puder ser inferida com segurança, use confidence baixa. Não invente leis, precedentes ou conteúdo fora da questão. Retorne APENAS JSON válido.

METADADOS DA PROVA: ${JSON.stringify(source.import || {})}
QUESTÃO: ${JSON.stringify({ number: source.question_number, statement: source.statement, alternatives: source.alternatives, answer_key_option: source.answer_key_option })}

Formato obrigatório:
{"discipline":"string","subjects":["assunto 1","assunto 2"],"subtopics":["subtópico"],"legal_concepts":["conceito"],"difficulty":"facil|media|dificil","correct_option_analysis":{"A":"análise curta","B":"análise curta"},"legal_basis":"fundamento apenas se seguro","central_rule":"regra central","legal_reasoning":"raciocínio jurídico conciso","study_content":"conteúdo-base didático conciso","confidence":0.0}`;
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("A chave GEMINI_API_KEY não foi configurada.");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }) });
    const gemini = await response.json();
    if (!response.ok) throw new Error(gemini?.error?.message || "Falha na análise pelo Gemini.");
    const result = JSON.parse(gemini?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    const difficultyMap: Record<string, string> = { fácil: "facil", facil: "facil", média: "media", media: "media", difícil: "dificil", dificil: "dificil" };
    const difficulty = difficultyMap[String(result.difficulty || "").toLowerCase()] || "media";
    const subjects = cleanList(result.subjects);
    const confidence = Math.max(0, Math.min(1, Number(result.confidence || 0)));
    const complete = Boolean(String(result.discipline || "").trim() && subjects.length && String(result.central_rule || "").trim());
    const finalStatus = complete && confidence >= 0.6 ? "approved" : "needs_review";
    const payload = { discipline:String(result.discipline || "").trim() || null, subjects, subtopics:cleanList(result.subtopics), legal_concepts:cleanList(result.legal_concepts), alternatives_analysis:result.correct_option_analysis && typeof result.correct_option_analysis === "object" ? result.correct_option_analysis : {}, legal_basis:String(result.legal_basis || "").trim() || null, central_rule:String(result.central_rule || "").trim() || null, legal_reasoning:String(result.legal_reasoning || "").trim() || null, study_content:String(result.study_content || "").trim() || null, ai_confidence:confidence, ai_result:result, ai_processed_at:new Date().toISOString(), ai_last_error:null, status:finalStatus };
    const { error: updateError } = await admin.from("questions_v2").update(payload).eq("id", source.id);
    if (updateError) throw updateError;
    await admin.from("system2_ai_runs").update({ status:finalStatus, finished_at:new Date().toISOString(), result_summary:{ confidence, discipline:payload.discipline, subjects, final_status:finalStatus } }).eq("id", claimed.run_id);
    return json({ claimed:true, status:finalStatus, question_id:source.id, question_number:source.question_number, confidence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado no Filtro de IA.";
    if (claimed?.question_id) {
      await admin.from("questions_v2").update({ status:"needs_review", ai_last_error:message }).eq("id", claimed.question_id);
      if (claimed.run_id) await admin.from("system2_ai_runs").update({ status:"failed", finished_at:new Date().toISOString(), error_message:message }).eq("id", claimed.run_id);
    }
    return json({ error:message, question_id:claimed?.question_id || null }, 500);
  }
});
