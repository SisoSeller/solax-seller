import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  EUR,
  VALUE,
  type ShopConfig,
  completeDiscordLogin,
  createOrder,
  fetchConfig,
  fetchItems,
  listItem,
  loadOrders,
  loadUser,
  loginWithDiscord,
  logout,
  sendInvoiceWebhook,
  updateOrder,
} from "./api";
import { DISCORD_INVITE } from "./discord";
import { asset, siteOriginPath } from "./paths";
import { loadPaypalSdk } from "./paypal";
import type { DiscordUser, Order, ShopItem } from "./types";

function payeeEmail(config: ShopConfig, order: Order) {
  if (config.paypalEmail.includes("@")) return config.paypalEmail;
  const fromItem = order.items.find((item) => item.paypal.includes("@"));
  return fromItem?.paypal || "";
}

function PaypalCheckout({
  config,
  order,
  onPaid,
  onError,
}: {
  config: ShopConfig;
  order: Order;
  onPaid: (captureId: string) => void;
  onError: (message: string) => void;
}) {
  const paidRef = useRef(onPaid);
  const errorRef = useRef(onError);
  paidRef.current = onPaid;
  errorRef.current = onError;

  useEffect(() => {
    if (!config.paypalClientId) return;
    const host = document.getElementById("paypal-buttons");
    if (!host) return;
    host.innerHTML = "";
    let gone = false;
    loadPaypalSdk(config.paypalClientId)
      .then(() => {
        if (gone || !window.paypal) return;
        const unit: Record<string, unknown> = {
          amount: { currency_code: "EUR", value: order.totalEur.toFixed(2) },
          description: `SX ${order.invoice}`.slice(0, 127),
          custom_id: order.invoice,
        };
        const email = payeeEmail(config, order);
        if (email) unit.payee = { email_address: email };
        return window.paypal
          .Buttons({
            style: { color: "gold", shape: "pill", label: "paypal" },
            createOrder: (_data, actions) =>
              actions.order.create({
                purchase_units: [unit],
                application_context: { shipping_preference: "NO_SHIPPING" },
              }),
            onApprove: async (_data, actions) => {
              const details = await actions.order.capture();
              paidRef.current(details.id || "paypal");
            },
            onError: () => errorRef.current("Pagamento PayPal non riuscito. Riprova."),
          })
          .render("#paypal-buttons");
      })
      .catch(() => errorRef.current("Impossibile caricare PayPal."));
    return () => {
      gone = true;
      host.innerHTML = "";
    };
  }, [config.paypalClientId, config.paypalEmail, order.invoice, order.totalEur]);

  if (!config.paypalClientId) {
    return (
      <p className="err">
        PayPal non è ancora collegato. Metti <code>paypalClientId</code> e{" "}
        <code>paypalEmail</code> in shop-config.json.
      </p>
    );
  }
  return <div id="paypal-buttons" className="paypal-buttons" />;
}

