import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Sell from "./Sell";
import "./index.css";

const page = window.location.pathname.startsWith("/sell") ? <Sell /> : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
