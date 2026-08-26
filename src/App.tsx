import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTACT_EMAIL,
  EUR,
  VALUE,
  type ShopConfig,
  clearPendingPaypal,
  completeDiscordLogin,
  createOrder,
  fetchConfig,
  fetchItems,
  listItem,
  loadOrders,
  loadPendingPaypal,
  loadSellKey,
  loadUser,
  loginWithDiscord,
  logout,
  markItemsSold,
  removeItem,
  savePendingPaypal,
  saveSellKey,
  sendInvoiceWebhook,
  updateOrder,
} from "./api";
import { DISCORD_INVITE, DISCORD_REDIRECT } from "./discord";
import { asset, siteOriginPath } from "./paths";
import {
  fundingFor,
  loadPaypalSdk,
  logoutThenPaypal,
  paidCaptureId,
  paypalEndpoint,
  paypalReturnReceipt,
  paypalServerReady,
  startPaypalHostedCheckout,
  type PayMethod,
} from "./paypal";
import type { DiscordUser, Order, ShopItem } from "./types";

function payeeEmail(config: ShopConfig, order: Order) {
  if (config.paypalEmail.includes("@")) return config.paypalEmail;
  const fromItem = order.items.find((item) => item.paypal.includes("@"));
  return fromItem?.paypal || "";
}

function beginHostedPay(config: ShopConfig, source: Order) {
  const payTo = payeeEmail(config, source);
  if (!payTo) return false;
  const here = siteOriginPath();
  startPaypalHostedCheckout({
    email: payTo,
    amount: source.totalEur,
    invoice: source.invoice,
    itemName: source.items.map((item) => item.name).join(", ") || `SX ${source.invoice}`,
    returnUrl: `${here}?paypal_return=1&invoice=${encodeURIComponent(source.invoice)}`,
    cancelUrl: `${here}?paypal_cancel=1&invoice=${encodeURIComponent(source.invoice)}`,
  });
  return true;
}

const PAY_BUTTONS: {
  id: string;
  method: PayMethod;
  style: Record<string, string>;
}[] = [
  { id: "paypal-wallet", method: "paypal", style: { color: "gold", shape: "pill", label: "paypal", layout: "vertical" } },
];

function hidePaySlot(id: string) {
  const slot = document.querySelector<HTMLElement>(`[data-pay="${id}"]`);
  if (slot) slot.hidden = true;
}

const finishingInvoices = new Set<string>();
const PAYPAL_BUYER_OK = "sx-pp-buyer";
let paypalResumeBusy = false;

function buyerFromOrder(order: Order, user: DiscordUser | null): DiscordUser {
  if (user && user.id === order.buyerDiscordId) return user;
  const saved = loadUser();
  if (saved && saved.id === order.buyerDiscordId) return saved;
  return {
    id: order.buyerDiscordId,
    username: order.buyerUsername,
    tag: order.buyerUsername,
    avatar: "",
  };
}

function cleanPaypalQuery() {
  const url = new URL(window.location.href);
  [
    "paypal_go",
    "paypal_return",
    "paypal_cancel",
    "invoice",
    "st",
    "amt",
    "cc",
    "cm",
    "tx",
    "txn_id",
    "payment_status",
    "mc_gross",
    "item_number",
    "sig",
    "auth",
    "token",
  ].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, "", url);
}

