import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Competitors() {
  const [competitors, setCompetitors] = useState([]);
  const [market, setMarket] = useState("Postpartum pelvic floor recovery devices and Kegel trainers sold in the US");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [busyCard, setBusyCard] = useState(null);
  const [msg, setMsg] = useState(null);

  async function load() {
    try {
      setCompetitors(await api.competitors());
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  useEffect(() => { load(); }, []);

  async function research() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.researchCompetitors({ market, count: Number(count) });
      setMsg({ type: "good", text: `Added ${res.added} competitors.` });
      load();
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function makeBattlecard(id) {
    setBusyCard(id);
    setMsg(null);
    try {
      await api.battlecard(id);
      load();
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    } finally {
      setBusyCard(null);
    }
  }

  async function remove(id) {
    await api.deleteCompetitor(id);
    load();
  }

  return (
    <>
      <h1 className="page-title">Competitors</h1>
      <p className="lede">
        Who else is selling into this market, and how your team should position against them.
      </p>

      {msg && <div className={`note ${msg.type}`}>{msg.text}</div>}

      <div className="grid-2">
        <div className="panel">
          <h3>Research the market</h3>
          <div className="note">
            Uses public sources only — company websites, published pricing, press coverage. It won't scrape private
            data or monitor individuals.
          </div>
          <div className="field">
            <label className="label">Describe the market</label>
            <textarea className="textarea" rows={3} value={market} onChange={(e) => setMarket(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">How many</label>
            <select className="select" value={count} onChange={(e) => setCount(e.target.value)}>
              {[3, 6, 10, 15].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button className="btn plum" style={{ width: "100%" }} onClick={research} disabled={busy}>
            {busy ? <><span className="spinner" /> Researching…</> : "Research competitors"}
          </button>
        </div>

        <div>
          {competitors.length === 0 ? (
            <div className="panel empty">No competitors tracked yet. Run research to build your reference.</div>
          ) : (
            competitors.map((c) => (
              <div className="panel" key={c.id} style={{ marginBottom: 14 }}>
                <div className="spread" style={{ marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600 }}>{c.name}</div>
                    {c.website && (
                      <a href={c.website} target="_blank" rel="noreferrer" className="mono"
                         style={{ fontSize: 11.5, color: "var(--plum)" }}>
                        {c.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                  {c.price_point && <span className="pill contacted">{c.price_point}</span>}
                </div>

                {c.positioning && <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.55 }}>{c.positioning}</div>}

                <div className="bc-cols" style={{ marginBottom: 12 }}>
                  {c.strengths && (
                    <div>
                      <div className="label">Their strengths</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{c.strengths}</div>
                    </div>
                  )}
                  {c.weaknesses && (
                    <div>
                      <div className="label">Their gaps</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{c.weaknesses}</div>
                    </div>
                  )}
                </div>

                {c.battlecard ? (
                  <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
                    <div className="bc-cols">
                      <div>
                        <div className="label">Where we win</div>
                        <ul className="bc-list">
                          {(c.battlecard.whereWeWin || []).map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="label">Where they win</div>
                        <ul className="bc-list">
                          {(c.battlecard.whereTheyWin || []).map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    </div>
                    {(c.battlecard.objections || []).length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div className="label">Objection handling</div>
                        {c.battlecard.objections.map((o, i) => (
                          <div key={i} style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.6 }}>
                            <div style={{ color: "var(--ink-soft)" }}>"{o.objection}"</div>
                            <div style={{ color: "var(--plum)" }}>→ {o.response}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button className="btn ghost sm" onClick={() => makeBattlecard(c.id)} disabled={busyCard === c.id}>
                    {busyCard === c.id ? <><span className="spinner" /> Building…</> : "Generate battlecard"}
                  </button>
                )}

                <div className="row" style={{ marginTop: 12 }}>
                  {c.source_url && (
                    <a href={c.source_url} target="_blank" rel="noreferrer"
                       style={{ fontSize: 11, color: "var(--ink-soft)" }}>Source</a>
                  )}
                  <button className="btn danger sm" style={{ marginLeft: "auto" }} onClick={() => remove(c.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
