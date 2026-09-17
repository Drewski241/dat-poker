import type { YourTurnCue } from "../../your-turn-cue.js";

export function YourTurnCueArt({ cue }: { cue: YourTurnCue }) {
  switch (cue) {
    case "sloth":
      return <SlothArt />;
    case "leprechaun":
      return <LeprechaunArt />;
    case "hunter":
      return <HunterArt />;
    case "hero":
      return <HeroArt />;
    case "paddle":
      return <PaddleArt />;
    case "floor":
      return <FloorArt />;
    case "chips":
      return <ChipsArt />;
    case "terrier":
      return <TerrierArt />;
    case "owl":
      return <OwlArt />;
  }
}

function SlothArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 220 300" aria-hidden="true">
      <ellipse cx="168" cy="292" rx="36" ry="7" fill="rgba(0,0,0,0.28)" />
      <path d="M196 0 V268" stroke="#4a2e18" strokeWidth="22" strokeLinecap="round" />
      <path d="M196 0 V268" stroke="#6b4423" strokeWidth="14" strokeLinecap="round" />
      <path d="M8 52 C70 28 140 36 196 48" fill="none" stroke="#5a3820" strokeWidth="16" strokeLinecap="round" />
      <path d="M8 52 C70 28 140 36 196 48" fill="none" stroke="#8a5a32" strokeWidth="8" strokeLinecap="round" />
      <g className="your-turn-sloth-body">
        <ellipse cx="116" cy="168" rx="52" ry="68" fill="#8b5e3c" />
        <circle cx="116" cy="108" r="38" fill="#8b5e3c" />
        <ellipse cx="116" cy="116" rx="30" ry="26" fill="#e8d5b7" />
        <circle cx="100" cy="113" r="4.2" fill="#1a1208" />
        <circle cx="132" cy="113" r="4.2" fill="#1a1208" />
        <g className="your-turn-sloth-lids">
          <ellipse cx="100" cy="108" rx="11" ry="3.5" fill="#8b5e3c" />
          <ellipse cx="132" cy="108" rx="11" ry="3.5" fill="#8b5e3c" />
        </g>
      </g>
    </svg>
  );
}

function LeprechaunArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 200 220" aria-hidden="true">
      <rect x="0" y="160" width="200" height="60" fill="#2d5a3d" opacity="0.35" />
      <circle cx="100" cy="88" r="42" fill="#f1c27d" stroke="#fff" strokeWidth="2" />
      <path d="M62 72 Q100 38 138 72 L130 88 Q100 62 70 88 Z" fill="#27ae60" />
      <rect x="78" y="78" width="44" height="8" rx="2" fill="#1a1a1a" />
      <circle cx="88" cy="92" r="4" fill="#1a1a1a" />
      <circle cx="112" cy="92" r="4" fill="#1a1a1a" />
      <path d="M70 128 H130 L124 200 H76 Z" fill="#27ae60" stroke="#1e8449" strokeWidth="2" />
      <ellipse cx="148" cy="150" rx="22" ry="18" fill="#ffd24a" stroke="#c9a227" strokeWidth="2" />
      <text x="148" y="155" textAnchor="middle" fontSize="14" fontWeight="800" fill="#6b4f12">
        $
      </text>
    </svg>
  );
}

function HunterArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 200 220" aria-hidden="true">
      <circle cx="130" cy="100" r="38" fill="#3d4a2e" stroke="#fff" strokeWidth="2" />
      <circle cx="130" cy="100" r="28" fill="#87ceeb" opacity="0.5" />
      <circle cx="130" cy="100" r="8" fill="#c41e3a" />
      <rect x="40" y="72" width="70" height="56" rx="8" fill="#6b8f3a" />
      <text x="75" y="108" textAnchor="middle" fontSize="11" fontWeight="800" fill="#f4efe3">
        YOU
      </text>
      <circle cx="155" cy="78" r="22" fill="#f1c27d" />
      <rect x="138" y="68" width="34" height="10" fill="#5c3d1e" rx="2" />
    </svg>
  );
}

function HeroArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 200 200" aria-hidden="true">
      <ellipse cx="100" cy="178" rx="40" ry="8" fill="rgba(0,0,0,0.25)" />
      <path d="M118 40 C150 60 170 100 160 140 C130 120 90 110 70 90 C80 60 96 44 118 40 Z" fill="#e74c3c" />
      <ellipse cx="98" cy="88" rx="26" ry="32" fill="#3498db" stroke="#fff" strokeWidth="2" />
      <circle cx="98" cy="58" r="20" fill="#f1c27d" />
      <path d="M124 78 L168 62 L172 72 L128 96 Z" fill="#f1c27d" />
    </svg>
  );
}

function PaddleArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 200 220" aria-hidden="true">
      <path
        d="M140 200 C120 160 110 120 108 80"
        fill="none"
        stroke="#f1c27d"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <rect x="88" y="40" width="52" height="36" rx="6" fill="#c41e3a" stroke="#fff" strokeWidth="2" />
      <text x="114" y="64" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">
        ACT
      </text>
    </svg>
  );
}

function FloorArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 200 240" aria-hidden="true">
      <rect x="48" y="100" width="64" height="100" rx="6" fill="#2c3e50" />
      <rect x="56" y="108" width="48" height="36" fill="#ecf0f1" />
      <circle cx="80" cy="72" r="26" fill="#f1c27d" />
      <path d="M54 64 Q80 48 106 64" fill="#34495e" />
      <path d="M120 140 L150 120" stroke="#f1c27d" strokeWidth="8" strokeLinecap="round" />
      <path d="M148 118 L158 108 M148 122 L160 122" stroke="#f1c27d" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function ChipsArt() {
  return (
    <svg className="your-turn-cue-svg your-turn-cue-svg--chips" viewBox="0 0 160 200" aria-hidden="true">
      <g className="your-turn-chips-stack">
        <ellipse cx="80" cy="160" rx="48" ry="12" fill="#c9a227" stroke="#6b4f12" strokeWidth="2" />
        <ellipse cx="80" cy="140" rx="48" ry="12" fill="#ffd24a" stroke="#6b4f12" strokeWidth="2" />
        <ellipse cx="80" cy="120" rx="48" ry="12" fill="#c9a227" stroke="#6b4f12" strokeWidth="2" />
        <ellipse cx="80" cy="100" rx="48" ry="12" fill="#ffd24a" stroke="#6b4f12" strokeWidth="2" />
        <ellipse cx="80" cy="80" rx="48" ry="12" fill="#c41e3a" stroke="#6b4f12" strokeWidth="2" />
      </g>
    </svg>
  );
}

function TerrierArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 200 200" aria-hidden="true">
      <g className="your-turn-terrier-zap">
        <path d="M20 100 H180" stroke="#f4d03f" strokeWidth="4" strokeDasharray="8 10" opacity="0.7" />
      </g>
      <ellipse cx="100" cy="130" rx="44" ry="36" fill="#d4a574" stroke="#fff" strokeWidth="2" />
      <circle cx="100" cy="88" r="32" fill="#d4a574" />
      <ellipse cx="72" cy="78" rx="14" ry="22" fill="#c4956a" />
      <ellipse cx="128" cy="78" rx="14" ry="22" fill="#c4956a" />
      <rect x="72" y="52" width="56" height="14" rx="4" fill="#fff" stroke="#3498db" strokeWidth="2" />
      <text x="100" y="63" textAnchor="middle" fontSize="9" fontWeight="800" fill="#3498db">
        DEALER
      </text>
      <circle cx="88" cy="90" r="5" fill="#1a1a1a" />
      <circle cx="112" cy="90" r="5" fill="#1a1a1a" />
      <path d="M92 102 Q100 112 108 102" fill="none" stroke="#1a1a1a" strokeWidth="2" />
    </svg>
  );
}

function OwlArt() {
  return (
    <svg className="your-turn-cue-svg" viewBox="0 0 200 220" aria-hidden="true">
      <ellipse cx="100" cy="120" rx="56" ry="64" fill="#5d4e37" stroke="#fff" strokeWidth="2" />
      <circle cx="78" cy="108" r="22" fill="#f4efe3" stroke="#2c2c2c" strokeWidth="2" />
      <circle cx="122" cy="108" r="22" fill="#f4efe3" stroke="#2c2c2c" strokeWidth="2" />
      <circle cx="78" cy="108" r="8" fill="#1a1a1a" />
      <circle cx="122" cy="108" r="8" fill="#1a1a1a" />
      <path d="M100 118 L92 132 L108 132 Z" fill="#e67e22" />
      <path d="M40 100 Q100 60 160 100" fill="none" stroke="#5d4e37" strokeWidth="14" />
    </svg>
  );
}
