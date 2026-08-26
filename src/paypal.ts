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
    components: "buttons,funding-eligibility",
    "enable-funding": "paypal,card,googlepay",
    "disable-funding": "paylater,venmo,credit",
  });
  if (namespace === "paypalSaldo") params.set("locale", "it_IT");
  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

function loadOne(clientId: string, namespace: "paypal" | "paypalSaldo") {
  const ready = () => (namespace === "paypalSaldo" ? window.paypalSaldo : window.paypal);
  if (ready()) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[data-sx-paypal="${namespace}"]`);
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      if (ready()) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("PayPal SDK non caricato")), { once: true });
    });
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = sdkSrc(clientId, namespace);
    script.async = true;
    script.dataset.sxPaypal = namespace;
    if (namespace !== "paypal") script.dataset.namespace = namespace;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("PayPal SDK non caricato"));
    document.head.appendChild(script);
  });
}

export function loadPaypalSdk(clientId: string) {
  return loadOne(clientId, "paypal").then(() => loadOne(clientId, "paypalSaldo").catch(() => undefined));
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
