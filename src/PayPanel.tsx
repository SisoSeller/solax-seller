import { useEffect, useRef, useState } from "react";
import { type ShopConfig, itemRobux, methodLabel, orderRobux } from "./api";
import { asset, siteOriginPath } from "./paths";
import { fundingFor, loadPaypalSdk, paidCaptureId, startPaypalHostedCheckout } from "./paypal";
import type { Order } from "./types";

export type PayChoice = "paypal" | "card" | "robux";

function payeeEmail(config: ShopConfig, order: Order) {
  if (config.paypalEmail.includes("@")) return config.paypalEmail;
  const fromItem = order.items.find((item) => item.paypal.includes("@"));
  return fromItem?.paypal || "";
}

function PaypalSlot({
  config,
  order,
  method,
  onError,
  onPaid,
}: {
  config: ShopConfig;
  order: Order;
  method: "paypal" | "card";
  onError: (message: string) => void;
  onPaid: (captureId: string, method: "paypal" | "card") => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const onPaidRef = useRef(onPaid);
  onErrorRef.current = onError;
  onPaidRef.current = onPaid;
  const [sdkReady, setSdkReady] = useState(false);
  const email = payeeEmail(config, order);
  const itemLabel = order.items.map((item) => item.name).join(", ");

  function goHosted() {
    if (!email) return;
    const here = siteOriginPath();
    startPaypalHostedCheckout({
      email,
      amount: order.totalEur,
      invoice: order.invoice,
      itemName: itemLabel || "SX",
      returnUrl: `${here}?paypal_return=1&invoice=${encodeURIComponent(order.invoice)}`,
      cancelUrl: `${here}?paypal_cancel=1&invoice=${encodeURIComponent(order.invoice)}`,
      landing: method === "card" ? "Billing" : "Login",
    });
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!config.paypalClientId || !email || !host) return;
    let closed = false;
    let buttons: { close?: () => Promise<void> | void } | null = null;
    setSdkReady(false);

    void (async () => {
      try {
        await loadPaypalSdk(config.paypalClientId);
        if (closed || !window.paypal) return;
        const instance = window.paypal.Buttons({
          fundingSource: fundingFor(method),
          style:
            method === "card"
              ? { layout: "horizontal", color: "black", shape: "rect", label: "pay", height: 45, tagline: false }
              : { layout: "horizontal", color: "gold", shape: "pill", label: "paypal", height: 45, tagline: false },
          createOrder: (_data, actions) =>
            actions.order.create({
              purchase_units: [
                {
                  invoice_id: order.invoice,
                  custom_id: order.invoice,
                  description: (itemLabel || "SX").slice(0, 127),
                  amount: {
                    currency_code: "EUR",
                    value: order.totalEur.toFixed(2),
                  },
                  payee: { email_address: email },
                },
              ],
              application_context: {
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                brand_name: "SX",
                landing_page: method === "card" ? "BILLING" : "LOGIN",
              },
            }),
          onApprove: async (_data, actions) => {
            const details = await actions.order.capture();
            const captureId = paidCaptureId(details, order.totalEur);
            if (!captureId) {
              onErrorRef.current("PayPal non ha confermato l'addebito");
              return;
            }
            onPaidRef.current(captureId, method);
          },
          onCancel: () => onErrorRef.current("Pagamento annullato."),
          onError: () => onErrorRef.current("Pagamento non disponibile. Riprova."),
        });
        if (instance.isEligible && !instance.isEligible()) return;
        await instance.render(host);
        if (closed) {
          await instance.close?.();
          return;
        }
        buttons = instance;
        setSdkReady(true);
      } catch {
        if (!closed) setSdkReady(false);
      }
    })();

    return () => {
      closed = true;
      setSdkReady(false);
      try {
        void buttons?.close?.();
      } catch {
        /* ignore */
      }
      host.innerHTML = "";
    };
  }, [config.paypalClientId, email, itemLabel, method, order.invoice, order.totalEur]);

  if (!email) {
    return <p className="err">PayPal non è collegato.</p>;
  }

  if (method === "card") {
    return (
      <div className="paypal-hosted">
        <div ref={hostRef} className="paypal-card-slot" />
        {!sdkReady && (
          <button type="button" className="btn btn-primary" onClick={goHosted}>
            Paga con carta
          </button>
        )}
        <p className="paypal-hosted-note">Carta di debito o credito su PayPal. Nessun rimborso.</p>
      </div>
    );
  }

  return (
    <div className="paypal-hosted">
      <div className={`paypal-sdk-wrap${sdkReady ? "" : " is-fallback"}`}>
        <button
          type="button"
          className="paypal-hosted-btn paypal-hosted-gold paypal-sdk-face"
          onClick={goHosted}
          aria-label="PayPal"
        >
          <img className="paypal-hosted-logo" src={asset("paypal-wordmark.svg")} alt="" />
        </button>
        <div ref={hostRef} className="paypal-sdk-hit" />
      </div>
      <p className="paypal-hosted-note">Paga con il tuo account PayPal. Nessun rimborso.</p>
    </div>
  );
}

export function PayPanel({
  config,
  order,
  ticketUrl,
  onError,
  onPaid,
  onChoose,
}: {
  config: ShopConfig;
  order: Order;
  ticketUrl: string;
  onError: (message: string) => void;
  onPaid: (captureId: string, method: "paypal" | "card") => void;
  onChoose: (method: PayChoice) => void;
}) {
  const initial: PayChoice =
    order.method === "card" || order.method === "robux" || order.method === "paypal" ? order.method : "paypal";
  const [tab, setTab] = useState<PayChoice>(initial);
  const robux = orderRobux(order);

  function pick(next: PayChoice) {
    setTab(next);
    onChoose(next);
    onError("");
  }

  return (
    <div className="pay-panel">
      <p className="pay-panel-kicker">Paga questa fattura</p>
      <div className="pay-tabs" role="tablist">
        <button type="button" className={tab === "paypal" ? "on" : ""} onClick={() => pick("paypal")}>
          PayPal
        </button>
        <button type="button" className={tab === "card" ? "on" : ""} onClick={() => pick("card")}>
          Carta
        </button>
        <button type="button" className={tab === "robux" ? "on" : ""} onClick={() => pick("robux")}>
          Robux
        </button>
      </div>
      {tab === "robux" ? (
        <div className="pay-box">
          <h3>Paga in Robux</h3>
          <p>
            Totale: <b>{robux} R$</b>
          </p>
          <ul>
            {order.items.map((item) => (
              <li key={item.id}>
                {item.name} — {itemRobux(item)} R$
              </li>
            ))}
          </ul>
          <p>
            Apri il ticket Donazione, scrivi il numero fattura <b>{order.invoice}</b> e paga{" "}
            <b>{robux} R$</b>.
          </p>
          <a className="btn btn-primary" href={ticketUrl} target="_blank" rel="noreferrer">
            Paga i Robux nel ticket
          </a>
        </div>
      ) : (
        <PaypalSlot
          config={config}
          order={order}
          method={tab}
          onError={onError}
          onPaid={onPaid}
        />
      )}
      <p className="paypal-hosted-note">Metodo: {methodLabel(tab)} · {order.invoice}</p>
    </div>
  );
}
