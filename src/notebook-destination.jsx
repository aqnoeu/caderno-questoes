import React from "react";

export function NotebookDestination({ supabase, value, onChange, required = false }) {
  const [books, setBooks] = React.useState([]);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let active = true;
    supabase
      .from("study_notebooks")
      .select("id,title,cargo")
      .eq("visibility", "official")
      .order("title")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setBooks(data || []);
      });
    return () => {
      active = false;
    };
  }, [supabase]);

  return (
    <label>
      Caderno de destino
      <select value={value} required={required} onChange={(event) => onChange(event.target.value)}>
        <option value="">
          {required ? "Selecione um caderno existente" : "Sem vínculo com caderno"}
        </option>
        {books.map((book) => (
          <option value={book.id} key={book.id}>
            {book.title}
            {book.cargo ? ` · ${book.cargo}` : ""}
          </option>
        ))}
      </select>
      {error && <small role="alert">Não foi possível carregar os cadernos. {error}</small>}
    </label>
  );
}
