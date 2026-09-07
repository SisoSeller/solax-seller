import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTACT_EMAIL,
  EUR,
  VALUE,
  type ShopConfig,
  clearInvoiceShare,
  completeDiscordLogin,
  createOrder,
  decodeInvoiceShare,
  encodeInvoiceShare,
  fetchConfig,
  fetchItems,
  fetchPublicIp,
  listItem,
  loadCartIds,
  loadInvoiceShare,
  loadOrders,
  loadSellKey,
  loadUser,
  loginWithDiscord,
  logout,
  rememberPendingAdd,
  removeItem,
  saveCartIds,
  saveInvoiceShare,
  saveSellKey,
  sendInvoiceWebhook,
  takePendingAdd,
  updateOrder,
} from "./api";
import { DISCORD_INVITE, DISCORD_REDIRECT } from "./discord";
import { asset, siteOriginPath } from "./paths";
import type { DiscordUser, Order, ShopItem } from "./types";

const OPEN_INVOICE_KEY = "sx-open-invoice";

function rememberOpenInvoice(invoice: string) {
  if (invoice) sessionStorage.setItem(OPEN_INVOICE_KEY, invoice);
}

function takeRememberedInvoice() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = (params.get("fattura") || "").trim();
  const saved = (sessionStorage.getItem(OPEN_INVOICE_KEY) || "").trim();
  const shareRaw = (params.get("s") || "").trim();
  if (shareRaw) {
    const share = decodeInvoiceShare(shareRaw);
    if (share) saveInvoiceShare(share);
    return fromUrl || share?.invoice || saved;
  }
  return fromUrl || loadInvoiceShare()?.invoice || saved;
}

function clearOpenInvoice() {
  sessionStorage.removeItem(OPEN_INVOICE_KEY);
  clearInvoiceShare();
  const url = new URL(window.location.href);
  if (url.searchParams.has("fattura") || url.searchParams.has("s")) {
    url.searchParams.delete("fattura");
    url.searchParams.delete("s");
    window.history.replaceState({}, "", url);
  }
}

function putFatturaInUrl(order: Order) {
  const url = new URL(window.location.href);
  url.searchParams.set("fattura", order.invoice);
  url.searchParams.set("s", encodeInvoiceShare(order));
  url.searchParams.delete("login");
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url);
  rememberOpenInvoice(order.invoice);
  saveInvoiceShare(order);
}

