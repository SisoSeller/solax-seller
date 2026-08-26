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
  if (!captures.length) return "";

  const completed = captures.find(
    (capture) => String(capture.status || "").toUpperCase() === "COMPLETED",
  );
  if (!completed?.id) return "";

  const value = moneyValue(completed) ?? moneyValue(units[0]) ?? moneyValue(root);
  if (value == null || Math.abs(value - expectedEur) > 0.009) return "";
  return String(completed.id);
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
    "enable-funding": "paypal",
    "disable-funding": "card,credit,paylater",
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

export function paypalReturnReceipt(params: URLSearchParams, expectedEur: number) {
  const st = (params.get("st") || params.get("payment_status") || "").trim().toUpperCase();
  const rawAmt = params.get("amt") || params.get("mc_gross") || "";
  const amt = Number(String(rawAmt).replace(",", "."));
  const tx = (params.get("tx") || params.get("txn_id") || "").trim();
  const invoice = (params.get("invoice") || params.get("item_number") || params.get("cm") || "").trim();
  if (st && st !== "COMPLETED") {
    return {
      ok: false as const,
      invoice,
      tx,
      reason: st === "PENDING" ? "pending" : "failed",
    };
  }
  if (rawAmt && (!Number.isFinite(amt) || Math.abs(amt - expectedEur) > 0.009)) {
    return { ok: false as const, invoice, tx, reason: "amount" };
  }
  return { ok: true as const, invoice, tx, reason: "" };
}

export function paypalEndpoint(apiUrl: string, path: string) {
  const base = (apiUrl || "").replace(/\/$/, "");
  if (base) return `${base}/paypal/${path}`;
  if (window.location.protocol === "https:") return "";
  return `/paypal/${path}`;
}

export async function paypalServerReady(apiUrl: string) {
  const url = paypalEndpoint(apiUrl, "health");
  if (!url) return false;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return Boolean(res.ok && data.ok);
  } catch {
    return false;
  }
}

export function startPaypalHostedCheckout(opts: {
  email: string;
  amount: number;
  invoice: string;
  itemName: string;
  returnUrl: string;
  cancelUrl: string;
}) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://www.paypal.com/cgi-bin/webscr";
  form.acceptCharset = "UTF-8";
  const fields: Record<string, string> = {
    cmd: "_xclick",
    business: opts.email,
    item_name: opts.itemName.slice(0, 127),
    amount: opts.amount.toFixed(2),
    currency_code: "EUR",
    no_shipping: "1",
    no_note: "1",
    custom: opts.invoice,
    invoice: opts.invoice,
    item_number: opts.invoice,
    return: opts.returnUrl,
    cancel_return: opts.cancelUrl,
    cbt: "Torna allo shop SX",
    rm: "1",
    charset: "utf-8",
    lc: "IT",
    landing_page: "Login",
    paymentaction: "sale",
  };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function logoutThenPaypal(resumeUrl: string) {
  const form = document.createElement("form");
  form.method = "GET";
  form.action = "https://www.paypal.com/cgi-bin/webscr";
  form.acceptCharset = "UTF-8";
  const fields: Record<string, string> = {
    cmd: "_logout",
    return: resumeUrl,
  };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
