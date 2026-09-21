import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { CloseProvider } from "@/lib/closeStore";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CloseProvider>
      <App />
    </CloseProvider>
  </React.StrictMode>
);
