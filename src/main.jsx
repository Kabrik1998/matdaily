import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function MatDailyRuntime() {
  return null;
}

createRoot(document.querySelector("#react-root")).render(<MatDailyRuntime />);

await import("./app.js");
