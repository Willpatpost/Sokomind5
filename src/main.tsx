import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ExperienceProvider } from "./features/experience";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import "./styles/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Sokomind could not find its application mount point.");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ExperienceProvider>
        <App />
      </ExperienceProvider>
    </ErrorBoundary>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const workerUrl = new URL("sw.js", document.baseURI);
    const scope = new URL("./", document.baseURI).pathname;
    navigator.serviceWorker
      .register(workerUrl, { scope })
      .then((registration) => {
        const promptUpdate = (worker: ServiceWorker) => {
          worker.postMessage({ type: "SKIP_WAITING" });
        };

        if (registration.waiting) {
          promptUpdate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && registration.waiting) {
              promptUpdate(registration.waiting);
            }
          });
        });
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}
