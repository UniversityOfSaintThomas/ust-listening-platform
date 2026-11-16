import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "./Dashboard";
import Participant from "./Participant";
import "./styles.css";

// Routes: /review is the results page. /admin opens campaign setup. /c/<slug> is a campaign. / is the default campaign.
const path = window.location.pathname.split("/").filter(Boolean);
const view =
  path[0] === "review" || path[0] === "admin" ? <Dashboard startInAdmin={path[0] === "admin"} /> : <Participant slug={path[0] === "c" && path[1] ? path[1] : ""} />;

createRoot(document.getElementById("root")!).render(<StrictMode>{view}</StrictMode>);
