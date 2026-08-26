import { Component, ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { SellPage } from "./App";
import "./index.css";

class ShopErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "Errore nel sito" };
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ padding: 32, maxWidth: 560 }}>
          <h1>SX shop</h1>
          <p>Il sito ha avuto un errore. Ricarica la pagina.</p>
          <p style={{ color: "#9b93a8", marginTop: 12 }}>{this.state.error}</p>
        </main>
      );
    }
    return this.props.children;
  }
}

const sell = /sell(\.html)?$/i.test(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShopErrorBoundary>{sell ? <SellPage /> : <App />}</ShopErrorBoundary>
  </StrictMode>,
);
