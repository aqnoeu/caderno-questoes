import React from "react";

const modalities = { objective: "Objetiva", piece: "Peça prática", discursive: "Discursiva" };

const statuses = {
  pending: "Aguardando aprovação",
  approved: "Aprovada para análise",
  rejected: "Recusada",
  published: "Cadastrada no acervo",
};

export async function submitEssaySuggestions(supabase, drafts, cargo) {
  const { error } = await supabase.from("essay_suggestions").insert(
    drafts.map((item) => ({
      question_type: item.question_type,
      statement: item.statement.trim(),
      answer_key_text: item.answer_key_text.trim(),
      concurso: item.concurso.trim(),
      banca: item.banca.trim(),
      ano: item.ano || null,
      question_number: item.question_number || null,
      discipline: item.discipline.trim(),
      contest_cargo: cargo.trim(),
    })),
  );
  if (error) throw error;
}

export function EssaySuggestions({ supabase, userId, onOpen }) {
  const [rows, setRows] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    let query = supabase
      .from("essay_suggestions")
      .select("*")
      .order("created_at", { ascending: false });
    query = userId ? query.eq("user_id", userId) : query.in("status", ["pending", "approved"]);
    const { data, error } = await query.limit(100);
    if (error) setMessage(error.message);
    setRows(data || []);
  }, [supabase, userId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function review(row, status) {
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase
        .from("essay_suggestions")
        .update({ status })
        .eq("id", row.id)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) setMessage("Esta sugestão já foi revisada.");
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="essay-admin">
      <h2>{userId ? "Minhas sugestões" : "Sugestões de questões"}</h2>
      {message && <p role="status">{message}</p>}
      {rows === null && <p>Carregando sugestões…</p>}
      {rows?.length === 0 && !message && <p>Nenhuma sugestão nesta lista.</p>}
      <div className="essay-import-list">
        {rows?.map((row) => (
          <article className="card essay-import-card" key={row.id}>
            <b>
              {row.concurso} · {modalities[row.question_type]}
            </b>
            <p>{row.question_type === "objective" && row.status === "published" ? "Encaminhada ao Filtro de IA" : statuses[row.status]}</p>
            <details>
              <summary>{row.question_type === "objective" ? "Ver questão e gabarito" : "Ver enunciado e espelho"}</summary>
              <pre className="essay-suggestion-text">{row.statement}</pre>
              {row.objective_options?.map((option, index) => (
                <p className="essay-suggestion-text" key={index}>{"ABCDEFGH"[index]}) {option}</p>
              ))}
              <b>{row.question_type === "objective" ? "Gabarito" : "Espelho"}</b>
              <pre className="essay-suggestion-text">{row.answer_key_text}</pre>
            </details>
            {!userId && (
              <div className="study-actions">
                {row.status === "pending" ? (
                  <>
                    <button disabled={busy} onClick={() => review(row, "approved")}>
                      Aprovar para análise
                    </button>
                    <button
                      className="light"
                      disabled={busy}
                      onClick={() => review(row, "rejected")}
                    >
                      Recusar
                    </button>
                  </>
                ) : (
                  <button onClick={() => onOpen(row)}>Abrir no cadastro</button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
