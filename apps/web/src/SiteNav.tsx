import type { MouseEvent } from "react";
import type { SitePage } from "./site-route.js";
import { pageToPath } from "./site-route.js";

export type SiteNavPage = SitePage | "sharedHand";

export function SiteNav({
  page,
  onNavigate,
}: {
  page: SiteNavPage;
  onNavigate: (next: SitePage) => void;
}) {
  const go = (next: SitePage) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onNavigate(next);
  };

  return (
    <nav className="site-nav" aria-label="Site">
      <a href={pageToPath("landing")} className={page === "landing" ? "active" : ""} onClick={go("landing")}>
        Home
      </a>
      <a href={pageToPath("play")} className={page === "play" ? "active" : ""} onClick={go("play")}>
        Play
      </a>
      <a href={pageToPath("feedback")} className={page === "feedback" ? "active" : ""} onClick={go("feedback")}>
        Feedback
      </a>
      <a href={pageToPath("privacy")} className={page === "privacy" ? "active" : ""} onClick={go("privacy")}>
        Privacy
      </a>
      {page === "ops" ? (
        <a href={pageToPath("ops")} className="active" onClick={go("ops")}>
          Ops
        </a>
      ) : null}
    </nav>
  );
}
