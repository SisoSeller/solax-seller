import { FormEvent, useEffect, useState } from "react";
import { fetchMe, listItem, loginWithDiscord } from "./api";
import type { DiscordUser } from "./types";

function sellKey() {
  return new URLSearchParams(window.location.search).get("key") || "";
}

export default function Sell() {
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const key = sellKey();

  useEffect(() => {
    fetchMe().then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  function onDrop(dropped: File | null) {
    if (!dropped) return;
    setFile(dropped);
    setPreview(URL.createObjectURL(dropped));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      loginWithDiscord("/sell?key=" + encodeURIComponent(key));
      return;
    }
    if (!file) {
      setError("Trascina la foto dell'arma");
      return;
    }
    setBusy(true);
    setError("");
    setOk("");
    const form = new FormData(event.currentTarget);
    form.set("photo", file);
    try {
      const data = await listItem(form, key);
      setOk(`${data.item.name} è in vendita.`);
      setFile(null);
      setPreview("");
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pubblicazione fallita");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="glow" />
      <div className="noise" />
      <header className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="/">
            <img className="brand-img" src="/sx-logo.jpg" alt="SX" />
            <span>
              <strong>SX</strong>
              <span>Vendi item</span>
            </span>
          </a>
          {user ? (
            <div className="user-chip static">
              <img src={user.avatar} alt="" />
              <span>
                <strong>{user.username}</strong>
                <small>{user.id}</small>
              </span>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => loginWithDiscord("/sell?key=" + encodeURIComponent(key))}
            >
              Accedi con Discord
            </button>
          )}
        </div>
      </header>

      <main className="wrap sell-page">
        <div className="kicker">sell-item.bat · solo chi ha questo file</div>
        <h1>Metti in vendita</h1>
        {!key && <p className="err">Apri questa pagina da sell-item.bat.</p>}
        {!user && (
          <p className="empty-shop">
            Devi accedere con Discord prima di pubblicare un&apos;arma.
          </p>
        )}
        {user && key && (
          <form className="sell-form" onSubmit={onSubmit}>
            <div
              className={`dropzone ${preview ? "has" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(e.dataTransfer.files[0] || null);
              }}
            >
              {preview ? (
                <img src={preview} alt="Anteprima" />
              ) : (
                <p>Trascina qui la foto dell&apos;arma</p>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onDrop(e.target.files?.[0] || null)}
              />
            </div>
            <label>
              Nome arma
              <input name="name" required placeholder="es. Chroma Evergreen" />
            </label>
            <label>
              Prezzo euro
              <input name="price" type="number" min="0.01" step="0.01" required />
            </label>
            <label>
              Value MM2
              <input name="value" type="number" min="0" step="1" required />
            </label>
            <label>
              Tuo PayPal (email o paypal.me)
              <input name="paypal" placeholder="email o username" />
            </label>
            <label>
              Tuo username Roblox
              <input name="roblox" placeholder="per i pagamenti in Robux" />
            </label>
            <label>
              Prezzo in Robux
              <input name="robuxPrice" type="number" min="0" step="1" placeholder="opzionale" />
            </label>
            {error && <p className="err">{error}</p>}
            {ok && <p className="ok">{ok}</p>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Pubblico..." : "Metti in vendita"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
