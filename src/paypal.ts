export type PayMethod = "paypal" | "card" | "googlepay";

type PaypalCapture = {
  id?: string;
  status?: string;
  amount?: { value?: string };
  purchase_units?: Array<{
    amount?: { value?: string };
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { value?: string };
      }>;
    };
  }>;
};

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function moneyValue(value: unknown) {
  const rec = asRecord(value);
  const amount = rec ? asRecord(rec.amount) : null;
  const raw = amount?.value ?? rec?.value;
  if (raw == null || raw === "") return undefined;
  const parsed = Number(String(raw).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function paidCaptureId(details: unknown, expectedEur: number) {
  const root = asRecord(details) as PaypalCapture | null;
  if (!root) return "";

  const unitsRaw = root.purchase_units as unknown;
  const units = Array.isArray(unitsRaw) ? unitsRaw : unitsRaw ? [unitsRaw] : [];
  const captures: PaypalCapture[] = [];
  for (const unit of units) {
    const payments = asRecord(asRecord(unit)?.payments);
    const list = payments?.captures;
    if (Array.isArray(list)) {
      for (const capture of list) {
        const rec = asRecord(capture);
        if (rec) captures.push(rec as PaypalCapture);
      }
    }
  }
  if (!captures.length && root.id && root.status) captures.push(root);

  const completed =
    captures.find((capture) => String(capture.status || "").toUpperCase() === "COMPLETED") ||
    (String(root.status || "").toUpperCase() === "COMPLETED" ? root : undefined);
  if (!completed) return "";

  const status = String(completed.status || root.status || "").toUpperCase();
  if (status !== "COMPLETED") return "";

  const id = String(completed.id || root.id || "");
  if (!id || id.toLowerCase() === "paypal") return "";

  const value = moneyValue(completed) ?? moneyValue(units[0]) ?? moneyValue(root);
  if (value != null && Math.abs(value - expectedEur) > 0.009) return "";
  return id;
}

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
      actions: { order: { capture: () => Promise<unknown> } },
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
