import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
const answer = (request, body, status = 200) => {
  const origin = request.headers.get("Origin") || "";
  const allowed =
    origin === "https://caderno-questoes.vercel.app" ||
    /^https:\/\/caderno-questoes[a-z0-9-]*\.vercel\.app$/.test(origin) ||
    /^http:\/\/localhost:\d+$/.test(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowed ? origin : "https://caderno-questoes.vercel.app",
      "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    },
  });
};
const json = (v) =>
  JSON.parse(
    String(v || "{}")
      .trim()
      .replace(/^`{3}(?:json)?\s*/i, "")
      .replace(/\s*`{3}$/, ""),
  );
async function groq(prompt) {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw Error("Groq não configurado.");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Crie conteúdos jurídicos brasileiros fiéis à legislação. Apenas JSON.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error("Groq (" + r.status + "): " + String(j.error?.message || "Serviço indisponível.").slice(0,280));
  try { return json(j.choices?.[0]?.message?.content); }
  catch { throw Error("Groq respondeu fora do formato JSON esperado. Tente gerar novamente."); }
}
async function gemini(prompt) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw Error("Gemini não configurado.");
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.03 },
      }),
    },
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error("Gemini (" + r.status + "): " + String(j.error?.message || "Serviço indisponível.").slice(0,280));
  try { return json(j.candidates?.[0]?.content?.parts?.[0]?.text); }
  catch { throw Error("Gemini respondeu fora do formato JSON esperado. Tente gerar novamente."); }
}
const publicState = (session, item) => {
  const index = session.current_index || 0,
    done = session.state === "completed",
    attempt = item?.answers?.length || 0;
  return {
    session_id: session.id,
    cycle_id: session.cycle_id,
    state: session.state,
    total_errors: session.question_ids.length,
    completed_errors: index,
    mastered_count: session.mastered_count,
    perfect: done && session.mastered_count === session.question_ids.length,
    current: done
      ? null
      : {
          question_id: session.question_ids[index],
          ready: !!item,
          attempt_number: attempt + 1,
          statement: item?.statements?.[attempt]?.text || null,
          previous_feedback: attempt === 1 ? item.answers[0].feedback : null,
        },
    completed_at: session.completed_at,
  };
};
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    const r = answer(request, {});
    return new Response(null, { headers: r.headers });
  }
  if (request.method !== "POST") return answer(request, { error: "Método não permitido." }, 405);
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } },
    );
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authErr } = await db.auth.getUser(token);
    if (authErr || !auth.user) return answer(request, { error: "Sessão inválida." }, 401);
    const user = auth.user.id,
      body = await request.json().catch(() => ({})),
      action = body.action || "state",
      notebook = String(body.notebook_id || ""),
      cycleId = String(body.cycle_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(notebook))
      return answer(request, { error: "Caderno inválido." }, 400);
    if (action === "history") {
      const { data, error } = await db
        .from("revenge_sessions")
        .select(
          "id,cycle_id,question_ids,current_index,mastered_count,state,created_at,completed_at",
        )
        .eq("user_id", user)
        .eq("notebook_id", notebook)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return answer(request, {
        sessions: (data || []).map((s) => ({
          id: s.id,
          cycle_id: s.cycle_id,
          total_errors: s.question_ids.length,
          completed_errors: s.current_index,
          mastered_count: s.mastered_count,
          state: s.state,
          perfect: s.state === "completed" && s.mastered_count === s.question_ids.length,
          created_at: s.created_at,
        })),
      });
    }
    if (
      !["start", "state", "generate", "answer"].includes(action) ||
      !/^[0-9a-f-]{36}$/i.test(cycleId)
    )
      return answer(request, { error: "Ação ou ciclo inválido." }, 400);
    const { data: cycle } = await db
      .from("study_cycles")
      .select("user_id,notebook_id,completed_at,question_ids,progress")
      .eq("id", cycleId)
      .eq("user_id", user)
      .eq("notebook_id", notebook)
      .maybeSingle();
    if (!cycle?.completed_at)
      return answer(
        request,
        { error: "Somente ciclos seus e concluídos podem iniciar uma Revanche." },
        403,
      );
    const errors = (cycle.question_ids || []).filter((id, i) => cycle.progress?.[i] === "wrong");
    if (action === "start") {
      if (!errors.length) return answer(request, { error: "Este ciclo não possui erros." }, 400);
      const { error } = await db
        .from("revenge_sessions")
        .upsert(
          { user_id: user, notebook_id: notebook, cycle_id: cycleId, question_ids: errors },
          { onConflict: "user_id,cycle_id", ignoreDuplicates: true },
        );
      if (error) throw error;
    }
    const { data: session, error: sessionErr } = await db
      .from("revenge_sessions")
      .select("*")
      .eq("cycle_id", cycleId)
      .eq("user_id", user)
      .eq("notebook_id", notebook)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return answer(request, { error: "Inicie a Revanche primeiro." }, 404);
    if (session.state === "completed") return answer(request, publicState(session, null));
    const questionId = session.question_ids[session.current_index];
    const { data: item } = await db
      .from("revenge_items")
      .select("*")
      .eq("session_id", session.id)
      .eq("question_id", questionId)
      .maybeSingle();
    if (action === "generate") {
      if (item) return answer(request, publicState(session, item));
      const { data: q } = await db
        .from("questions")
        .select(
          "statement,alternatives,correct_option,central_rule,legal_basis,correct_answer_explanation,option_error_analysis",
        )
        .eq("id", questionId)
        .maybeSingle();
      if (!q) return answer(request, { error: "Questão original indisponível." }, 404);
      const { data: mistake } = await db
        .from("answers")
        .select("selected_option")
        .eq("user_id", user)
        .eq("notebook_id", notebook)
        .eq("question_id", questionId)
        .lte("answered_at", cycle.completed_at)
        .order("answered_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const selected = mistake?.selected_option || "",
        diagnostic = q.option_error_analysis?.[selected] || {};
      if (!q.central_rule || !q.legal_basis || !diagnostic.wrong_reasoning)
        return answer(
          request,
          { error: "Diagnóstico jurídico insuficiente para uma Revanche segura." },
          422,
        );
      const context = {
        statement: q.statement,
        alternatives: q.alternatives,
        correct_option: q.correct_option,
        central_rule: q.central_rule,
        legal_basis: q.legal_basis,
        explanation: q.correct_answer_explanation,
        wrong_option: selected,
        wrong_reasoning: diagnostic.wrong_reasoning,
        study_content: diagnostic.study_content,
      };
      const { data: countRows } = await db
        .from("revenge_sessions")
        .select("id")
        .eq("user_id", user);
      const ids = (countRows || []).map((x) => x.id);
      if (ids.length) {
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        const { count } = await db
          .from("revenge_items")
          .select("id", { head: true, count: "exact" })
          .in("session_id", ids)
          .gte("created_at", start.toISOString());
        if ((count || 0) >= 80)
          return answer(
            request,
            { error: "Limite diário de gerações atingido. Tente novamente amanhã." },
            429,
          );
      }
      const generated = await groq(
        'Crie exatamente DUAS afirmações novas de verdadeiro/falso para corrigir especificamente o raciocínio equivocado do aluno. Uma verdadeira e uma falsa, ambas juridicamente seguras, distintas e não meras cópias da questão. Apresente explicações didáticas curtas. Baseie-se APENAS nos fundamentos fornecidos, sem inventar normas. Formato JSON: {"statements":[{"text":"...","correct":true,"explanation":"..."},{"text":"...","correct":false,"explanation":"..."}]}. CONTEXTO:' +
          JSON.stringify(context),
      );
      const pair = generated.statements;
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some(
          (x) =>
            typeof x.correct !== "boolean" ||
            !String(x.text || "").trim() ||
            !String(x.explanation || "").trim(),
        ) ||
        pair[0].correct === pair[1].correct
      )
        return answer(
          request,
          { error: "Groq não criou duas afirmações válidas. Tente novamente." },
          422,
        );
      const review = await gemini(
        'Verifique independentemente se CADA afirmação está correta ou incorreta como indicada, se as explicações são juridicamente exatas, não ambíguas, não inventadas e se corrigem o erro de raciocínio. Rejeite se qualquer uma for duvidosa. Retorne JSON {"approved":true,"reason":"..."}. CONTEXTO:' +
          JSON.stringify(context) +
          " AFIRMAÇÕES:" +
          JSON.stringify(pair),
      );
      if (review.approved !== true)
        return answer(
          request,
          { error: "O Gemini rejeitou a validação jurídica. Tente novamente." },
          422,
        );
      const { error: writeError } = await db.from("revenge_items").upsert(
        {
          session_id: session.id,
          question_id: questionId,
          statements: pair,
          provider_info: { generator: "groq", validator: "gemini" },
        },
        { onConflict: "session_id,question_id", ignoreDuplicates: true },
      );
      if (writeError) throw writeError;
      const { data: created } = await db
        .from("revenge_items")
        .select("*")
        .eq("session_id", session.id)
        .eq("question_id", questionId)
        .single();
      return answer(request, publicState(session, created));
    }
    if (action === "answer") {
      if (!item || item.completed)
        return answer(request, { error: "Afirmação indisponível ou já concluída." }, 409);
      if (typeof body.answer !== "boolean")
        return answer(request, { error: "Escolha verdadeiro ou falso." }, 400);
      const used = item.answers || [],
        current = item.statements?.[used.length];
      if (!current) return answer(request, { error: "Tentativas esgotadas." }, 409);
      const correct = current.correct === body.answer,
        feedback = { correct, answer: body.answer, feedback: current.explanation };
      const next = [...used, feedback],
        finished = correct || next.length === 2;
      const { data: saved, error: saveErr } = await db
        .from("revenge_items")
        .update({ answers: next, completed: finished, mastered: correct })
        .eq("id", item.id)
        .eq("completed", false)
        .select("id")
        .maybeSingle();
      if (saveErr || !saved) return answer(request, { error: "Resposta já recebida." }, 409);
      if (finished) {
        const index = session.current_index + 1,
          last = index >= session.question_ids.length;
        const { error: advanceErr } = await db
          .from("revenge_sessions")
          .update({
            current_index: index,
            mastered_count: session.mastered_count + (correct ? 1 : 0),
            state: last ? "completed" : "active",
            completed_at: last ? new Date().toISOString() : null,
          })
          .eq("id", session.id)
          .eq("current_index", session.current_index);
        if (advanceErr) throw advanceErr;
      }
      return answer(request, {
        correct,
        feedback: current.explanation,
        advanced: finished,
        failed: finished && !correct,
        attempt: next.length,
        finished: finished && session.current_index + 1 === session.question_ids.length,
      });
    }
    return answer(request, publicState(session, item));
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Falha inesperada na Revanche.";
    console.error("revenge-mode:", detail);
    const providerFailure = /^(Groq|Gemini)\b/.test(detail);
    return answer(request, { error: detail, retryable: providerFailure }, providerFailure ? 502 : 500);
  }
});
