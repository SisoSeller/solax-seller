export type PayMethod = "paypal" | "card" | "googlepay";

type PaypalCapture = {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { value?: string };
      }>;
    };
  }>;
};

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
      actions: { order: { capture: () => Promise<PaypalCapture> } },
    ) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }) => {
    render: (selector: string) => Promise<void>;
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
    components: "buttons",
    "enable-funding": "paypal,card",
  });
  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

export function loadPaypalSdk(clientId: string) {
  if (window.paypal) return Promise.resolve();
  document.querySelectorAll<HTMLScriptElement>("script[data-sx-paypal]").forEach((script) => {
    if (!window.paypal) script.remove();
  });
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = sdkSrc(clientId);
    script.async = true;
    script.dataset.sxPaypal = "paypal";
    script.onload = () => {
      const started = Date.now();
      const wait = () => {
        if (window.paypal) {
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

export function fundingFor(method: PayMethod) {
  const funding = window.paypal?.FUNDING;
  if (!funding) return "paypal";
  if (method === "card") return funding.CARD;
  if (method === "googlepay") return funding.GOOGLEPAY || "googlepay";
  return funding.PAYPAL;
}

export function landingFor(method: PayMethod) {
  if (method === "card") return "BILLING";
  return "LOGIN";
}

export function paidCaptureId(details: PaypalCapture | undefined, expectedEur: number) {
  const capture = details?.purchase_units?.[0]?.payments?.captures?.[0];
  const status = capture?.status || details?.status;
  const value = Number(capture?.amount?.value);
  if (!capture?.id || status !== "COMPLETED") return "";
  if (!Number.isFinite(value) || Math.abs(value - expectedEur) > 0.05) return "";
  return capture.id;
}