function renderWithTimeout(render: Promise<void>, ms = 7000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    render.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  const [mode, setMode] = useState<"loading" | "sdk" | "hosted">("loading");
  const email = payeeEmail(config, order);

  useEffect(() => {
    let gone = false;
    paypalServerReady(config.paypalApiUrl).then((ok) => {
      if (!gone) setMode(ok && config.paypalClientId ? "sdk" : "hosted");
    });
    return () => {
      gone = true;
    };
  }, [config.paypalApiUrl, config.paypalClientId]);

  useEffect(() => {
    if (mode !== "sdk" || !config.paypalClientId) return;
    const hosts = PAY_BUTTONS.map((btn) => document.getElementById(btn.id));
    if (hosts.some((host) => !host)) return;
    hosts.forEach((host) => {
      host!.innerHTML = "";
    });
    PAY_BUTTONS.forEach((btn) => {
      const slot = document.querySelector<HTMLElement>(`[data-pay="${btn.id}"]`);
      if (slot) slot.hidden = false;
    });
    let gone = false;
    loadPaypalSdk(config.paypalClientId)
      .then(async () => {
        if (gone) return;
        errorRef.current("");
        let shown = 0;
        let capturing = false;
        const renderOne = async (spec: (typeof PAY_BUTTONS)[number]) => {
          if (gone || !window.paypal) return;
          try {
            const button = window.paypal.Buttons({
              fundingSource: fundingFor(spec.method),
              style: spec.style,
              createOrder: async () => {
                const res = await fetch(paypalEndpoint(config.paypalApiUrl, "create"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ invoice: order.invoice, amount: order.totalEur }),
                });
                const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
                if (!res.ok || !data.id) throw new Error(data.error || "PayPal create fallito");
                return data.id;
              },
              onApprove: async (data) => {
                if (capturing) return;
                capturing = true;
                try {
                  const rec = data as { orderID?: string; orderId?: string };
                  const orderID = rec.orderID || rec.orderId || "";
                  const res = await fetch(paypalEndpoint(config.paypalApiUrl, "capture"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      orderID,
                      amount: order.totalEur,
                      invoice: order.invoice,
                    }),
                  });
                  const captured = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    capturing = false;
                    errorRef.current(
                      (captured as { error?: string }).error ||
                        "PayPal non ha preso i soldi. Il pagamento non e confermato.",
                    );
                    return;
                  }
                  const captureId = paidCaptureId(captured, order.totalEur);
                  if (!captureId) {
                    capturing = false;
                    errorRef.current("PayPal non ha preso i soldi. Il pagamento non e confermato.");
                    return;
                  }
                  paidRef.current(captureId);
                } catch {
                  capturing = false;
                  errorRef.current("Pagamento non riuscito. Nessun addebito confermato.");
                }
              },
              onCancel: () => errorRef.current("Pagamento annullato."),
              onError: () => errorRef.current("Pagamento PayPal non riuscito. Riprova."),
            });
            await renderWithTimeout(button.render(`#${spec.id}`));
            shown += 1;
          } catch {
            hidePaySlot(spec.id);
          }
        };
        await Promise.all(PAY_BUTTONS.map(renderOne));
        PAY_BUTTONS.forEach((spec) => {
          const slot = document.querySelector(`[data-pay="${spec.id}"]`);
          if (slot && slot.querySelectorAll("iframe").length === 0) hidePaySlot(spec.id);
        });
        if (!gone && shown === 0) errorRef.current("Impossibile caricare PayPal.");
      })
      .catch(() => {
        if (!gone) setMode("hosted");
      });
    return () => {
      gone = true;
      hosts.forEach((host) => {
        host!.innerHTML = "";
      });
    };
  }, [mode, config.paypalApiUrl, config.paypalClientId, config.paypalEmail, order.invoice, order.totalEur]);

  function goHosted() {
    if (!email) {
      onError("Manca l'email PayPal dello shop.");
      return;
    }
    savePendingPaypal(order);
    if (sessionStorage.getItem(PAYPAL_BUYER_OK) === "1") {
      beginHostedPay(config, order);
      return;
    }
    const here = siteOriginPath();
    logoutThenPaypal(`${here}?paypal_go=1&invoice=${encodeURIComponent(order.invoice)}`);
  }

  if (!email) {
    return (
      <p className="err">
        PayPal non è collegato. Metti <code>paypalEmail</code> in shop-config.json.
      </p>
    );
  }
  if (mode === "loading") {
    return <p style={{ color: "var(--muted)" }}>Carico PayPal...</p>;
  }
  if (mode === "hosted") {
    return (
      <div className="paypal-hosted">
        <button type="button" className="paypal-hosted-btn paypal-hosted-gold" onClick={goHosted} aria-label="PayPal">
          <img className="paypal-hosted-logo" src={asset("paypal-wordmark.svg")} alt="" />
        </button>
        <p className="paypal-hosted-note">
          Accedi con il tuo PayPal, non con {email}.
        </p>
      </div>
    );
  }
  return (
    <div className="paypal-buttons">
      <div className="pay-slot" data-pay="paypal-wallet">
        <div id="paypal-wallet" />
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

  function startPaypalCheckout() {
    if (!user) {
      goLogin();
      return;
    }
    if (cart.length === 0) return;
    const created = createOrder(user, cart);
    setOrder(created);
    setOrders(loadOrders(user.id));
    setCart([]);
    setCartOpen(false);
    setCheckingOut(true);
    setError("");
  }

  async function completePaid(source: Order, captureId: string) {
    const existing = loadOrders(source.buyerDiscordId).find((entry) => entry.invoice === source.invoice);
    if (existing?.status === "paid") {
      finishingInvoices.add(source.invoice);
      setOrder(existing);
      setCheckingOut(true);
      clearPendingPaypal();
      return;
    }
    if (finishingInvoices.has(source.invoice)) return;
    finishingInvoices.add(source.invoice);
    const buyer = buyerFromOrder(source, user);
    setBusy(true);
    setError("");
    const paid: Order = {
      ...source,
      status: "paid",
      paidAt: Date.now(),
      paymentNote: `PayPal ${captureId}`,
    };
    const soldIds = paid.items.map((item) => item.id);
    setItems((prev) => prev.filter((item) => !soldIds.includes(item.id)));
    setCart((prev) => prev.filter((item) => !soldIds.includes(item.id)));
    setActive((current) => (current && soldIds.includes(current.id) ? null : current));
    setOrder(paid);
    setCheckingOut(true);
    updateOrder(buyer, paid);
    setOrders(loadOrders(buyer.id));
    clearPendingPaypal();
    try {
      await markItemsSold(soldIds, sellKey);
    } catch {
      // L'annuncio sparisce comunque da questo browser; sul sito pubblico
      // serve il push da sell-item.bat.
    }
    try {
      await sendInvoiceWebhook(config, paid, paid.paymentNote || captureId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pagato, ma il webhook Discord non e partito.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!config.paypalEmail && !config.discordWebhookUrl) return;

    if (params.get("paypal_go") === "1") {
      const pending = loadPendingPaypal();
      const invoice = params.get("invoice") || pending?.invoice || "";
      if (!pending || (invoice && pending.invoice !== invoice)) {
        cleanPaypalQuery();
        setError("Ordine PayPal non trovato. Riprova a pagare.");
        return;
      }
      if (paypalResumeBusy) return;
      paypalResumeBusy = true;
      sessionStorage.setItem(PAYPAL_BUYER_OK, "1");
      cleanPaypalQuery();
      if (!beginHostedPay(config, pending)) {
        paypalResumeBusy = false;
        setError("Manca l'email PayPal dello shop.");
      }
      return;
    }

    const pdtPaid =
      Boolean(params.get("tx") || params.get("txn_id")) ||
      (params.get("st") || params.get("payment_status") || "").toUpperCase() === "COMPLETED";
    const cameBack = params.get("paypal_return") === "1" || pdtPaid;
    const cancelled = params.get("paypal_cancel") === "1";
    if (!cameBack && !cancelled) return;

    if (cancelled) {
      clearPendingPaypal();
      cleanPaypalQuery();
      setError("Pagamento annullato.");
      return;
    }

    const pending = loadPendingPaypal();
    const invoice = params.get("invoice") || pending?.invoice || "";
    if (!pending || (invoice && pending.invoice !== invoice)) {
      cleanPaypalQuery();
      setError("Ordine PayPal non trovato. Se hai gia pagato, apri il ticket Discord.");
      return;
    }

    const receipt = paypalReturnReceipt(params, pending.totalEur);
    if (!receipt.ok) {
      cleanPaypalQuery();
      if (receipt.reason === "pending") {
        setError("PayPal ha il pagamento in attesa. La fattura parte quando e completato.");
        return;
      }
      if (receipt.reason === "amount") {
        setError("Importo PayPal diverso dall'ordine. Il pagamento non e confermato.");
        return;
      }
      setError("PayPal non ha confermato il pagamento.");
      return;
    }

    const captureId = receipt.tx || `host-${pending.invoice}`;
    cleanPaypalQuery();
    void completePaid(pending, captureId);
  }, [config, user]);

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
              Per comprare serve Discord. Paghi con PayPal, poi apri il ticket
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
          <h2>PayPal</h2>
          <div className="steps">
            <div className="step">
              <b>01</b>
              <h3>Login Discord</h3>
              <p>Senza account non puoi comprare. Il tuo profilo resta in alto.</p>
            </div>
            <div className="step">
              <b>02</b>
              <h3>Paga il venditore</h3>
              <p>
                Paghi con PayPal. Completa il pagamento sulla pagina PayPal:
                i soldi arrivano subito allo shop.
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
        <div className="legal" id="privacy">
          <section>
            <h3>Privacy e contatto</h3>
            <p>
              Per gli ordini usiamo il tuo Discord (nome e ID) e i dati del
              pagamento. Non vendiamo i dati a terzi. Contatto shop:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </section>
          <section>
            <h3>Rimborsi</h3>
            <p>
              I rimborsi non si fanno. Dopo il pagamento l&apos;ordine è chiuso: armi
              MM2 e account sono digitali, non si restituiscono. Pagando accetti
              questa regola. Per problemi scrivi a{" "}
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
                setCartOpen(false);
                startPaypalCheckout();
              }}
            >
              {user ? "Paga con PayPal" : "Accedi per comprare"}
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
                  <strong>{o.status === "paid" ? o.invoice : "Da pagare"}</strong>
                  <p>
                    {o.items.map((i) => i.name).join(", ")} · {EUR.format(o.totalEur)}
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
          <div className="overlay" onClick={() => !busy && setCheckingOut(false)} />
          <div className="modal">
            {order?.status === "paid" ? (
              <div className="success">
                <div className="kicker">Pagamento ok</div>
                <h2>La tua fattura</h2>
                <p style={{ color: "var(--muted)", marginTop: 10 }}>
                  Questo codice è la prova del pagamento. Mandalo nel ticket Discord.
                </p>
                <code className="invoice-code">{order.invoice}</code>
                {(config.discordTicketUrl || DISCORD_INVITE) && (
                  <a
                    className="btn btn-primary"
                    style={{ marginTop: 18 }}
                    href={config.discordTicketUrl || DISCORD_INVITE}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Apri il ticket Discord Donazione
                  </a>
                )}
                <div style={{ marginTop: 16 }}>
                  <button className="btn btn-ghost" onClick={() => setCheckingOut(false)}>
                    Torna allo shop
                  </button>
                </div>
              </div>
            ) : order ? (
              <>
                <div className="head-row">
                  <h2>Paga</h2>
                  <button className="close" onClick={() => setCheckingOut(false)}>
                    ×
                  </button>
                </div>
                <p>
                  Totale: <b className="gold">{EUR.format(order.totalEur)}</b>
                </p>
                <div className="pay-box">
                  <h3>Paga con PayPal</h3>
                  <p>
                    Completa il pagamento con il tuo account PayPal, non con
                    quello dello shop. I soldi arrivano allo shop. La fattura la
                    vedi dopo. Nessun rimborso.
                  </p>
                  <PaypalCheckout
                    config={config}
                    order={order}
                    onPaid={(captureId) => void completePaid(order, captureId)}
                    onError={setError}
                  />
                </div>
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
                  Totale: <b className="gold">{EUR.format(total)}</b>
                </p>
                <p style={{ color: "var(--muted)", margin: "8px 0 16px" }}>
                  Paghi con PayPal. I soldi arrivano allo shop.
                </p>
                {error && <p className="err">{error}</p>}
                <button className="btn btn-primary" disabled={cart.length === 0} onClick={startPaypalCheckout}>
                  Paga con PayPal
                </button>
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
