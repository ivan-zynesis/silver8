interface Props {
  symbols: string[];
  selected: string | null;
  onChange: (symbol: string | null) => void;
}

export function SymbolPicker({ symbols, selected, onChange }: Props) {
  return (
    <div className="symbol-picker">
      <label htmlFor="symbol-select">Symbol&nbsp;</label>
      <select
        id="symbol-select"
        value={selected ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">— pick a symbol —</option>
        {symbols.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
