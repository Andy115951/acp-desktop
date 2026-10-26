import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { watchTheme } from "./lib/theme";
import { useUiStore } from "./store/ui";

const stopWatchingTheme = watchTheme(() => useUiStore.getState().theme);
if (import.meta.hot) import.meta.hot.dispose(stopWatchingTheme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
