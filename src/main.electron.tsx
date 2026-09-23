import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

function backupDesktopStorage() {
  const persistAll = window.electronAPI?.persistAll;
  if (!persistAll) return;
  const dump: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key);
    if (value != null) dump[key] = value;
  }
  persistAll(dump);
}

backupDesktopStorage();
window.addEventListener("beforeunload", backupDesktopStorage);
window.setInterval(backupDesktopStorage, 4000);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
