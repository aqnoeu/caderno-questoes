import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// v55: adapta questões já cadastradas (acervo atual ou Modelo novo) em afirmações de Sim/Não para o desafio diário.
// Só o administrador chama. As afirmações entram como RASCUNHO (inativas) e dependem de aprovação.
// Entrada: { source: "acervo" | "modelo_novo", question_ids?: string[], exclude_ids?: string[], limit?: number (1-10) }
// Saída:   { created, skipped: [{id, reason}], considered }

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "https://caderno-questoes.vercel.app";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
const MAX_SOURCES = 10;
const NEGATIVE_STEM = /(incorret|errad|falsa|exceto|n[aã]o\s+(?:est[aá]|[eé]|constitui|configura|corresponde)\b|n[aã]o\s+correta)/i;

function corsFor(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === SITE_ORIGIN || /^https:\/\/caderno-questoes[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  return { "Access-Control-Allow-Origin": allowed ? origin : SITE_ORIGIN, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
class GeminiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function askGemini(apiKey: string, prompt: string): Promise<any> {
  let status = 500, message = "Erro Gemini";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      try { return JSON.parse(text); } catch { throw new GeminiError(502, "A IA devolveu uma resposta inválida. Tente novamente."); }
    }
    status = response.status; message = data?.error?.message || message;
    const quota = /quota|billing/i.test(message);
    if ((status === 503 || status === 500 || (status === 429 && !quota)) && attempt < 3) { await sleep(attempt * 1500); continue; }
    break;
  }
  if (status === 429) throw new GeminiError(429, "A IA atingiu o limite de uso no momento. Tente novamente mais tarde.");
  if (status === 503) throw new GeminiError(503, "A IA está com alta demanda. Tente novamente em instantes.");
  throw new GeminiError(status >= 400 ? status : 500, "Não foi possível obter a resposta da IA agora.");
}

const altList = (value: unknown): { letter: string; text: string }[] => Array.isArray(value)
  ? value.map((item: any) => ({ letter: String(item?.letter || "").toUpperCase(), text: String(item?.text || "").trim() })).filter((item) => item.letter && item.text)
  : Object.entries((value || {}) as Record<string, unknown>).map(([letter, text]) => ({ letter: letter.toUpperCase(), text: String(text || "").trim() })).filter((item) => item.text);
const subjectText = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).join(" · ") : String(value || "").trim();

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY"), url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!apiKey || !url || !serviceKey) return json({ error: "A função não possui as credenciais necessárias." }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Acesso restrito ao administrador." }, 403);

    const body = await request.json().catch(() => ({}));
    const kind = body.source === "modelo_novo" ? "modelo_novo" : "acervo";
    const limit = Math.max(1, Math.min(MAX_SOURCES, Number(body.limit) || 5));
    const requestedIds: string[] = Array.isArray(body.question_ids) ? body.question_ids.map(String).slice(0, MAX_SOURCES) : [];
    const excludedIds = new Set<string>(Array.isArray(body.exclude_ids) ? body.exclude_ids.map(String).slice(0, 200) : []);

    // Origens já adaptadas (qualquer rascunho, aprovada ou rejeitada) não são adaptadas de novo.
    const { data: used } = await admin.from("challenge_questions").select("source_question_id").eq("source_kind", kind).not("source_question_id", "is", null);
    const usedIds = new Set((used || []).map((row: any) => String(row.source_question_id)));

    let candidates: any[] = [];
    if (kind === "acervo") {
      let query = admin.from("questions").select("id, statement, alternatives, correct_option, discipline, subject, explanation, is_annulled, is_hidden").eq("is_annulled", false).neq("correct_option", "*");
      if (requestedIds.length) query = query.in("id", requestedIds);
      const { data, error } = await query.limit(400);
      if (error) throw error;
      candidates = (data || []).map((row: any) => ({ id: row.id, statement: row.statement, alternatives: altList(row.alternatives), correct: String(row.correct_option || "").toUpperCase(), discipline: row.discipline, subject: row.subject, rule: row.explanation || "", basis: "", hidden: Boolean(row.is_hidden) }));
    } else {
      let query = admin.from("questions_v2").select("id, statement, alternatives, answer_key_option, discipline, subjects, central_rule, legal_basis, correct_answer_explanation").eq("status", "approved").eq("is_test", false).neq("answer_key_option", "*");
      if (requestedIds.length) query = query.in("id", requestedIds);
      const { data, error } = await query.limit(400);
      if (error) throw error;
      candidates = (data || []).map((row: any) => ({ id: row.id, statement: row.statement, alternatives: altList(row.alternatives), correct: String(row.answer_key_option || "").toUpperCase(), discipline: row.discipline, subject: subjectText(row.subjects), rule: [row.central_rule, row.correct_answer_explanation].filter(Boolean).join(" "), basis: row.legal_basis || "", hidden: false }));
    }

    const skipped: { id: string; reason: string }[] = [];
    const usable: any[] = [];
    for (const item of candidates.sort(() => Math.random() - 0.5)) {
      if (usable.length >= limit) break;
      if (excludedIds.has(String(item.id))) continue;
      if (usedIds.has(String(item.id))) { if (requestedIds.length) skipped.push({ id: item.id, reason: "Já adaptada antes." }); continue; }
      if (!item.statement || item.alternatives.length < 2 || !item.correct) { skipped.push({ id: item.id, reason: "Questão incompleta ou sem gabarito." }); continue; }
      if (!item.alternatives.some((alt: any) => alt.letter === item.correct)) { skipped.push({ id: item.id, reason: "Gabarito não corresponde a nenhuma alternativa." }); continue; }
      if (NEGATIVE_STEM.test(String(item.statement).slice(-400))) { skipped.push({ id: item.id, reason: "Enunciado pede a alternativa incorreta ou exceção: adaptação exige revisão manual." }); continue; }
      usable.push(item);
    }
    if (!usable.length) return json({ created: 0, skipped, considered: candidates.length, message: "Não há questões novas aptas para adaptar." });

    const payload = usable.map((item, index) => ({ index, enunciado: item.statement, alternativas: item.alternatives, alternativa_correta: item.correct, regra_ou_explicacao_da_questao: String(item.rule).slice(0, 1500), fundamento: String(item.basis).slice(0, 600) }));
    const prompt = `Você adapta questões objetivas jurídicas já cadastradas em afirmações curtas de SIM ou NÃO (certo ou errado) para um desafio diário. Use SOMENTE o conteúdo da questão informada. Não invente lei, súmula, jurisprudência, prazo ou fato.
Para cada questão, produza até duas afirmações, cada uma COMPLETA e autônoma (compreensível sem ver o enunciado nem as alternativas):
1) uma afirmação CERTA (correct_answer true): reescreva a alternativa correta como afirmação, incorporando do enunciado o contexto necessário. source_option = a letra da alternativa correta.
2) uma afirmação ERRADA (correct_answer false): reescreva a alternativa errada mais instrutiva como afirmação, mantendo o erro exatamente como está na alternativa. source_option = a letra dessa alternativa errada.
Se não for possível fazer a adaptação fiel de alguma delas (por exemplo, a alternativa depende de outras, como "todas as anteriores"), omita essa afirmação. Cada afirmação tem entre 25 e 350 caracteres, sem numeração e sem "Assinale". A explicação (1 a 3 frases) diz por que a afirmação é certa ou qual é o erro. O fundamento legal só entra se constar nos dados; senão deixe vazio. confidence vai de 0 a 1 e mede a fidelidade à questão original.
Retorne APENAS JSON válido.

QUESTÕES:
${JSON.stringify(payload)}

Formato: {"items":[{"index":0,"statements":[{"correct_answer":true,"statement":"...","explanation":"...","legal_basis":"","source_option":"B","confidence":0.0}]}]}`;

    const result = await askGemini(apiKey, prompt);
    const rows: any[] = [];
    for (const entry of Array.isArray(result.items) ? result.items : []) {
      const source = usable[Number(entry?.index)];
      if (!source) continue;
      for (const stmt of (Array.isArray(entry.statements) ? entry.statements : []).slice(0, 2)) {
        const text = String(stmt?.statement || "").replace(/\s+/g, " ").trim();
        const answer = stmt?.correct_answer === true ? true : stmt?.correct_answer === false ? false : null;
        const option = String(stmt?.source_option || "").toUpperCase();
        if (answer === null || text.length < 25 || text.length > 400) continue;
        if (!source.alternatives.some((alt: any) => alt.letter === option)) continue;
        if (answer === true && option !== source.correct) continue;
        if (answer === false && option === source.correct) continue;
        rows.push({
          statement: text, correct_answer: answer,
          discipline: source.discipline || null, subject: source.subject || null,
          explanation: String(stmt?.explanation || "").trim() || null,
          legal_basis: String(stmt?.legal_basis || "").trim() || (source.basis ? String(source.basis).slice(0, 300) : null),
          active: false, administratively_available: false, review_status: "draft",
          source_kind: kind, source_question_id: source.id, source_option: option,
          ai_generated: true, ai_confidence: Math.max(0, Math.min(1, Number(stmt?.confidence) || 0)),
          ai_note: source.hidden ? "A questão de origem está oculta dos estudos." : null,
        });
      }
    }
    let created = 0;
    if (rows.length) {
      const { data: existing } = await admin.from("challenge_questions").select("source_question_id, correct_answer").eq("source_kind", kind).in("source_question_id", [...new Set(rows.map((row) => row.source_question_id))]);
      const have = new Set((existing || []).map((row: any) => `${row.source_question_id}:${row.correct_answer}`));
      // Registro interno: pula afirmações muito parecidas com alguma que já existe (inclusive rejeitadas), exceto o par da mesma questão de origem.
      const fresh: any[] = [];
      for (const row of rows) {
        if (have.has(`${row.source_question_id}:${row.correct_answer}`)) continue;
        const { data: similar } = await admin.rpc("find_similar_challenge_statements", { p_statement: row.statement, p_threshold: 0.75, p_exclude_source: row.source_question_id });
        if (similar?.length) { skipped.push({ id: row.source_question_id, reason: `Muito parecida com a afirmação #${String(similar[0].id).slice(0, 8)} que já existe.` }); continue; }
        fresh.push(row);
      }
      for (const row of fresh) {
        const { error } = await admin.from("challenge_questions").insert(row);
        if (!error) created++;
        else if (error.code !== "23505") throw error;
      }
    }
    const covered = new Set(rows.map((row) => row.source_question_id));
    for (const item of usable) if (!covered.has(item.id)) skipped.push({ id: item.id, reason: "A IA não conseguiu adaptar com fidelidade." });
    // Origem já registrada por duplicidade não deve ser sorteada de novo na mesma rodada.
    return json({ created, skipped, considered: usable.length });
  } catch (error) {
    if (error instanceof GeminiError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
