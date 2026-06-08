import { useState, useEffect, useCallback } from "react";

// ─── Konfiguracja ──────────────────────────────────────────────────────────────
const API_BASE = window.location.origin;
const API_KEY  = window.PRODUCTION_API_KEY || "zmien-mnie-na-bezpieczny-klucz";

const headers = { "x-api-key": API_KEY, "Content-Type": "application/json" };

async function apiFetch(path, opts = {}) {
  const r = await fetch(API_BASE + path, { headers, ...opts });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || r.statusText); }
  return r.json();
}

// ─── Kolory statusów ──────────────────────────────────────────────────────────
const STATUS_COLOR = {
  nowe:                    { bg: "#1e3a5f", text: "#60a5fa", label: "Nowe" },
  w_toku:                  { bg: "#1a3a1a", text: "#4ade80", label: "W toku" },
  zakonczone:              { bg: "#1a2a1a", text: "#86efac", label: "Zakończone" },
  oczekuje:                { bg: "#2d2d1a", text: "#fbbf24", label: "Oczekuje" },
  wstrzymane:              { bg: "#3a1a1a", text: "#f87171", label: "Wstrzymane" },
  oczekuje_potwierdzenia:  { bg: "#1a1a3a", text: "#a78bfa", label: "Do potw." },
  anulowane:               { bg: "#2a2a2a", text: "#6b7280", label: "Anulowane" },
};

const MRP_COLOR = { ok: "#4ade80", czesciowo: "#fbbf24", brak: "#f87171" };

// ─── Helpers ───────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = STATUS_COLOR[status] || STATUS_COLOR.nowe;
  return (
    <span style={{
      background: s.bg, color: s.text,
      fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em",
      padding: "2px 8px", borderRadius: 4, border: `1px solid ${s.text}33`,
      whiteSpace: "nowrap",
    }}>
      {s.label}
    </span>
  );
}

