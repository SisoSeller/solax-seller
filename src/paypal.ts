type PaypalButtonsApi = {
  Buttons: (opts: {
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

export function loadPaypalSdk(clientId: string) {
  const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paypal,card`;
  const existing = document.querySelector<HTMLScriptElement>(`script[src^="https://www.paypal.com/sdk/js"]`);
  if (window.paypal && existing) return Promise.resolve();
  if (existing) {
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
