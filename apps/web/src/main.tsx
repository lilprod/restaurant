import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { registerServiceWorker } from "./lib/pwa";
import { installFrenchErrors } from "./lib/zod-fr";
import "./styles/globals.css";

installFrenchErrors();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