function ProgressBar({ value = 0, max = 100, color = "#3b82f6", height = 4 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "#ffffff14", borderRadius: 2, height, overflow: "hidden", minWidth: 60 }}>
      <div style={{
        width: `${pct}%`, height: "100%",
        background: color, borderRadius: 2,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function Spinner({ size = 20 }) {
  return (
    <div style={{
      width: size, height: size, border: `2px solid #ffffff20`,
      borderTop: `2px solid #3b82f6`, borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    }} />
  );
}

// ─── Komponent: węzeł drzewa ───────────────────────────────────────────────────
function TreeNode({ node, depth = 0, ilocZlecona = null }) {
  const [open, setOpen] = useState(depth < 2);

  const isM = node.typ === "M";
  const isG = node.typ === "G";
  const hasChildren = node.children && node.children.length > 0;

  const indent = depth * 22;
  const bgAlpha = Math.max(0.02, 0.12 - depth * 0.02);

  // Wyznacz kolor lewej krawędzi
  const borderColor = isG ? "#3b82f6" : isM ? "#6b7280" : "#8b5cf6";

  const zlecenie = node.zlecenia && node.zlecenia[0];
  const opDone   = zlecenie?.op_done || 0;
  const opTotal  = zlecenie?.op_total || 0;
  const progPct  = opTotal > 0 ? Math.round(opDone / opTotal * 100) : 0;

  const ilocBOM = node._bom_ilosc;
  const ilocEfekt = ilocZlecona != null && ilocBOM != null
    ? ilocBOM * ilocZlecona : ilocBOM;

  if (isM) {
    return (
      <div style={{
        marginLeft: indent, marginBottom: 2,
        background: `rgba(107,114,128,${bgAlpha})`,
        borderLeft: "2px solid #6b728040",
        borderRadius: 4, padding: "4px 10px",
        display: "flex", alignItems: "center", gap: 8,
        fontSize: "0.74rem", color: "#9ca3af",
      }}>
        <span style={{ opacity: 0.5, fontSize: "0.65rem" }}>▣</span>
        <span style={{ color: "#6b7280", minWidth: 70, fontFamily: "monospace" }}>
          {node.material_indeks}
        </span>
        <span style={{ flex: 1 }}>{node.material_opis || "—"}</span>
        {ilocEfekt != null && (
          <span style={{ color: "#d1d5db", fontWeight: 600 }}>
            {ilocEfekt.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} {node.material_jm || node.jednostka}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginLeft: indent, marginBottom: 4 }}>
      <div
        onClick={() => hasChildren && setOpen(o => !o)}
        style={{
          background: `rgba(255,255,255,${bgAlpha})`,
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: 4, padding: "7px 12px",
          cursor: hasChildren ? "pointer" : "default",
          display: "flex", alignItems: "center", gap: 10,
          transition: "background 0.15s",
          userSelect: "none",
        }}
        onMouseEnter={e => e.currentTarget.style.background = `rgba(255,255,255,${bgAlpha + 0.04})`}
        onMouseLeave={e => e.currentTarget.style.background = `rgba(255,255,255,${bgAlpha})`}
      >
        {/* Rozwinięcie */}
        <span style={{
          width: 16, textAlign: "center",
          color: hasChildren ? "#94a3b8" : "transparent",
          fontSize: "0.65rem", transition: "transform 0.2s",
          transform: open ? "rotate(90deg)" : "none", display: "inline-block",
        }}>▶</span>

        {/* Symbol */}
        <span style={{
          fontFamily: "monospace", fontWeight: 700,
          color: isG ? "#60a5fa" : "#a78bfa",
          fontSize: "0.8rem", minWidth: 70,
        }}>
          {node.symbol}
        </span>

        {/* Nazwa */}
        <span style={{ flex: 1, fontSize: "0.82rem", color: "#e2e8f0", lineHeight: 1.3 }}>
          {node.nazwa}
        </span>

        {/* Ilość z BOM */}
        {ilocEfekt != null && (
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", whiteSpace: "nowrap" }}>
            {ilocEfekt.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} {node.jednostka || "szt"}
          </span>
        )}

        {/* Status zlecenia */}
        {zlecenie && <StatusBadge status={zlecenie.status} />}

        {/* Postęp operacji */}
        {opTotal > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 80, alignItems: "flex-end" }}>
            <span style={{ fontSize: "0.65rem", color: "#64748b" }}>
              {opDone}/{opTotal} op. · {progPct}%
            </span>
            <ProgressBar value={opDone} max={opTotal}
              color={progPct === 100 ? "#4ade80" : "#3b82f6"} />
          </div>
        )}

        {/* Brak zlecenia */}
        {!zlecenie && !isG && (
          <span style={{
            fontSize: "0.67rem", color: "#f59e0b",
            border: "1px solid #f59e0b44", borderRadius: 3,
            padding: "1px 6px", whiteSpace: "nowrap",
          }}>
            Brak zlecenia
          </span>
        )}

        {/* Liczba dzieci */}
        {hasChildren && (
          <span style={{
            fontSize: "0.65rem", color: "#475569",
            background: "#ffffff10", borderRadius: 10,
            padding: "1px 6px", minWidth: 24, textAlign: "center",
          }}>
            {node.children.length}
          </span>
        )}
      </div>

      {open && hasChildren && (
        <div style={{ marginTop: 2 }}>
          {node.children.map((child, i) => (
            <TreeNode
              key={child._bom_id || `${child.symbol || child.material_indeks}-${i}`}
              node={child}
              depth={depth + 1}
              ilocZlecona={ilocEfekt || ilocZlecona}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Komponent: karta MRP ─────────────────────────────────────────────────────
function MRPCard({ gid }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState("zbiorczy"); // zbiorczy | szczegolowy | p-status

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/zlecenia/${gid}/mrp`)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [gid]);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner size={32} /></div>
  );
  if (error) return (
    <div style={{ color: "#f87171", padding: 16, fontSize: "0.8rem" }}>Błąd MRP: {error}</div>
  );
  if (!data) return null;

  const { summary, materialy_zbiorczy, materialy_szczegolowy, zapotrzebowania_p } = data;

  return (
    <div>
      {/* Summary */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Materiałów", val: summary.material_count, color: "#94a3b8" },
          { label: "OK", val: summary.ok_count, color: MRP_COLOR.ok },
          { label: "Częściowo", val: summary.czesciowo_count, color: MRP_COLOR.czesciowo },
          { label: "Brak", val: summary.brak_count, color: MRP_COLOR.brak },
        ].map(s => (
          <div key={s.label} style={{
            background: "#ffffff08", border: `1px solid ${s.color}33`,
            borderRadius: 8, padding: "10px 18px", textAlign: "center",
          }}>
            <div style={{ color: s.color, fontSize: "1.5rem", fontWeight: 700 }}>{s.val}</div>
            <div style={{ color: "#64748b", fontSize: "0.72rem", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Przełącznik widoku */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {[
          { id: "zbiorczy", label: "Materiały (zbiorczy)" },
          { id: "p-status", label: `Półprodukty P (${zapotrzebowania_p.length})` },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              background: view === tab.id ? "#3b82f6" : "#ffffff10",
              color: view === tab.id ? "#fff" : "#94a3b8",
              border: "none", borderRadius: 6,
              padding: "5px 14px", fontSize: "0.76rem",
              cursor: "pointer", fontWeight: 600,
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* Lista materiałów */}
      {view === "zbiorczy" && (
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ffffff15" }}>
                {["Indeks", "Opis", "Wymagane", "Dostępne", "Brak", "Status"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", color: "#64748b", textAlign: "left",
                    fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {materialy_zbiorczy.map((m, i) => (
                <tr key={m.material_indeks + i}
                  style={{ borderBottom: "1px solid #ffffff08",
                    background: i % 2 === 0 ? "transparent" : "#ffffff04" }}>
                  <td style={{ padding: "5px 10px", color: "#64748b", fontFamily: "monospace", fontSize: "0.72rem" }}>
                    {m.material_indeks}
                  </td>
                  <td style={{ padding: "5px 10px", color: "#cbd5e1" }}>{m.material_opis}</td>
                  <td style={{ padding: "5px 10px", color: "#e2e8f0", textAlign: "right" }}>
                    {m.ilosc_wymagana.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} {m.material_jm}
                  </td>
                  <td style={{ padding: "5px 10px", color: "#94a3b8", textAlign: "right" }}>
                    {(m.material_stan || 0).toLocaleString("pl-PL", { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: "5px 10px", textAlign: "right",
                    color: m.braki > 0 ? MRP_COLOR.brak : MRP_COLOR.ok, fontWeight: m.braki > 0 ? 700 : 400 }}>
                    {m.braki > 0
                      ? `-${m.braki.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}`
                      : "OK"}
                  </td>
                  <td style={{ padding: "5px 10px" }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: MRP_COLOR[m.status_dostepnosci],
                      display: "inline-block",
                    }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {materialy_zbiorczy.length === 0 && (
            <div style={{ color: "#475569", textAlign: "center", padding: 24, fontSize: "0.8rem" }}>
              Brak zdefiniowanego BOM dla tego wyrobu. Zaimportuj drzewo G/P lub uzupełnij ręcznie.
            </div>
          )}
        </div>
      )}

      {/* Półprodukty P */}
      {view === "p-status" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {zapotrzebowania_p.length === 0 && (
            <div style={{ color: "#475569", textAlign: "center", padding: 24, fontSize: "0.8rem" }}>
              Brak zapotrzebowań P. Utwórz je przez import drzewa lub ręcznie.
            </div>
          )}
          {zapotrzebowania_p.map(z => (
            <div key={z.id} style={{
              background: "#ffffff06", border: "1px solid #ffffff10",
              borderRadius: 6, padding: "8px 14px",
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <span style={{ color: "#a78bfa", fontFamily: "monospace", fontWeight: 700, minWidth: 70 }}>
                {z.wyrob_p_symbol}
              </span>
              <span style={{ color: "#e2e8f0", flex: 1, fontSize: "0.8rem" }}>
                {z.wyrob_nazwa || "—"}
              </span>
              <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
                {z.ilosc_wymagana} szt.
              </span>
              {z.p_numer
                ? <StatusBadge status={z.p_status || "nowe"} />
                : (
                  <span style={{
                    fontSize: "0.67rem", color: "#f59e0b",
                    border: "1px solid #f59e0b44", borderRadius: 3, padding: "1px 6px",
                  }}>Brak zlecenia P</span>
                )
              }
              {z.priorytet > 0 && (
                <span style={{ fontSize: "0.65rem", color: "#ef4444" }}>
                  Priorytet {z.priorytet}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel importu PDF ────────────────────────────────────────────────────────
function ImportPanel({ onImported }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const doUpload = async (file) => {
    setUploading(true); setError(null); setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`${API_BASE}/api/import-drzewo-gp`, {
        method: "POST", headers: { "x-api-key": API_KEY }, body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Błąd importu");
      setResult(d);
      onImported?.();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  };

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) doUpload(f); }}
        style={{
          border: `2px dashed ${dragging ? "#3b82f6" : "#ffffff20"}`,
          borderRadius: 8, padding: "32px 24px", textAlign: "center",
          background: dragging ? "#1e3a5f22" : "transparent",
          transition: "all 0.2s", cursor: "pointer",
        }}
        onClick={() => document.getElementById("pdf-upload-gp").click()}
      >
        <input
          id="pdf-upload-gp" type="file" accept=".pdf" style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) doUpload(e.target.files[0]); }}
        />
        {uploading
          ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Spinner size={28} />
              <span style={{ color: "#64748b", fontSize: "0.8rem" }}>Parsowanie PDF…</span>
            </div>
          : <>
              <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>📄</div>
              <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>
                Przeciągnij PDF drzewa technologicznego z Graffiti ERP<br />
                lub kliknij, by wybrać plik
              </div>
            </>
        }
      </div>
      {error && (
        <div style={{ color: "#f87171", fontSize: "0.78rem", marginTop: 10 }}>
          ✗ {error}
        </div>
      )}
      {result && (
        <div style={{
          background: "#1a3a1a", border: "1px solid #4ade8044",
          borderRadius: 6, padding: 12, marginTop: 10, fontSize: "0.78rem", color: "#86efac",
        }}>
          ✓ Import zakończony: <strong>{result.symbol_glowny}</strong> · {result.wyroby_created} nowych wyrobów
          · {result.bom_created} pozycji BOM · {result.items_parsed} pozycji w PDF
          {result.errors?.length > 0 && (
            <div style={{ color: "#fbbf24", marginTop: 6 }}>
              Ostrzeżenia ({result.errors.length}): {result.errors.slice(0, 3).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Główny widok ─────────────────────────────────────────────────────────────
export default function DrzewoGP() {
  const [wyrobyG, setWyrobyG] = useState([]);
  const [wyrobyP, setWyrobyP] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedG, setSelectedG] = useState(null);
  const [selectedTree, setSelectedTree] = useState(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [panel, setPanel] = useState("drzewo"); // drzewo | mrp | import
  const [searchQ, setSearchQ] = useState("");
  const [zleceniaG, setZleceniaG] = useState([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [g, p, zl] = await Promise.all([
        apiFetch("/api/wyroby?typ=G"),
        apiFetch("/api/wyroby?typ=P"),
        apiFetch("/api/zlecenia?status=w_toku"),
      ]);
      setWyrobyG(g);
      setWyrobyP(p);
      setZleceniaG(zl.filter(z => g.some(wg => wg.symbol === z.numer)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const loadTree = useCallback(async (wid) => {
    setLoadingTree(true); setSelectedTree(null);
    try {
      const tree = await apiFetch(`/api/wyroby/${wid}/drzewo`);
      setSelectedTree(tree);
    } catch (e) { console.error(e); }
    finally { setLoadingTree(false); }
  }, []);

  useEffect(() => {
    if (selectedG) loadTree(selectedG.id);
  }, [selectedG, loadTree]);

  const filteredG = wyrobyG.filter(w =>
    !searchQ ||
    w.symbol.toLowerCase().includes(searchQ.toLowerCase()) ||
    w.nazwa.toLowerCase().includes(searchQ.toLowerCase())
  );

  const zleceniaForG = selectedG
    ? zleceniaG.filter(z => z.numer === selectedG.symbol)
    : [];
  const zlecenieG = zleceniaForG[0] || null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0f1e 0%, #0f172a 60%, #0a1628 100%)",
      color: "#e2e8f0",
      fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ffffff20; border-radius: 3px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        borderBottom: "1px solid #ffffff10",
        padding: "14px 28px",
        display: "flex", alignItems: "center", gap: 20,
        background: "#ffffff04",
      }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#60a5fa", letterSpacing: "0.05em" }}>
          STRUKTURA G/P
        </div>
        <div style={{ color: "#334155", fontSize: "0.75rem" }}>
          {wyrobyG.length} wyrobów G · {wyrobyP.length} półproduktów P
        </div>
        <div style={{ flex: 1 }} />
        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Szukaj G/P…"
          style={{
            background: "#ffffff0a", border: "1px solid #ffffff15",
            borderRadius: 6, padding: "5px 12px", color: "#e2e8f0",
            fontSize: "0.78rem", width: 200, outline: "none",
          }}
        />
        <button
          onClick={() => { setSelectedG(null); setSelectedTree(null); setPanel("import"); }}
          style={{
            background: "#1e3a5f", color: "#60a5fa",
            border: "1px solid #3b82f660", borderRadius: 6,
            padding: "5px 14px", fontSize: "0.76rem",
            cursor: "pointer", fontWeight: 600,
          }}
        >
          + Import PDF
        </button>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 54px)" }}>

        {/* ── Lewa kolumna: lista G ── */}
        <div style={{
          width: 260, borderRight: "1px solid #ffffff10",
          overflowY: "auto", padding: "12px 8px",
          background: "#ffffff03",
        }}>
          {loading
            ? <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
            : filteredG.length === 0
              ? <div style={{ color: "#475569", textAlign: "center", padding: 24, fontSize: "0.78rem" }}>
                  Brak wyrobów G. Zaimportuj drzewo z PDF.
                </div>
              : filteredG.map(wg => {
                  const isActive = selectedG?.id === wg.id;
                  const zl = zleceniaG.find(z => z.numer === wg.symbol);
                  return (
                    <div
                      key={wg.id}
                      onClick={() => { setSelectedG(wg); setPanel("drzewo"); }}
                      style={{
                        padding: "9px 12px", borderRadius: 6, cursor: "pointer",
                        marginBottom: 3,
                        background: isActive ? "#1e3a5f" : "transparent",
                        border: isActive ? "1px solid #3b82f640" : "1px solid transparent",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#ffffff08"; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: "0.78rem" }}>
                          {wg.symbol}
                        </span>
                        {zl && <StatusBadge status={zl.status} />}
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "0.72rem", lineHeight: 1.3 }}>
                        {wg.nazwa.length > 50 ? wg.nazwa.slice(0, 50) + "…" : wg.nazwa}
                      </div>
                    </div>
                  );
                })
          }
        </div>

        {/* ── Prawy panel ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {/* Import panel */}
          {panel === "import" && !selectedG && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#60a5fa", marginBottom: 16 }}>
                Import drzewa G/P z Graffiti ERP
              </div>
              <ImportPanel onImported={reload} />
            </div>
          )}

          {/* Brak wyboru */}
          {!selectedG && panel !== "import" && (
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              height: "70vh", gap: 12, color: "#334155",
            }}>
              <div style={{ fontSize: "3rem", opacity: 0.3 }}>⬡</div>
              <div style={{ fontSize: "0.85rem" }}>Wybierz wyrób G z listy po lewej</div>
              <div style={{ fontSize: "0.75rem" }}>
                lub zaimportuj drzewo technologiczne z Graffiti ERP
              </div>
            </div>
          )}

          {/* Widok wybranego G */}
          {selectedG && (
            <div style={{ animation: "fadeIn 0.2s ease" }}>
              {/* Nagłówek */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 16,
                marginBottom: 20, flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: "1.1rem" }}>
                      {selectedG.symbol}
                    </span>
                    {zlecenieG && <StatusBadge status={zlecenieG.status} />}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: "0.82rem", marginTop: 4 }}>
                    {selectedG.nazwa}
                  </div>
                  {selectedG.numer_rysunku && (
                    <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 2 }}>
                      Rys. {selectedG.numer_rysunku}
                    </div>
                  )}
                </div>

                {zlecenieG && (
                  <div style={{
                    marginLeft: "auto", background: "#ffffff08",
                    borderRadius: 8, padding: "8px 16px",
                    display: "flex", gap: 20,
                  }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: "#60a5fa", fontWeight: 700, fontSize: "1.1rem" }}>
                        {zlecenieG.ilosc_sztuk}
                      </div>
                      <div style={{ color: "#64748b", fontSize: "0.68rem" }}>sztuk</div>
                    </div>
                    {zlecenieG.termin && (
                      <div style={{ textAlign: "center" }}>
                        <div style={{ color: "#f59e0b", fontWeight: 700, fontSize: "0.85rem" }}>
                          {zlecenieG.termin}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.68rem" }}>termin</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Zakładki */}
              <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #ffffff10", paddingBottom: 8 }}>
                {[
                  { id: "drzewo", label: "Drzewo BOM" },
                  { id: "mrp", label: "MRP / Materiały" },
                  { id: "import", label: "Import PDF" },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setPanel(tab.id)}
                    style={{
                      background: panel === tab.id ? "#3b82f6" : "transparent",
                      color: panel === tab.id ? "#fff" : "#64748b",
                      border: "none", borderRadius: 6,
                      padding: "6px 16px", fontSize: "0.78rem",
                      cursor: "pointer", fontWeight: 600,
                      transition: "all 0.15s",
                    }}
                  >{tab.label}</button>
                ))}
              </div>

              {/* Treść zakładki */}
              {panel === "drzewo" && (
                loadingTree
                  ? <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#475569", padding: 24 }}>
                      <Spinner /> <span style={{ fontSize: "0.8rem" }}>Ładowanie drzewa…</span>
                    </div>
                  : selectedTree
                    ? <TreeNode node={selectedTree} depth={0} ilocZlecona={zlecenieG?.ilosc_sztuk || 1} />
                    : <div style={{ color: "#475569", padding: 24, fontSize: "0.8rem" }}>
                        Brak struktury BOM dla tego wyrobu. Zaimportuj drzewo z PDF.
                      </div>
              )}

              {panel === "mrp" && zlecenieG && <MRPCard gid={zlecenieG.id} />}
              {panel === "mrp" && !zlecenieG && (
                <div style={{ color: "#475569", padding: 24, fontSize: "0.8rem" }}>
                  Brak aktywnego zlecenia G dla tego wyrobu. Utwórz zlecenie o numerze "{selectedG.symbol}".
                </div>
              )}

              {panel === "import" && (
                <div style={{ maxWidth: 540 }}>
                  <div style={{ color: "#64748b", fontSize: "0.78rem", marginBottom: 12 }}>
                    Import zaktualizuje strukturę BOM wyrobu {selectedG.symbol}
                  </div>
                  <ImportPanel onImported={() => { reload(); loadTree(selectedG.id); }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
