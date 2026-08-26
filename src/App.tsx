import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  EUR,
  VALUE,
  confirmPaid,
  createOrder,
  fetchConfig,
  fetchItems,
  fetchMe,
  fetchOrders,
  loginWithDiscord,
  logout,
  saveSetup,
} from "./api";
import type { DiscordUser, Order, ShopItem } from "./types";

export default function App() {
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<ShopItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [active, setActive] = useState<ShopItem | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [method, setMethod] = useState<"paypal" | "robux">("paypal");
  const [hasPlus, setHasPlus] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [ticketUrl, setTicketUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [discordReady, setDiscordReady] = useState(true);

  useEffect(() => {
    fetchMe().then((d) => setUser(d.user)).catch(() => setUser(null));
    fetchItems().then((d) => setItems(d.items)).catch(() => setItems([]));
    fetchConfig().then((d) => {
      setDiscordReady(d.discordReady);
      setTicketUrl(d.ticketUrl);
      const need = new URLSearchParams(window.location.search).get("needSetup");
      if (!d.discordReady || need) setSetupOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }
    fetchOrders()
      .then((d) => setOrders(d.orders))
      .catch(() => setOrders([]));
  }, [user]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => !q || item.name.toLowerCase().includes(q));
  }, [items, query]);

  const total = cart.reduce((n, item) => n + item.price, 0);
  const totalRobux = cart.reduce((n, item) => n + item.robuxPrice, 0);

  function add(item: ShopItem) {
    if (!user) {
      loginWithDiscord();
      return;
    }
    setCart((prev) => (prev.some((x) => x.id === item.id) ? prev : [...prev, item]));
    setCartOpen(true);
  }

  async function onCheckout(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      loginWithDiscord();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await createOrder(
        cart.map((item) => item.id),
        method,
        hasPlus,
      );
      setOrder(data.order);
      setTicketUrl(data.ticketUrl);
      setCart([]);
      const mine = await fetchOrders();
      setOrders(mine.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout fallito");
    } finally {
      setBusy(false);
    }
  }

  async function onPaid() {
    if (!order) return;
    setBusy(true);
    setError("");
    try {
      const data = await confirmPaid(order.invoice, note);
      setOrder(data.order);
      const mine = await fetchOrders();
      setOrders(mine.orders);
      const shop = await fetchItems();
      setItems(shop.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verifica fallita");
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
              <span>Arsenale MM2</span>
            </span>
          </a>
          <nav className="nav-links">
            <a href="#shop">Shop</a>
            <a href="#how">Pagamenti</a>
            <a href="#trust">Ticket</a>
          </nav>
          <div className="nav-right">
            <button className="cart-btn" onClick={() => setCartOpen(true)}>
              Carrello
              <b>{cart.length}</b>
            </button>
            {user ? (
              <button className="user-chip" onClick={() => setOrdersOpen(true)}>
                <img src={user.avatar} alt="" />
                <span>
                  <strong>{user.username}</strong>
                  <small>{user.id}</small>
                </span>
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => (discordReady ? loginWithDiscord() : setSetupOpen(true))}
              >
                Accedi con Discord
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="wrap hero">
          <div>
            <div className="kicker">Murder Mystery 2 · Login Discord</div>
            <h1>
              COMPRA ARMI
              <br />
              <em>MM2</em> ADESSO
            </h1>
            <p>
              Catalogo vuoto finché un venditore non pubblica con <b>sell-item.bat</b>.
              Per comprare o vendere serve l&apos;account Discord. Paghi con PayPal o
              Robux, poi apri il ticket Donazione e chiedi la fattura.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#shop">
                Vedi le armi
              </a>
              {!user && (
                <button
                  className="btn btn-ghost"
                  onClick={() => (discordReady ? loginWithDiscord() : setSetupOpen(true))}
                >
                  Accedi con Discord
                </button>
              )}
            </div>
          </div>
          <article className="hero-photo-card">
            <img src="/solax-hero.png" alt="SX shop" />
          </article>
        </section>

        <section className="wrap" id="shop">
          <div className="toolbar">
            <input
              className="search"
              placeholder="Cerca un'arma in vendita..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {list.length === 0 ? (
            <div className="empty-shop">
              <h2>Nessuna arma in vendita</h2>
              <p>
                Le armi predefinite sono state rimosse. Per pubblicare un item avvia{" "}
                <code>sell-item.bat</code>, accedi con Discord, trascina la foto e
                inserisci nome, prezzo e value.
              </p>
            </div>
          ) : (
            <div className="grid">
              {list.map((item) => (
                <article key={item.id} className="card" onClick={() => setActive(item)}>
                  <div className="card-photo">
                    <img src={item.image} alt={item.name} />
                  </div>
                  <h3>{item.name}</h3>
                  <p className="stock">
                    value {VALUE.format(item.value)} · {item.sellerName}
                  </p>
                  <div className="row">
                    <strong>{EUR.format(item.price)}</strong>
                    <button
                      className="add"
                      onClick={(e) => {
                        e.stopPropagation();
                        add(item);
                      }}
                    >
                      Compra
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="wrap how" id="how">
          <h2>PayPal o Robux</h2>
          <div className="steps">
            <div className="step">
              <b>01</b>
              <h3>Login Discord</h3>
              <p>Senza account non puoi comprare né vendere. Il tuo profilo resta in alto.</p>
            </div>
            <div className="step">
              <b>02</b>
              <h3>Paga il venditore</h3>
              <p>
                PayPal: invia i soldi al PayPal del seller. Robux: serve Plus e paghi
                quello username Roblox.
              </p>
            </div>
            <div className="step">
              <b>03</b>
              <h3>Ticket e fattura</h3>
              <p>
                Apri il ticket Discord Donazione e richiedi la tua fattura. Quando il
                pagamento è inviato, SX manda webhook con numero, Discord ID, item e
                totale.
              </p>
            </div>
          </div>
        </section>

        <section className="wrap trust" id="trust">
          <h2>Ticket Discord Donazione</h2>
          <div className="trust-card">
            <p>
              Per ogni acquisto: <b>apri il ticket Discord Donazione e richiedi la tua fattura</b>.
              Il codice fattura (es. SLX-XXXX) è quello che lo staff vede nel webhook.
            </p>
          </div>
        </section>
      </main>

      <footer className="wrap foot">
        <p>© 2026 SX. Non affiliato a Roblox o Nikilis.</p>
        {user && (
          <button className="linkish" onClick={() => logout().then(() => setUser(null))}>
            Esci da Discord
          </button>
        )}
      </footer>

      {cartOpen && (
        <>
          <div className="overlay" onClick={() => setCartOpen(false)} />
          <aside className="drawer">
            <div className="head-row">
              <h2>Carrello</h2>
              <button className="close" onClick={() => setCartOpen(false)}>
                ×
              </button>
            </div>
            <div className="cart-list">
              {cart.length === 0 && <p className="empty">Il carrello è vuoto.</p>}
              {cart.map((item) => (
                <div className="line" key={item.id}>
                  <img src={item.image} alt="" />
                  <div>
                    <strong>{item.name}</strong>
                    <p>{EUR.format(item.price)}</p>
                  </div>
                  <button className="linkish" onClick={() => setCart((c) => c.filter((x) => x.id !== item.id))}>
                    togli
                  </button>
                </div>
              ))}
            </div>
            <div className="total">
              <span>Totale</span>
              <b>{EUR.format(total)}</b>
            </div>
            <button
              className="btn btn-primary"
              disabled={cart.length === 0}
              onClick={() => {
                if (!user) {
                  loginWithDiscord();
                  return;
                }
                setCartOpen(false);
                setCheckingOut(true);
                setOrder(null);
                setError("");
              }}
            >
              {user ? "Vai al checkout" : "Accedi per comprare"}
            </button>
          </aside>
        </>
      )}

      {ordersOpen && user && (
        <>
          <div className="overlay" onClick={() => setOrdersOpen(false)} />
          <aside className="drawer">
            <div className="head-row">
              <h2>I tuoi acquisti</h2>
              <button className="close" onClick={() => setOrdersOpen(false)}>
                ×
              </button>
            </div>
            <div className="user-block">
              <img src={user.avatar} alt="" />
              <div>
                <strong>{user.username}</strong>
                <p>Discord ID {user.id}</p>
              </div>
            </div>
            <div className="cart-list">
              {orders.length === 0 && <p className="empty">Nessun acquisto ancora.</p>}
              {orders.map((o) => (
                <button
                  className="order-card"
                  key={o.invoice}
                  onClick={() => {
                    setOrder(o);
                    setOrdersOpen(false);
                    setCheckingOut(true);
                    setError("");
                  }}
                >
                  <strong>{o.invoice}</strong>
                  <p>
                    {o.items.map((i) => i.name).join(", ")} ·{" "}
                    {o.method === "robux" ? `${o.totalRobux} R$` : EUR.format(o.totalEur)}
                  </p>
                  <small>{o.status === "paid" ? "Pagato" : "In attesa pagamento"}</small>
                </button>
              ))}
            </div>
          </aside>
        </>
      )}

      {active && (
        <>
          <div className="overlay" onClick={() => setActive(null)} />
          <div className="modal">
            <div className="head-row">
              <h2>{active.name}</h2>
              <button className="close" onClick={() => setActive(null)}>
                ×
              </button>
            </div>
            <img className="modal-photo" src={active.image} alt="" />
            <p style={{ color: "var(--muted)", margin: "8px 0 16px" }}>
              value {VALUE.format(active.value)} · venduto da {active.sellerName}
            </p>
            <div className="row">
              <div className="price">{EUR.format(active.price)}</div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  add(active);
                  setActive(null);
                }}
              >
                {user ? "Aggiungi al carrello" : "Accedi per comprare"}
              </button>
            </div>
          </div>
        </>
      )}

      {checkingOut && (
        <>
          <div className="overlay" onClick={() => !busy && setCheckingOut(false)} />
          <div className="modal">
            {order?.status === "paid" ? (
              <div className="success">
                <div className="kicker">Pagamento registrato</div>
                <h2>Fattura inviata su Discord</h2>
                <p style={{ color: "var(--muted)", marginTop: 10 }}>
                  Il webhook ha mandato Discord ID, item e totale. Tieni il ticket
                  Donazione aperto.
                </p>
                <code>{order.invoice}</code>
                <div style={{ marginTop: 22 }}>
                  <button className="btn btn-primary" onClick={() => setCheckingOut(false)}>
                    Torna allo shop
                  </button>
                </div>
              </div>
            ) : order ? (
              <>
                <div className="head-row">
                  <h2>Paga e apri il ticket</h2>
                  <button className="close" onClick={() => setCheckingOut(false)}>
                    ×
                  </button>
                </div>
                <p className="ticket-banner">
                  Apri il ticket Discord Donazione e richiedi la tua fattura{" "}
                  <b>{order.invoice}</b>
                </p>
                {ticketUrl && (
                  <a className="btn btn-primary" href={ticketUrl} target="_blank" rel="noreferrer">
                    Apri il ticket Discord Donazione
                  </a>
                )}
                <div className="pay-box">
                  {order.method === "paypal" ? (
                    <>
                      <h3>PayPal</h3>
                      <p>Manda i soldi a questi account, con causale la fattura:</p>
                      <ul>
                        {order.items.map((item) => (
                          <li key={item.id}>
                            {item.name}: {item.paypal} — {EUR.format(item.price)}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <>
                      <h3>Robux</h3>
                      <p>Con Roblox Plus, paga questi username:</p>
                      <ul>
                        {order.items.map((item) => (
                          <li key={item.id}>
                            {item.name}: {item.roblox} — {item.robuxPrice} R$
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <label className="form-label">
                  ID transazione PayPal o username Roblox da cui hai pagato
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="es. ID PayPal o tuo nick Roblox"
                  />
                </label>
                {error && <p className="err">{error}</p>}
                <button className="btn btn-primary" disabled={busy} onClick={onPaid}>
                  {busy ? "Verifica in corso..." : "Ho mandato i soldi"}
                </button>
              </>
            ) : (
              <>
                <div className="head-row">
                  <h2>Checkout</h2>
                  <button className="close" onClick={() => setCheckingOut(false)}>
                    ×
                  </button>
                </div>
                <p>
                  Totale: <b className="gold">{EUR.format(total)}</b> oppure{" "}
                  <b className="gold">{totalRobux} R$</b>
                </p>
                <form className="form" onSubmit={onCheckout}>
                  <label>
                    Pagamento
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value as "paypal" | "robux")}
                    >
                      <option value="paypal">PayPal — manda i soldi al venditore</option>
                      <option value="robux">Robux — serve Plus, paghi quel utente</option>
                    </select>
                  </label>
                  {method === "robux" && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={hasPlus}
                        onChange={(e) => setHasPlus(e.target.checked)}
                        required
                      />
                      Ho Roblox Plus e pagherò lo username Roblox del venditore
                    </label>
                  )}
                  {error && <p className="err">{error}</p>}
                  <button className="btn btn-primary" disabled={busy || cart.length === 0}>
                    {busy ? "Creo la fattura..." : "Crea fattura"}
                  </button>
                </form>
              </>
            )}
          </div>
        </>
      )}

      {setupOpen && (
        <>
          <div className="overlay" onClick={() => setSetupOpen(false)} />
          <div className="modal">
            <div className="head-row">
              <h2>Setup Discord</h2>
              <button className="close" onClick={() => setSetupOpen(false)}>
                ×
              </button>
            </div>
            <p style={{ color: "var(--muted)", marginBottom: 12 }}>
              Crea un&apos;app su{" "}
              <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
                Discord Developer Portal
              </a>
              , OAuth2 → Redirects:{" "}
              <code>http://localhost:5173/api/auth/discord/callback</code>
            </p>
            <SetupForm
              onDone={() => {
                setDiscordReady(true);
                setSetupOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await saveSetup({
        discordClientId: String(form.get("id") || ""),
        discordClientSecret: String(form.get("secret") || ""),
        discordTicketUrl: String(form.get("ticket") || ""),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup fallito");
    }
  }
  return (
    <form className="form" onSubmit={onSubmit}>
      <label>
        Discord Client ID
        <input name="id" required placeholder="1234567890" />
      </label>
      <label>
        Discord Client Secret
        <input name="secret" required type="password" />
      </label>
      <label>
        Link ticket Discord Donazione
        <input name="ticket" placeholder="https://discord.gg/..." />
      </label>
      {error && <p className="err">{error}</p>}
      <button className="btn btn-primary">Salva e abilita login</button>
    </form>
  );
}
