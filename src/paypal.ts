type PaypalButtonsApi = {
  FUNDING?: { PAYPAL: string; CARD: string };
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
  }) => { render: (selector: string) => Promise<void> };
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
  const src = sdkSrc(clientId);
  const existing = document.querySelector<HTMLScriptElement>(`script[src^="https://www.paypal.com/sdk/js"]`);
  if (existing && existing.src !== src) {
    existing.remove();
    window.paypal = undefined;
  }
  if (window.paypal && document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  if (existing && existing.src === src) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("PayPal SDK non caricato")), { once: true });
    });
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("PayPal SDK non caricato"));
    document.head.appendChild(script);
  });
}
