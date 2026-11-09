import React from "react";

const emptyCampaign = { title: "", message: "" };
const channels = { notification: "Notificação normal", popup: "Pop-up" };

export function SupportCampaigns({ supabase, enabled }) {
  const [campaigns, setCampaigns] = React.useState([]);
  const [draft, setDraft] = React.useState(null);
  const [delivery, setDelivery] = React.useState("notification");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const reload = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("support_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setStatus(error.message);
    else setCampaigns(data);
  }, [supabase]);
  React.useEffect(() => {
    reload();
  }, [reload]);

  async function save(event) {
    event.preventDefault();
    const payload = { title: draft.title.trim(), message: draft.message.trim() };
    if (!payload.title || !payload.message) return setStatus("Preencha o título e a mensagem.");
    setBusy(true);
    try {
      const table = supabase.from("support_campaigns");
      const query = draft.id ? table.update(payload).eq("id", draft.id) : table.insert(payload);
      const { error } = await query.select().single();
      if (error) throw error;
      setDraft(null);
      setStatus("Campanha salva como rascunho.");
      await reload();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function send(campaign) {
    if (
      !window.confirm(
        `Enviar “${campaign.title}” por ${channels[delivery]} aos alunos que aceitam convites de apoio?`,
      )
    )
      return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("admin_send_support_campaign", {
        campaign_id: campaign.id,
        delivery,
      });
      if (error) throw error;
      setStatus(
        data
          ? `Campanha enviada a ${data} aluno(s).`
          : "Nenhum aluno elegível. A campanha continua como rascunho.",
      );
      await reload();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-finance-settings">
      <h2>Campanhas de apoio</h2>
      <p>Cada campanha tem seu próprio título e mensagem e leva à página de apoio.</p>
      {!enabled && <p>Ative a página de apoio para enviar campanhas.</p>}
      <button
        type="button"
        disabled={busy || Boolean(draft)}
        onClick={() => setDraft(emptyCampaign)}
      >
        Nova campanha
      </button>
      {draft && (
        <form className="admin-finance-settings" onSubmit={save}>
          <h3>{draft.id ? "Editar mensagem da campanha" : "Nova campanha"}</h3>
          <label>
            Título
            <input
              required
              maxLength={120}
              disabled={busy}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            Mensagem
            <textarea
              required
              rows={5}
              maxLength={3000}
              disabled={busy}
              value={draft.message}
              onChange={(event) => setDraft({ ...draft, message: event.target.value })}
            />
          </label>
          <div className="admin-finance-actions">
            <button type="submit" disabled={busy}>
              Salvar rascunho
            </button>
            <button type="button" className="light" disabled={busy} onClick={() => setDraft(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      <label>
        Formato do próximo envio
        <select
          value={delivery}
          disabled={busy}
          onChange={(event) => setDelivery(event.target.value)}
        >
          {Object.entries(channels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {campaigns.map((campaign) => (
        <article className="card" key={campaign.id}>
          <h3>{campaign.title}</h3>
          <p className="support-message">{campaign.message}</p>
          {campaign.sent_at ? (
            <p>
              {channels[campaign.channel]} · {campaign.recipient_count} destinatário(s) ·{" "}
              {new Date(campaign.sent_at).toLocaleString("pt-BR")}
            </p>
          ) : (
            <div className="admin-finance-actions">
              <button
                type="button"
                className="light"
                disabled={busy || Boolean(draft)}
                onClick={() => setDraft(campaign)}
              >
                Editar mensagem
              </button>
              <button
                type="button"
                disabled={busy || Boolean(draft) || !enabled}
                onClick={() => send(campaign)}
              >
                Enviar campanha
              </button>
            </div>
          )}
        </article>
      ))}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
