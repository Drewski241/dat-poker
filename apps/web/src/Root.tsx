import { useCallback, useEffect, useState } from "react";
import { App } from "./App.js";
import { Feedback } from "./Feedback.js";
import { Landing } from "./Landing.js";
import { pageToPath, pathToPage, type SitePage } from "./site-route.js";

export function Root() {
  const [page, setPage] = useState<SitePage>(() => pathToPage(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPage(pathToPage(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const onNavigate = useCallback((next: SitePage) => {
    const path = pageToPath(next);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setPage(next);
  }, []);

  if (page === "play") {
    return <App onNavigate={onNavigate} />;
  }
  if (page === "feedback") {
    return <Feedback onNavigate={onNavigate} />;
  }
  return <Landing onNavigate={onNavigate} />;
}
