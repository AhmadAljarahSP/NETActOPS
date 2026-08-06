import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Intercept all fetch requests to catch 401 Unauthorized errors globally
const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  const response = await originalFetch(input, init);
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("netact-api-unauthorized"));
  }
  return response;
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);