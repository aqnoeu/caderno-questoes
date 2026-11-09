import React from "react";
import { resolveNotebookV63 } from "./system2";

const types = { objective: "Objetiva", discursive: "Discursiva", piece: "Peça processual" };
const labels = {
  pending: "Aguardando conferência",
  incomplete: "Com pendências",
  ready: "Sem campos faltantes",
  released: "Encaminhadas",
};

export function ExternalImportReview({ supabase }) {
  const [rows, setRows] = React.useState([]);
  const [view, setView] = React.useState("pending");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const load = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("external_question_imports")
      .select("id,batch_name,modality,payload,revision,status,missing_fields")
      .eq("status", view)
      .order("created_at", { ascending: false });
    if (error) setMessage(error.message);
    else setRows(data);
  }, [supabase, view]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function act(row, action) {
    setBusy(true);
    setMessage("");
    try {
      if (action === "check") {
        const { data, error } = await supabase.functions.invoke("check-external-import", {
          body: { id: row.id },
        });
        if (error) {
          const detail = await error.context?.json?.().catch(() => null);
          throw new Error(detail?.error || error.message);
        }
        setMessage(
          data.status === "ready"
            ? "Conferência concluída. A questão está pronta para revisão final."
            : "Confira os campos apontados na aba Com pendências.",
        );
      } else {
        const p = row.payload;
        const notebook = await resolveNotebookV63(supabase, p.concurso, p.cargo, [p.discipline], 1);
        const { error } = await supabase.rpc("release_external_question_import", {
          import_row_id: row.id,
          expected_revision: row.revision,
          notebook: notebook.notebook_id,
        });
        if (error) throw error;
        setMessage(
          row.modality === "objective"
            ? "Questão encaminhada ao Controle de Conteúdo para promoção."
            : "Questão cadastrada no caderno.",
        );
      }
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="system2-page">
      <span className="eyebrow">GESTÃO</span>
      <h1>Revisão de importações</h1>
      <p>
        Confira o preenchimento das objetivas, discursivas e peças cadastradas pelo assistente. A
        conferência aponta campos faltantes e textos provisórios.
      </p>
      <nav className="study-actions" aria-label="Situação da importação">
        {Object.entries(labels).map(([key, label]) => (
          <button
            type="button"
            className={view === key ? "" : "light"}
            key={key}
            aria-pressed={view === key}
            disabled={busy || view === key}
            onClick={() => {
              setRows([]);
              setView(key);
              setMessage("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <button type="button" className="light" disabled={busy} onClick={load}>
        Atualizar lista
      </button>
      {message && <p role="status">{message}</p>}
      {rows.length === 0 && <p>Nenhuma importação nesta lista.</p>}
      {rows
        .filter((row) => row.status === view)
        .map((row) => (
          <article className="card system2-form" key={row.id}>
            <h2>
              {row.batch_name} · {types[row.modality]}
              {row.payload.question_number ? ` ${row.payload.question_number}` : ""}
            </h2>
            <p className="essay-suggestion-text">{row.payload.statement}</p>
            <details>
              <summary>Conferir campos cadastrados</summary>
              <pre className="essay-suggestion-text">{JSON.stringify(row.payload, null, 2)}</pre>
            </details>
            {row.missing_fields.length > 0 && (
              <ul>
                {row.missing_fields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            )}
            {view === "pending" && (
              <button type="button" disabled={busy} onClick={() => act(row, "check")}>
                Conferir preenchimento
              </button>
            )}
            {view === "ready" && (
              <button type="button" disabled={busy} onClick={() => act(row, "release")}>
                {row.modality === "objective"
                  ? "Encaminhar ao Controle de Conteúdo"
                  : "Cadastrar no acervo"}
              </button>
            )}
          </article>
        ))}
    </section>
  );
}