function InvoiceView({
  order,
  ticketUrl,
  inviteUrl,
  onClose,
}: {
  order: Order;
  ticketUrl: string;
  inviteUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState("");

  async function copy(text: string, kind: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  }

  return (
    <div className="success invoice-sheet">
      <div className="kicker">Fattura SX</div>
      <h2>La tua fattura</h2>
      <p style={{ color: "var(--muted)", marginTop: 10 }}>
        Salva il numero. Per rivederla serve il login Discord di{" "}
        <b>{order.buyerUsername}</b>. Poi apri il ticket sul server.
      </p>
      <code className="invoice-code">{order.invoice}</code>
      <div className="invoice-copy-row">
        <button type="button" className="btn btn-ghost" onClick={() => void copy(order.invoice, "n")}>
          {copied === "n" ? "Numero copiato" : "Copia numero"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            void copy(
              `${siteOriginPath()}?fattura=${encodeURIComponent(order.invoice)}&s=${encodeURIComponent(encodeInvoiceShare(order))}`,
              "l",
            )
          }
        >
          {copied === "l" ? "Link copiato" : "Copia link"}
        </button>
      </div>
      <div className="invoice-meta">
        <p>
          <span>Account Discord</span>
          <b>
            {order.buyerUsername} · {order.buyerDiscordId}
          </b>
        </p>
        <p>
          <span>Totale</span>
          <b className="gold">{EUR.format(order.totalEur)}</b>
        </p>
      </div>
      <ul className="invoice-items">
        {order.items.map((item) => (
          <li key={item.id}>
            <span>{item.name}</span>
            <b>{EUR.format(item.price)}</b>
          </li>
        ))}
      </ul>
      <a className="btn btn-primary" style={{ marginTop: 18 }} href={ticketUrl} target="_blank" rel="noreferrer">
        Apri il ticket Discord Donazione
      </a>
      <a className="btn btn-ghost" style={{ marginTop: 10 }} href={inviteUrl} target="_blank" rel="noreferrer">
        Unisciti al Discord
      </a>
      <div style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onClose}>
          Torna allo shop
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<ShopConfig>({
    discordClientId: "",
    discordTicketUrl: "",
    discordWebhookUrl: "",
    paypalClientId: "",
    paypalEmail: "",
    paypalApiUrl: "",
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
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [sellKey] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("key") || "";
    if (fromUrl) saveSellKey(fromUrl);
    return fromUrl || loadSellKey();
  });
  const cartReady = useRef(false);
  const canManage = Boolean(sellKey) && window.location.protocol !== "https:";

  useEffect(() => {
    fetchConfig().then(async (cfg) => {
      setConfig(cfg);
      const params = new URLSearchParams(window.location.search);
      if (params.get("login") === "1" && !params.get("code") && cfg.discordClientId) {
        loginWithDiscord(cfg);
        return;
      }
      try {
        const logged = await completeDiscordLogin(cfg);
        if (logged) setUser(logged);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login Discord fallito");
        setSetupOpen(true);
      }
    });
    fetchItems()
      .then((d) => {
        setItems(d.items);
        const pending = takePendingAdd();
        const wanted = new Set(loadCartIds());
        if (pending) wanted.add(pending);
        const restored = d.items.filter((item) => wanted.has(item.id));
        cartReady.current = true;
        setCart(restored);
        if (pending && restored.some((item) => item.id === pending)) setCartOpen(true);
      })
      .catch(() => {
        cartReady.current = true;
        setItems([]);
      });
  }, []);

  useEffect(() => {
    if (!cartReady.current) return;
    saveCartIds(cart.map((item) => item.id));
  }, [cart]);

  useEffect(() => {
    setOrders(user ? loadOrders(user.id) : []);
  }, [user]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => !q || item.name.toLowerCase().includes(q));
  }, [items, query]);

  const total = cart.reduce((n, item) => n + item.price, 0);
  const discordReady = Boolean(config.discordClientId);

  function goLogin() {
    const wanted = takeRememberedInvoice();
    if (wanted) rememberOpenInvoice(wanted);
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
      rememberPendingAdd(item.id);
      goLogin();
      return;
    }
    setCart((prev) => (prev.some((x) => x.id === item.id) ? prev : [...prev, item]));
    setCartOpen(true);
  }

  async function takeDown(item: ShopItem) {
    if (!sellKey) return;
    if (!window.confirm(`Togliere ${item.name} dal sito?`)) return;
    setBusy(true);
    setError("");
    try {
      await removeItem(item.id, sellKey);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      setCart((prev) => prev.filter((entry) => entry.id !== item.id));
      setActive(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile togliere l'item");
    } finally {
      setBusy(false);
    }
  }

  function openInvoiceForUser(buyer: DiscordUser, wanted: string) {
    const code = wanted.trim().toUpperCase();
    const shareRaw = (new URLSearchParams(window.location.search).get("s") || "").trim();
    const shared =
      (shareRaw ? decodeInvoiceShare(shareRaw) : null) || loadInvoiceShare();
    let found = loadOrders(buyer.id).find((entry) => entry.invoice.toUpperCase() === code);
    if (
      !found &&
      shared &&
      shared.invoice.toUpperCase() === code &&
      shared.buyerDiscordId === buyer.id
    ) {
      found = shared;
      updateOrder(buyer, found);
    }
    if (!found || found.buyerDiscordId !== buyer.id) {
      setOrder(null);
      setCheckingOut(true);
      setError("Questa fattura non è di questo account Discord. Accedi con l'account che l'ha presa.");
      return;
    }
    setError("");
    setOrder(found);
    setCheckingOut(true);
    putFatturaInUrl(found);
  }

  async function issueInvoice() {
    if (!user) {
      goLogin();
      return;
    }
    if (cart.length === 0) return;
    setBusy(true);
    setError("");
    setCartOpen(false);
    setCheckingOut(true);
    try {
      const created = createOrder(user, cart);
      const invoiced: Order = {
        ...created,
        buyerIp: await fetchPublicIp(),
        status: "invoiced",
        method: "invoice",
      };
      try {
        await sendInvoiceWebhook(config, invoiced);
        invoiced.discordSentAt = Date.now();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Fattura creata, ma Discord non l'ha ricevuta. Apri comunque il ticket.",
        );
      }
      updateOrder(user, invoiced);
      setOrder(invoiced);
      setOrders(loadOrders(user.id));
      setCart([]);
      putFatturaInUrl(invoiced);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile creare la fattura");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const wanted = takeRememberedInvoice();
    if (!wanted) return;
    rememberOpenInvoice(wanted);
    if (!user) {
      setCheckingOut(true);
      setOrder(null);
      return;
    }
    openInvoiceForUser(user, wanted);
  }, [user]);

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
            <a href="#how">Fattura</a>
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
              Per comprare serve Discord. Lo shop emette la fattura, la manda sul
              Discord, poi apri il ticket Donazione con l&apos;invito.
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
                    <span className="card-actions">
                      <button
                        className="add"
                        onClick={(e) => {
                          e.stopPropagation();
                          add(item);
                        }}
                      >
                        Compra
                      </button>
                      {canManage && (
                        <button
                          className="add remove"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            takeDown(item);
                          }}
                        >
                          Togli
                        </button>
                      )}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="wrap how" id="how">
          <h2>Fattura e ticket</h2>
          <div className="steps">
            <div className="step">
              <b>01</b>
              <h3>Login Discord</h3>
              <p>Senza account non puoi prendere un item né vedere la fattura.</p>
            </div>
            <div className="step">
              <b>02</b>
              <h3>Ricevi la fattura</h3>
              <p>
                Lo shop crea il numero fattura, lo manda sul Discord con account,
                IP del PC, item e prezzo. Salva il numero.
              </p>
            </div>
            <div className="step">
              <b>03</b>
              <h3>Apri il ticket</h3>
              <p>
                Entra nel Discord con l&apos;invito e apri il ticket Donazione con
                il numero fattura.
              </p>
            </div>
          </div>
        </section>

        <section className="wrap trust" id="trust">
          <h2>Ticket Discord Donazione</h2>
          <div className="trust-card">
            <p>
              Dopo la fattura: <b>unisciti al Discord e apri il ticket Donazione</b>.
              Senza login Discord la fattura non si apre.
            </p>
            <div className="hero-actions" style={{ marginTop: 16 }}>
              <a className="btn btn-primary" href={config.discordTicketUrl || DISCORD_INVITE} target="_blank" rel="noreferrer">
                Apri il ticket
              </a>
              <a className="btn btn-ghost" href={DISCORD_INVITE} target="_blank" rel="noreferrer">
                Invito Discord
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="wrap foot">
        <div className="legal" id="privacy">
          <section>
            <h3>Privacy e contatto</h3>
            <p>
              Per gli ordini usiamo il tuo Discord (nome e ID) e l&apos;IP del PC,
              per sapere chi ha preso l&apos;item. Non vendiamo i dati a terzi. Contatto shop:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </section>
          <section>
            <h3>Rimborsi</h3>
            <p>
              I rimborsi non si fanno. Dopo la fattura e il ticket l&apos;ordine è
              in lavorazione: armi MM2 e account sono digitali, non si
              restituiscono. Per problemi scrivi a{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </section>
        </div>
        <div className="foot-row">
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
        </div>
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
                void issueInvoice();
              }}
            >
              {user ? "Richiedi fattura" : "Accedi per la fattura"}
            </button>
          </aside>
        </>
      )}

      {ordersOpen && user && (
        <>
          <div className="overlay" onClick={() => setOrdersOpen(false)} />
          <aside className="drawer">
            <div className="head-row">
              <h2>Le tue fatture</h2>
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
              {orders.length === 0 && <p className="empty">Nessuna fattura ancora.</p>}
              {orders.map((o) => (
                <button
                  className="order-card"
                  key={o.invoice}
                  onClick={() => {
                    setOrdersOpen(false);
                    openInvoiceForUser(user, o.invoice);
                  }}
                >
                  <strong>{o.invoice}</strong>
                  <p>
                    {o.items.map((i) => i.name).join(", ")} · {EUR.format(o.totalEur)}
                  </p>
                  <small>{o.status === "paid" ? "Pagato" : "Fattura emessa"}</small>
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
                {user ? "Aggiungi al carrello" : "Accedi per la fattura"}
              </button>
            </div>
            {canManage && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 12, width: "100%" }}
                disabled={busy}
                onClick={() => takeDown(active)}
              >
                {busy ? "Tolgo..." : "Togli dal sito"}
              </button>
            )}
            {error && <p className="err">{error}</p>}
          </div>
        </>
      )}

      {checkingOut && (
        <>
          <div className="overlay" onClick={() => !busy && (clearOpenInvoice(), setCheckingOut(false))} />
          <div className="modal">
            {!user ? (
              <div className="success">
                <div className="kicker">Login</div>
                <h2>Accedi per la fattura</h2>
                <p style={{ color: "var(--muted)", marginTop: 10 }}>
                  Solo l&apos;account Discord che ha preso l&apos;item può aprirla.
                  Così si sa chi l&apos;ha richiesta.
                </p>
                {error && <p className="err">{error}</p>}
                <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={goLogin}>
                  Accedi con Discord
                </button>
                <a
                  className="btn btn-ghost"
                  style={{ marginTop: 10 }}
                  href={DISCORD_INVITE}
                  target="_blank"
                  rel="noreferrer"
                >
                  Unisciti al Discord
                </a>
              </div>
            ) : busy ? (
              <div className="success">
                <div className="kicker">Fattura</div>
                <h2>Creo la fattura</h2>
                <p style={{ color: "var(--muted)", marginTop: 10 }}>
                  Registro account, IP e item, poi la mando sul Discord.
                </p>
              </div>
            ) : order && order.buyerDiscordId === user.id ? (
              <>
                <InvoiceView
                  order={order}
                  ticketUrl={config.discordTicketUrl || DISCORD_INVITE}
                  inviteUrl={DISCORD_INVITE}
                  onClose={() => {
                    clearOpenInvoice();
                    setCheckingOut(false);
                  }}
                />
                {error && <p className="err">{error}</p>}
              </>
            ) : (
              <div className="success">
                <div className="kicker">Fattura</div>
                <h2>Account sbagliato</h2>
                <p style={{ color: "var(--muted)", marginTop: 10 }}>
                  {error || "Questa fattura non è di questo account Discord."}
                </p>
                <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={goLogin}>
                  Accedi con un altro Discord
                </button>
                <div style={{ marginTop: 16 }}>
                  <button className="btn btn-ghost" onClick={() => { clearOpenInvoice(); setCheckingOut(false); }}>
                    Torna allo shop
                  </button>
                </div>
              </div>
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
                Nel Developer Portal, un solo redirect: <code>{DISCORD_REDIRECT}</code>
                . Attiva <b>Public Client</b>. È lo stesso bot del sito, non serve altro.
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
  const [paypalDefault, setPaypalDefault] = useState("");
  const [listed, setListed] = useState<ShopItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const key = new URLSearchParams(window.location.search).get("key") || "";

  useEffect(() => {
    if (key) saveSellKey(key);
    fetchConfig().then((cfg) => {
      if (cfg.paypalEmail.includes("@")) setPaypalDefault(cfg.paypalEmail);
    });
    fetchItems()
      .then((d) => setListed(d.items))
      .catch(() => setListed([]));
  }, [key]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Trascina la foto dell'arma");
      return;
    }
    setBusy(true);
    setError("");
    setOk("");
    const form = new FormData(event.currentTarget);
    form.set("photo", file);
    form.set("sellerDiscordId", "");
    form.set("sellerName", "SX");
    try {
      const data = await listItem(form, key);
      setListed((prev) => [data.item, ...prev]);
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

  async function takeDown(item: ShopItem) {
    if (!window.confirm(`Togliere ${item.name} dal sito?`)) return;
    setBusy(true);
    setError("");
    try {
      await removeItem(item.id, key);
      setListed((prev) => prev.filter((entry) => entry.id !== item.id));
      setOk(`${item.name} è stato tolto. Tra un minuto sparisce dal sito pubblico.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile togliere l'item");
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
        </div>
      </header>
      <main className="wrap sell-page">
        <div className="kicker">sell-item.bat · non chiudere la finestra nera</div>
        <h1>Metti in vendita</h1>
        {!key && <p className="err">Apri questa pagina con un doppio clic su sell-item.bat.</p>}
        {error && <p className="err">{error}</p>}
        {key && (
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
              <input name="price" type="number" min="0.01" step="0.01" required placeholder="es. 4.90" />
            </label>
            <label>
              Value MM2
              <input name="value" type="number" min="0" step="1" required />
            </label>
            <label>
              Tuo PayPal (email)
              <input
                name="paypal"
                type="email"
                required
                key={paypalDefault}
                defaultValue={paypalDefault}
                placeholder="email PayPal dove ricevi i soldi"
              />
            </label>
            {ok && <p className="ok">{ok}</p>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Pubblico sul sito..." : "Metti in vendita"}
            </button>
          </form>
        )}
        {key && (
          <section className="listed-block">
            <h2>Togli dal sito</h2>
            <p className="listed-hint">Seleziona l&apos;arma e toglila. Sparisce per tutti.</p>
            {listed.length === 0 ? (
              <p className="empty">Nessuna arma in vendita.</p>
            ) : (
              listed.map((item) => (
                <div className="line" key={item.id}>
                  <img src={asset(item.image)} alt="" />
                  <div>
                    <strong>{item.name}</strong>
                    <p>{EUR.format(item.price)}</p>
                  </div>
                  <button className="linkish" disabled={busy} onClick={() => takeDown(item)}>
                    Togli
                  </button>
                </div>
              ))
            )}
          </section>
        )}
      </main>
    </div>
  );
}
