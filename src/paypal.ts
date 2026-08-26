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
  }
}

function sdkSrc(clientId: string) {
  const params = new URLSearchParams({
    "client-id": clientId,
    currency: "EUR",
    intent: "capture",
    components: "buttons,funding-eligibility",
    "enable-funding": "paypal,card,googlepay",
  });
  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

export function loadPaypalSdk(clientId: string) {
  if (window.paypal) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>("script[data-sx-paypal]");
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      if (window.paypal) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("PayPal SDK non caricato")), { once: true });
    });
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = sdkSrc(clientId);
    script.async = true;
    script.dataset.sxPaypal = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("PayPal SDK non caricato"));
    document.head.appendChild(script);
  });
}

export function fundingFor(method: PayMethod) {
  const funding = window.paypal?.FUNDING;
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
