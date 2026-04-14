import type { KvPair } from './mcpReducer'

export function KvPairRows({
  pairs, onChange, onAdd, onRemove, keyPlaceholder, valuePlaceholder,
}: {
  pairs: KvPair[]
  onChange: (index: number, key: string, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  keyPlaceholder: string
  valuePlaceholder: string
}) {
  return (
    <div className="settings-mcp-kv-list">
      {pairs.map((pair, i) => (
        <div key={i} className="settings-mcp-kv-row">
          <input
            className="settings-input settings-mcp-kv-key"
            value={pair.key}
            placeholder={keyPlaceholder}
            onChange={(e) => onChange(i, e.target.value, pair.value)}
          />
          <span className="settings-mcp-kv-eq">=</span>
          <input
            className="settings-input settings-mcp-kv-val"
            value={pair.value}
            placeholder={valuePlaceholder}
            onChange={(e) => onChange(i, pair.key, e.target.value)}
          />
          <button className="settings-lsp-remove-btn" onClick={() => onRemove(i)}>✕</button>
        </div>
      ))}
      <button className="btn btn--sm settings-mcp-add-kv-btn" onClick={onAdd}>+ Add</button>
    </div>
  )
}
