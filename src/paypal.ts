export type PayMethod = "paypal" | "saldo" | "card" | "googlepay";

type PaypalButtonsApi = {
  FUNDING?: { PAYPAL: string; CARD: string; GOOGLEPAY?: string };
  Buttons: (opts: {
    fundingSource?: string;
    style?: Record<string, string>;
    createOrder: (
      data: unknown,
      actions: { order: { create: (body: unknown) => Promise<string> } },
    ) => Promise<string>;
    onApprove: (
      data: unknown,
      actions: { order: { capture: () => Promise<{ id?: string }> } },
    ) => Promise<void>;
    onError?: (err: unknown) => void;
  }) => {
    render: (selector: string) => Promise<void>;
    isEligible?: () => boolean;
  };
};

declare global {
  interface Window {
    paypal?: PaypalButtonsApi;
    paypalSaldo?: PaypalButtonsApi;
  }
}

function sdkSrc(clientId: string, namespace: "paypal" | "paypalSaldo") {
  const params = new URLSearchParams({
    "client-id": clientId,
    currency: "EUR",
    intent: "capture",
    components: "buttons",
    "enable-funding": "paypal,card",
  });
  if (namespace === "paypalSaldo") params.set("locale", "it_IT");
  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

function apiFor(namespace: "paypal" | "paypalSaldo") {
  return namespace === "paypalSaldo" ? window.paypalSaldo : window.paypal;
}

function loadOne(clientId: string, namespace: "paypal" | "paypalSaldo") {
  if (apiFor(namespace)) return Promise.resolve();
  document.querySelectorAll<HTMLScriptElement>(`script[data-sx-paypal="${namespace}"]`).forEach((script) => {
    if (!apiFor(namespace)) script.remove();
  });
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = sdkSrc(clientId, namespace);
    script.async = true;
    script.dataset.sxPaypal = namespace;
    if (namespace !== "paypal") script.dataset.namespace = namespace;
    script.onload = () => {
      const started = Date.now();
      const wait = () => {
        if (apiFor(namespace)) {
          resolve();
          return;
        }
        if (Date.now() - started > 8000) {
          reject(new Error("PayPal SDK non caricato"));
          return;
        }
        window.setTimeout(wait, 50);
      };
      wait();
    };
    script.onerror = () => reject(new Error("PayPal SDK non caricato"));
    document.head.appendChild(script);
  });
}

export function loadPaypalSdk(clientId: string) {
  return loadOne(clientId, "paypal");
}

export function loadPaypalSaldoSdk(clientId: string) {
  return loadOne(clientId, "paypalSaldo").catch(() => undefined);
}

export function paypalApi(method: PayMethod) {
  if (method === "saldo") return window.paypalSaldo || window.paypal;
  return window.paypal;
}

export function fundingFor(api: PaypalButtonsApi | undefined, method: PayMethod) {
  const funding = api?.FUNDING;
  if (!funding) return "paypal";
  if (method === "card") return funding.CARD;
  if (method === "googlepay") return funding.GOOGLEPAY || "googlepay";
  return funding.PAYPAL;
}

export function landingFor(method: PayMethod) {
  if (method === "saldo") return "LOGIN";
  if (method === "card") return "BILLING";
  return "NO_PREFERENCE";
}
