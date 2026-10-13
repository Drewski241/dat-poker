import { useCallback, useEffect, useState } from "react";
import { App } from "./App.js";
import { Feedback } from "./Feedback.js";
import { Landing } from "./Landing.js";
import { Privacy } from "./Privacy.js";
import { SharedHand } from "./SharedHand.js";
import {
  pageToPath,
  parseSiteLocation,
  type SiteLocation,
  type SitePage,
} from "./site-route.js";

export function Root() {
  const [location, setLocation] = useState<SiteLocation>(() =>
    parseSiteLocation(window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => setLocation(parseSiteLocation(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const onNavigate = useCallback((next: SitePage) => {
    const nextLoc: SiteLocation = { page: next };
    const path = pageToPath(next);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setLocation(nextLoc);
  }, []);

  if (location.page === "sharedHand") {
    return <SharedHand handId={location.handId} onNavigate={onNavigate} />;
  }
  if (location.page === "play") {
    return <App onNavigate={onNavigate} />;
  }
  if (location.page === "feedback") {
    return <Feedback onNavigate={onNavigate} />;
  }
  if (location.page === "privacy") {
    return <Privacy onNavigate={onNavigate} />;
  }
  return <Landing onNavigate={onNavigate} />;
}
