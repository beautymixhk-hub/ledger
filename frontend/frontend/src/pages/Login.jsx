import { useState } from "react";
import { api, setToken } from "../api.js";

export default function Login({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ orgName: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = mode === "login" ? await api.login(form) : await api.register(form);
      setToken(res.token);
      const session = await api.me();
      onAuth(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter") submit();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">Ledger<span>.</span></div>

        <div className="tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button>
        </div>

        {mode === "register" && (
          <>
            <div className="field">
              <label className="label">Company name</label>
              <input className="input" value={form.orgName} onChange={set("orgName")} onKeyDown={onKeyDown} />
            </div>
            <div className="field">
              <label className="label">Your name</label>
              <input className="input" value={form.name} onChange={set("name")} onKeyDown={onKeyDown} />
            </div>
          </>
        )}

        <div className="field">
          <label className="label">Work email</label>
          <input className="input" type="email" value={form.email} onChange={set("email")} onKeyDown={onKeyDown} />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input className="input" type="password" value={form.password} onChange={set("password")} onKeyDown={onKeyDown} />
          {mode === "register" && <div className="hint">At least 10 characters.</div>}
        </div>

        {error && <div className="note bad">{error}</div>}

        <button className="btn plum" style={{ width: "100%" }} onClick={submit} disabled={busy}>
          {busy ? <><span className="spinner" /> Working…</> : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </div>
    </div>
  );
}
