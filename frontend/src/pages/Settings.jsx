import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Settings({ session, onUpdate }) {
  const [org, setOrg] = useState(session.org);
  const [product, setProduct] = useState(null);
  const [team, setTeam] = useState([]);
  const [invite, setInvite] = useState({ name: "", email: "", password: "", role: "member" });
  const [msg, setMsg] = useState(null);
  const isAdmin = session.user.role === "admin";

  useEffect(() => {
    api.products().then((p) => setProduct(p[0] || null)).catch(() => {});
    api.team().then(setTeam).catch(() => {});
  }, []);

  async function saveOrg() {
    try {
      const updated = await api.updateOrg({
        name: org.name,
        postal_address: org.postal_address,
        reply_to_email: org.reply_to_email,
        ai_provider: org.ai_provider,
      });
      setOrg(updated);
      onUpdate({ ...session, org: updated });
      setMsg({ type: "good", text: "Company details saved." });
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  async function saveProduct() {
    try {
      const saved = await api.updateProduct(product.id, {
        name: product.name,
        tagline: product.tagline || "",
        summary: product.summary || "",
        specs: product.specs || [],
      });
      setProduct(saved);
      setMsg({ type: "good", text: "Product saved." });
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  async function addTeammate() {
    try {
      await api.addTeammate(invite);
      setInvite({ name: "", email: "", password: "", role: "member" });
      setTeam(await api.team());
      setMsg({ type: "good", text: "Teammate added." });
    } catch (err) {
      setMsg({ type: "bad", text: err.message });
    }
  }

  function updateSpec(i, field, value) {
    const specs = [...(product.specs || [])];
    specs[i] = { ...specs[i], [field]: value };
    setProduct({ ...product, specs });
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="lede">Company details, your product spec, and who on your team has access.</p>

      {msg && <div className={`note ${msg.type}`}>{msg.text}</div>}

      {!org.postal_address && (
        <div className="note bad">
          Add your physical mailing address below. US CAN-SPAM law requires it in every commercial email, and sending
          is blocked until it's set.
        </div>
      )}

      <div className="grid-2">
        <div>
          <div className="panel">
            <h3>Company</h3>
            <div className="field">
              <label className="label">Company name</label>
              <input className="input" value={org.name || ""} disabled={!isAdmin}
                     onChange={(e) => setOrg({ ...org, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Reply-to email</label>
              <input className="input" value={org.reply_to_email || ""} disabled={!isAdmin}
                     onChange={(e) => setOrg({ ...org, reply_to_email: e.target.value })} />
              <div className="hint">Where prospect replies land. Use a real monitored inbox.</div>
            </div>
            <div className="field">
              <label className="label">Physical mailing address</label>
              <textarea className="textarea" rows={3} value={org.postal_address || ""} disabled={!isAdmin}
                        onChange={(e) => setOrg({ ...org, postal_address: e.target.value })} />
              <div className="hint">Appears in the footer of every email. Legally required in the US.</div>
            </div>
            {isAdmin && <button className="btn plum" onClick={saveOrg}>Save company details</button>}
          </div>

          <div className="panel">
            <h3>AI provider</h3>
            <div className="hint" style={{ marginBottom: 10 }}>
              Used for lead search, drafting, reply classification, and competitor research.
            </div>
            <div className="field">
              <label className="row" style={{ marginBottom: 8, cursor: isAdmin ? "pointer" : "default" }}>
                <input type="radio" name="ai_provider" value="claude" checked={(org.ai_provider || "claude") === "claude"}
                       disabled={!isAdmin} onChange={(e) => setOrg({ ...org, ai_provider: e.target.value })} />
                <span style={{ marginLeft: 8 }}>Claude</span>
              </label>
              <label className="row" style={{ cursor: isAdmin ? "pointer" : "default" }}>
                <input type="radio" name="ai_provider" value="openai" checked={org.ai_provider === "openai"}
                       disabled={!isAdmin} onChange={(e) => setOrg({ ...org, ai_provider: e.target.value })} />
                <span style={{ marginLeft: 8 }}>OpenAI</span>
              </label>
            </div>
            {isAdmin && <button className="btn plum" onClick={saveOrg}>Save AI provider</button>}
          </div>

          <div className="panel">
            <h3>Team</h3>
            {team.map((u) => (
              <div key={u.id} className="spread" style={{ padding: "6px 0", fontSize: 13 }}>
                <div>
                  <div>{u.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{u.email}</div>
                </div>
                <span className="pill contacted">{u.role}</span>
              </div>
            ))}

            {isAdmin && (
              <div style={{ borderTop: "1px solid var(--rule)", marginTop: 12, paddingTop: 12 }}>
                <div className="label">Add a teammate</div>
                <input className="input" style={{ marginBottom: 6 }} placeholder="Name"
                       value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
                <input className="input" style={{ marginBottom: 6 }} placeholder="Email"
                       value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
                <input className="input" style={{ marginBottom: 6 }} type="password" placeholder="Temporary password"
                       value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} />
                <select className="select" style={{ marginBottom: 8 }} value={invite.role}
                        onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="btn ghost sm" onClick={addTeammate}>Add teammate</button>
                <div className="hint">Share the temporary password privately and have them change it.</div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <h3>Product spec</h3>
          {!product ? (
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Loading…</div>
          ) : (
            <>
              <div className="note">
                Avoid medical, clinical, or therapeutic efficacy claims here. Marketing a therapeutic device in the US
                can bring it under FDA rules — check your regulatory position before making health claims.
              </div>
              <div className="field">
                <label className="label">Product name</label>
                <input className="input" value={product.name || ""}
                       onChange={(e) => setProduct({ ...product, name: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Tagline</label>
                <input className="input" value={product.tagline || ""}
                       onChange={(e) => setProduct({ ...product, tagline: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Summary</label>
                <textarea className="textarea" rows={3} value={product.summary || ""}
                          onChange={(e) => setProduct({ ...product, summary: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Spec sheet</label>
                {(product.specs || []).map((s, i) => (
                  <div className="row" key={i} style={{ marginBottom: 6, flexWrap: "nowrap" }}>
                    <input className="input" style={{ flex: "0 0 36%" }} placeholder="Label"
                           value={s.label || ""} onChange={(e) => updateSpec(i, "label", e.target.value)} />
                    <input className="input" placeholder="Value"
                           value={s.value || ""} onChange={(e) => updateSpec(i, "value", e.target.value)} />
                    <button className="btn danger sm"
                            onClick={() => setProduct({ ...product, specs: product.specs.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                <button className="btn ghost sm"
                        onClick={() => setProduct({ ...product, specs: [...(product.specs || []), { label: "", value: "" }] })}>
                  + Add spec line
                </button>
              </div>
              <button className="btn plum" onClick={saveProduct}>Save product</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