export default function App() {
  const [config, setConfig] = useState<ShopConfig>({
    discordClientId: "",
    discordTicketUrl: "",
    discordWebhookUrl: "",
    paypalClientId: "",
    paypalEmail: "",
  });
  const [user, setUser] = useState<DiscordUser | null>(loadUser());
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
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    fetchConfig().then(async (cfg) => {
      setConfig(cfg);
      try {
        const logged = await completeDiscordLogin(cfg);
        if (logged) setUser(logged);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login Discord fallito");
        setSetupOpen(true);
      }
    });
    fetchItems()
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    setOrders(user ? loadOrders(user.id) : []);
  }, [user]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => !q || item.name.toLowerCase().includes(q));
  }, [items, query]);

  const total = cart.reduce((n, item) => n + item.price, 0);
  const totalRobux = cart.reduce((n, item) => n + item.robuxPrice, 0);
  const discordReady = Boolean(config.discordClientId);

  function goLogin() {
    if (!discordReady) {
      setSetupOpen(true);
      return;
    }
    loginWithDiscord(config).catch((err) => {
      setError(err instanceof Error ? err.message : "Login fallito");
      setSetupOpen(true);
    });
  }

  function add(item: ShopItem) {
    if (!user) {
      goLogin();
      return;
    }
    setCart((prev) => (prev.some((x) => x.id === item.id) ? prev : [...prev, item]));
    setCartOpen(true);
  }

  function onCheckout(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      goLogin();
      return;
    }
    if (method === "robux" && !hasPlus) {
      setError("Per pagare in Robux serve Roblox Plus");
      return;
    }
    const created = createOrder(user, cart, method, hasPlus);
    setOrder(created);
    setOrders(loadOrders(user.id));
    setCart([]);
    setError("");
  }

  async function onPaid(paymentNote = note) {
    if (!order || !user) return;
    setBusy(true);
    setError("");
    try {
      const paid: Order = {
        ...order,
        status: "paid",
        paidAt: Date.now(),
        paymentNote,
      };
      await sendInvoiceWebhook(config, paid, paymentNote);
      updateOrder(user, paid);
      setOrder(paid);
      setOrders(loadOrders(user.id));
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
          <a className="brand" href={asset("")}>
            <img className="brand-img" src={asset("sx-logo.jpg")} alt="SX" />
            <span>
              <strong>SX</strong>
              <span>Arsenale MM2</span>
            </span>
          </a>
          <nav className="nav-links">
            <a href="#shop">Shop</a>
            <a href="#how">Pagamenti</a>
            <a href={DISCORD_INVITE} target="_blank" rel="noreferrer">
              Discord
            </a>
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
              <button className="btn btn-primary" onClick={goLogin}>
                Accedi con Discord
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="wrap hero">
          <div>
            <div className="kicker">Murder Mystery 2 · Sempre online</div>
            <h1>
              COMPRA ARMI
              <br />
              <em>MM2</em> ADESSO
            </h1>
            <p>
              Le armi pubblicate con <b>sell-item.bat</b> le vedono tutti su questo sito.
              Per comprare serve Discord. Paghi con PayPal o Robux, poi apri il ticket
              Donazione e chiedi la fattura.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#shop">
                Vedi le armi
              </a>
              {!user && (
                <button className="btn btn-ghost" onClick={goLogin}>
                  Accedi con Discord
                </button>
              )}
            </div>
          </div>
          <article className="hero-photo-card">
            <img src={asset("solax-hero.png")} alt="SX shop" />
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
                Quando pubblichi con <code>sell-item.bat</code> l&apos;arma va su GitHub e
                compare qui per tutti, anche a sito sempre aperto.
              </p>
            </div>
          ) : (
            <div className="grid">
              {list.map((item) => (
                <article key={item.id} className="card" onClick={() => setActive(item)}>
                  <div className="card-photo">
                    <img src={asset(item.image)} alt={item.name} />
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
                PayPal: paghi con conto o carta, i soldi arrivano subito allo shop.
                Robux: serve Plus e paghi quello username Roblox.
              </p>
            </div>
            <div className="step">
              <b>03</b>
              <h3>Ticket e fattura</h3>
              <p>
                Apri il ticket Discord Donazione e richiedi la tua fattura. Quando
                segnali il pagamento, parte il webhook con Discord ID, item e totale.
              </p>
            </div>
          </div>
        </section>

        <section className="wrap trust" id="trust">
          <h2>Ticket Discord Donazione</h2>
          <div className="trust-card">
            <p>
              Per ogni acquisto: <b>apri il ticket Discord Donazione e richiedi la tua fattura</b>.
            </p>
          </div>
        </section>
      </main>

      <footer className="wrap foot">
        <p>© 2026 SX. Non affiliato a Roblox o Nikilis.</p>
        <a className="discord-join" href={DISCORD_INVITE} target="_blank" rel="noreferrer">
          Unisciti al Discord
        </a>
        {user && (
          <button
            className="linkish"
            onClick={() => {
              logout();
              setUser(null);
            }}
          >
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
                  <img src={asset(item.image)} alt="" />
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
              disabled={Boolean(user) && cart.length === 0}
              onClick={() => {
                if (!user) {
                  goLogin();
                  return;
                }
                if (cart.length === 0) return;
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
            <img className="modal-photo" src={asset(active.image)} alt="" />
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
                  Tieni il ticket Donazione aperto.
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
                {(config.discordTicketUrl || DISCORD_INVITE) && (
                  <a
                    className="btn btn-primary"
                    href={config.discordTicketUrl || DISCORD_INVITE}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Apri il ticket Discord Donazione
                  </a>
                )}
                <div className="pay-box">
                  {order.method === "paypal" ? (
                    <>
                      <h3>Paga con PayPal o carta</h3>
                      <p>
                        I soldi arrivano subito sul PayPal dello shop. Dopo il pagamento
                        apri il ticket Donazione per la fattura e il trade.
                      </p>
                      <PaypalCheckout
                        config={config}
                        order={order}
                        onPaid={(captureId) => onPaid(`PayPal ${captureId}`)}
                        onError={setError}
                      />
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
                {order.method === "robux" && (
                  <>
                    <label className="form-label">
                      Username Roblox da cui hai pagato
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="il tuo nick Roblox"
                      />
                    </label>
                    <button className="btn btn-primary" disabled={busy} onClick={() => onPaid()}>
                      {busy ? "Verifica in corso..." : "Ho mandato i Robux"}
                    </button>
                  </>
                )}
                {error && <p className="err">{error}</p>}
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
                      <option value="paypal">PayPal / carta — pagamento automatico</option>
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
                  <button className="btn btn-primary" disabled={cart.length === 0}>
                    Crea fattura
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
              <h2>Collega Discord</h2>
              <button className="close" onClick={() => setSetupOpen(false)}>
                ×
              </button>
            </div>
            <p style={{ color: "var(--muted)", marginBottom: 14 }}>
              Accedi come sugli altri siti: Discord ti chiede di autorizzare SX, poi torni qui
              col tuo account.
            </p>
            <a className="btn btn-ghost" href={DISCORD_INVITE} target="_blank" rel="noreferrer">
              Entra nel server Discord
            </a>
            <form
              className="form"
              style={{ marginTop: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                const id = String(new FormData(event.currentTarget).get("clientId") || "").trim();
                if (!id) return;
                localStorage.setItem("sx-discord-client-id", id);
                const next = { ...config, discordClientId: id };
                setConfig(next);
                setSetupOpen(false);
                loginWithDiscord(next).catch((err) => {
                  setError(err instanceof Error ? err.message : "Login fallito");
                  setSetupOpen(true);
                });
              }}
            >
              <label>
                Discord Client ID
                <input
                  name="clientId"
                  required
                  defaultValue={config.discordClientId}
                  placeholder="incolla il Client ID dell'app Discord"
                />
              </label>
              <p style={{ color: "var(--muted)", fontSize: 13 }}>
                Redirect da mettere nel Developer Portal: <code>{siteOriginPath()}</code>
                . Attiva anche <b>Public Client</b>.
              </p>
              <button className="btn btn-primary">Accedi con Discord</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export function SellPage() {
  const [config, setConfig] = useState<ShopConfig>({
    discordClientId: "",
    discordTicketUrl: "",
    discordWebhookUrl: "",
    paypalClientId: "",
    paypalEmail: "",
  });
  const [user, setUser] = useState<DiscordUser | null>(loadUser());
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const key = new URLSearchParams(window.location.search).get("key") || "";

  useEffect(() => {
    fetchConfig().then(async (cfg) => {
      setConfig(cfg);
      try {
        const logged = await completeDiscordLogin(cfg);
        if (logged) setUser(logged);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login Discord fallito");
      }
    });
  }, []);

  function goLogin() {
    loginWithDiscord(config, window.location.href).catch((err) => {
      setError(err instanceof Error ? err.message : "Login fallito");
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      goLogin();
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
    form.set("sellerDiscordId", user.id);
    form.set("sellerName", user.username);
    try {
      const data = await listItem(form, key);
      setOk(`${data.item.name} è online. Tra un minuto la vedono tutti sul sito pubblico.`);
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
          <a className="brand" href={asset("")}>
            <img className="brand-img" src={asset("sx-logo.jpg")} alt="SX" />
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
            <button className="btn btn-primary" onClick={goLogin}>
              Accedi con Discord
            </button>
          )}
        </div>
      </header>
      <main className="wrap sell-page">
        <div className="kicker">sell-item.bat · solo da questo PC</div>
        <h1>Metti in vendita</h1>
        {!key && <p className="err">Apri questa pagina da sell-item.bat.</p>}
        {!user && <p className="empty-shop">Devi accedere con Discord prima di pubblicare.</p>}
        {error && <p className="err">{error}</p>}
        {user && key && (
          <form className="sell-form" onSubmit={onSubmit}>
            <div
              className={`dropzone ${preview ? "has" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files[0] || null;
                if (!dropped) return;
                setFile(dropped);
                setPreview(URL.createObjectURL(dropped));
              }}
            >
              {preview ? <img src={preview} alt="Anteprima" /> : <p>Trascina qui la foto dell&apos;arma</p>}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const dropped = e.target.files?.[0] || null;
                  if (!dropped) return;
                  setFile(dropped);
                  setPreview(URL.createObjectURL(dropped));
                }}
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
            {ok && <p className="ok">{ok}</p>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Pubblico sul sito..." : "Metti in vendita"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
