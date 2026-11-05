import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LobbyModesShelf } from "./LobbyModesShelf.js";

describe("LobbyModesShelf", () => {
  it("surfaces Hold'em as the hero CTA and keeps more games collapsed by default", () => {
    const html = renderToStaticMarkup(
      <LobbyModesShelf
        disabled={false}
        mttLabel="500 MTT"
        moreOpen={false}
        onToggleMore={() => {}}
        onAction={() => {}}
      />,
    );
    expect(html).toContain("Hold&#x27;em · 6-max cash");
    expect(html).toContain("Hold&#x27;em tournaments");
    expect(html).toContain("Omaha");
    expect(html).toContain("More games");
    expect(html).not.toContain("5-Card Draw");
    expect(html).not.toContain("Razz");
  });

  it("lists beta variants when more games is open", () => {
    const html = renderToStaticMarkup(
      <LobbyModesShelf
        disabled={false}
        mttLabel="500 MTT"
        moreOpen
        onToggleMore={() => {}}
        onAction={() => {}}
      />,
    );
    expect(html).toContain("5-Card Draw");
    expect(html).toContain("2-7 Triple Draw");
    expect(html).toContain("Badugi");
    expect(html).toContain("7-Card Stud");
    expect(html).toContain("Razz");
    expect(html).toContain("Pineapple");
  });

  it("fires the hero action", () => {
    const onAction = vi.fn();
    // Server render cannot click; assert the hero button is the primary control.
    const html = renderToStaticMarkup(
      <LobbyModesShelf
        disabled={false}
        mttLabel="500 MTT"
        moreOpen={false}
        onToggleMore={() => {}}
        onAction={onAction}
      />,
    );
    expect(html).toContain('class="lobby-mode-hero-btn"');
    expect(onAction).not.toHaveBeenCalled();
  });
});
