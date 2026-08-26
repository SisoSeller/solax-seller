import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { SellPage } from "./App";
import "./index.css";

const sell = /sell(\.html)?$/i.test(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{sell ? <SellPage /> : <App />}</StrictMode>,
);
