import React from "react";

const CATEGORIES = [
  ["new_questions", "Novas questões", "📚"],
  ["revenge", "Revanche pendente", "⚔️"],
  ["achievement", "Conquistas", "🏆"],
  ["study", "Estudos pendentes", "🗓️"],
];
const DEFAULT_PREFS = Object.fromEntries(CATEGORIES.map(([key]) => [key, true]));

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function NotificationCenter({ supabase, userId, onNavigate }) {
  const [items, setItems] = React.useState([]);
  const [preferences, setPreferences] = React.useState(DEFAULT_PREFS);
  const [open, setOpen] = React.useState(false);
  const [showPreferences, setShowPreferences] = React.useState(false);
  const [error, setError] = React.useState("");
  const panelRef = React.useRef(null);

  const refresh = React.useCallback(async () => {
    if (!userId) return;
    const { data, error: fetchError } = await supabase
      .from("user_notifications")
      .select("id,category,title,body,destination,notebook_id,details,created_at,read_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (fetchError) { setError("Não foi possível carregar as notificações."); return; }
    setItems(data || []);
    setError("");
  }, [supabase, userId]);

  React.useEffect(() => {
    if (!userId) { setItems([]); setOpen(false); return undefined; }
    let active = true;
    (async () => {
      const { data } = await supabase.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle();
      if (active && data) setPreferences({ ...DEFAULT_PREFS, ...data });
      await supabase.rpc("sync_study_reminders");
      if (active) refresh();
    })();
    const timer = window.setInterval(refresh, 60000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [supabase, userId, refresh]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!panelRef.current?.contains(event.target)) setOpen(false); };
    const onEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onEscape);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onEscape); };
  }, [open]);

  const unread = items.filter((item) => !item.read_at).length;
  async function markRead(item) {
    if (!item.read_at) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase.from("user_notifications")
        .update({ read_at: now }).eq("id", item.id).eq("user_id", userId);
      if (updateError) { setError("Não foi possível marcar a notificação como lida."); return; }
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, read_at: now } : row));
    }
    setOpen(false);
    onNavigate(item.destination, item.notebook_id, item.details);
  }
  async function markAllRead() {
    const { error: updateError } = await supabase.from("user_notifications")
      .update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
    if (updateError) { setError("Não foi possível marcar as notificações como lidas."); return; }
    setItems((current) => current.map((item) => item.read_at ? item : { ...item, read_at: new Date().toISOString() }));
  }
  async function toggleCategory(key, checked) {
    const previous = preferences;
    const next = { ...preferences, [key]: checked };
    setPreferences(next);
    const payload = { user_id: userId, ...Object.fromEntries(CATEGORIES.map(([id]) => [id, Boolean(next[id])])), updated_at: new Date().toISOString() };
    const { error: updateError } = await supabase.from("notification_preferences").upsert(payload, { onConflict: "user_id" });
    if (updateError) { setPreferences(previous); setError("Não foi possível salvar sua preferência."); }
  }

  return (
    <div className="notification-center" ref={panelRef}>
      <button type="button" className="notification-bell" aria-label={"Notificações" + (unread ? ": " + unread + " não lidas" : "")}
        aria-expanded={open} onClick={() => { setOpen((value) => !value); setShowPreferences(false); if (!open) refresh(); }}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.85"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unread > 0 && <span className="notification-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && <section className="notification-panel" aria-label="Central de notificações">
        <div className="notification-panel-top">
          <strong>{showPreferences ? "Preferências" : "Notificações"}</strong>
          <button type="button" className="notification-close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
        </div>
        <div className="notification-tools">
          <button type="button" onClick={() => setShowPreferences((value) => !value)}>
            {showPreferences ? "← Voltar" : "⚙ Preferências"}
          </button>
          {!showPreferences && unread > 0 && <button type="button" onClick={markAllRead}>Marcar todas como lidas</button>}
        </div>
        {error && <p className="notification-error" role="alert">{error}</p>}
        {showPreferences ? (
          <div className="notification-options">
            {CATEGORIES.map(([key, label, emoji]) => <label key={key}>
              <span>{emoji} {label}</span>
              <input type="checkbox" checked={Boolean(preferences[key])}
                onChange={(event) => toggleCategory(key, event.target.checked)} />
            </label>)}
            <small>As preferências controlam os novos avisos. Notificações push poderão ser ativadas futuramente.</small>
          </div>
        ) : (
          <div className="notification-list">
            {items.length === 0 && <p className="notification-empty">Tudo em dia! Seus próximos avisos aparecerão aqui. ✨</p>}
            {items.map((item) => <button key={item.id} type="button"
              className={"notification-item" + (!item.read_at ? " unread" : "")} onClick={() => markRead(item)}>
              <span className="notification-emoji">{CATEGORIES.find(([id]) => id === item.category)?.[2] || (item.category === "admin_review" ? "🛡️" : item.category === "notebook_status" ? "📘" : "🔔")}</span>
              <span className="notification-copy"><strong>{item.title}</strong><span>{item.body}</span>
                <small>{formatTime(item.created_at)}</small></span>
              {!item.read_at && <i className="notification-dot" aria-label="Não lida" />}
            </button>)}
          </div>
        )}
      </section>}
    </div>
  );
}
