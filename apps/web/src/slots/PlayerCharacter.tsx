export type PlayerPose = "seated" | "reaching" | "celebrate";

export function PlayerCharacter({ pose, name }: { pose: PlayerPose; name: string | null }) {
  const caption =
    pose === "celebrate" ? "Youthful — jumping" : "Elderly player, stays seated";

  return (
    <aside className="player-column" data-pose={pose}>
      <div className={`player-character ${pose}`} role="img" aria-label={caption}>
        <div className="stage">
          <svg className="room-layer" viewBox="0 0 320 480" aria-hidden="true">
            <rect x="78" y="268" width="136" height="96" rx="18" className="chair-back" />
            <rect x="70" y="348" width="168" height="28" rx="12" className="chair-seat" />
            <rect x="96" y="372" width="14" height="58" rx="4" className="chair-leg" />
            <rect x="206" y="372" width="14" height="58" rx="4" className="chair-leg" />
            <rect x="118" y="392" width="92" height="12" rx="6" className="footrest" />
            <path d="M248 250c18-8 28 6 22 20" className="cane-crook" />
            <line x1="262" y1="268" x2="274" y2="430" className="cane" />
          </svg>
          <div className="jumper">
            <svg viewBox="0 0 320 480" aria-hidden="true">
            <g className="elder">
              <g className="elder-body">
                <ellipse cx="156" cy="346" rx="54" ry="18" className="pants" />
                <path d="M118 338c-6-48 8-78 28-96 18 8 48 10 62 46 6 28-8 58-34 64z" className="sweater" />
                <path d="M146 248c8 20 8 36 2 52" className="cardigan-edge" />
                <circle cx="168" cy="214" r="32" className="skin" />
                <path d="M140 208c2-28 58-34 64-4-8-16-50-20-64 4z" className="hair-gray" />
                <path d="M142 198c10-8 28-10 40-2" className="hair-gray" />
                <path d="M150 204h28M148 212h16" className="wrinkle" />
                <circle cx="156" cy="216" r="9" className="glasses" />
                <circle cx="180" cy="216" r="9" className="glasses" />
                <line x1="165" y1="216" x2="171" y2="216" className="glasses" />
                <circle cx="154" cy="217" r="1.6" className="eye" />
                <circle cx="178" cy="217" r="1.6" className="eye" />
                <path d="M158 232c6 4 12 4 18 0" className="mouth" />
                <ellipse cx="126" cy="368" rx="16" ry="8" className="slipper" />
                <ellipse cx="186" cy="370" rx="16" ry="8" className="slipper" />
                <path d="M112 286c-16 24-8 48 12 54" className="arm" />
                <g className="press-arm">
                  <path d="M186 286c22 18 34 36 30 58" className="arm" />
                  <circle cx="214" cy="348" r="8" className="skin" />
                </g>
              </g>
            </g>

            <g className="youth">
              <path d="M128 300l-8 96" className="jeans" />
              <path d="M168 300l14 96" className="jeans" />
              <path d="M112 404h28l4-12h-24z" className="sneaker" />
              <path d="M168 404h32l6-12h-28z" className="sneaker" />
              <path d="M118 214c4 36 18 78 40 92 22-8 40-48 44-92 4-16-20-28-42-28s-46 12-42 28z" className="tee" />
              <circle cx="160" cy="168" r="30" className="skin" />
              <path d="M132 162c4-32 54-36 62-2-6-18-48-22-62 2z" className="hair-dark" />
              <path d="M136 150c12-16 36-16 48 0" className="hair-dark" />
              <path d="M142 166h10M168 164h12" className="brow" />
              <circle cx="148" cy="174" r="2.4" className="eye" />
              <circle cx="174" cy="174" r="2.4" className="eye" />
              <path d="M148 188c8 10 18 10 26 0" className="mouth-wide" />
              <path d="M124 230 L86 150" className="arm-youth" />
              <circle cx="82" cy="146" r="8" className="skin" />
              <path d="M196 228 L236 148" className="arm-youth" />
              <circle cx="240" cy="144" r="8" className="skin" />
            </g>
            </svg>
          </div>
        </div>
      </div>
      <p className="character-name">{name ?? "Player"}</p>
      <p className="character-caption">{caption}</p>
    </aside>
  );
}
