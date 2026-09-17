export const YOUR_TURN_COPY = "It's your turn! No Rush!";

export function YourTurnSloth() {
  return (
    <aside className="your-turn-sloth" role="status" aria-live="assertive">
      <div className="your-turn-sloth-art">
        <SlothSvg />
        <p className="your-turn-sign">
          <strong>It&apos;s your turn!</strong>
          <span>No Rush!</span>
        </p>
      </div>
    </aside>
  );
}

function SlothSvg() {
  return (
    <svg className="your-turn-sloth-svg" viewBox="0 0 220 300" aria-hidden="true">
      <ellipse cx="168" cy="292" rx="36" ry="7" fill="rgba(0,0,0,0.28)" />
      <path d="M196 0 V268" stroke="#4a2e18" strokeWidth="22" strokeLinecap="round" />
      <path d="M196 0 V268" stroke="#6b4423" strokeWidth="14" strokeLinecap="round" />
      <path
        d="M8 52 C70 28 140 36 196 48"
        fill="none"
        stroke="#5a3820"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <path
        d="M8 52 C70 28 140 36 196 48"
        fill="none"
        stroke="#8a5a32"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <ellipse cx="42" cy="40" rx="16" ry="8" fill="#2f7a3c" transform="rotate(-18 42 40)" />
      <ellipse cx="78" cy="32" rx="14" ry="7" fill="#3d8c4a" transform="rotate(12 78 32)" />
      <ellipse cx="128" cy="34" rx="18" ry="8" fill="#2f7a3c" transform="rotate(-8 128 34)" />
      <g className="your-turn-sloth-body">
        <path
          d="M86 58 C70 62 58 78 62 96 L70 102 C76 78 96 70 112 72 L118 62 Z"
          fill="#6e452c"
        />
        <path
          d="M128 56 C148 60 168 78 162 98 L152 104 C156 80 140 66 122 64 Z"
          fill="#6e452c"
        />
        <path d="M78 54 L58 48 L52 56 L76 66 Z" fill="#c9b18a" />
        <path d="M148 52 L176 44 L180 52 L150 64 Z" fill="#c9b18a" />
        <path d="M54 48 L48 42" stroke="#2a1f16" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M58 46 L50 38" stroke="#2a1f16" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M62 47 L56 38" stroke="#2a1f16" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M176 44 L184 36" stroke="#2a1f16" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M180 46 L190 38" stroke="#2a1f16" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M172 43 L180 34" stroke="#2a1f16" strokeWidth="2.4" strokeLinecap="round" />
        <ellipse cx="116" cy="168" rx="52" ry="68" fill="#8b5e3c" />
        <ellipse cx="118" cy="176" rx="34" ry="46" fill="#c4a07a" />
        <circle cx="116" cy="108" r="38" fill="#8b5e3c" />
        <ellipse cx="116" cy="116" rx="30" ry="26" fill="#e8d5b7" />
        <ellipse cx="100" cy="112" rx="12" ry="10" fill="#5c3d2e" />
        <ellipse cx="132" cy="112" rx="12" ry="10" fill="#5c3d2e" />
        <circle cx="100" cy="113" r="4.2" fill="#1a1208" />
        <circle cx="132" cy="113" r="4.2" fill="#1a1208" />
        <circle cx="98.6" cy="111.6" r="1.3" fill="#f4efe3" />
        <circle cx="130.6" cy="111.6" r="1.3" fill="#f4efe3" />
        <g className="your-turn-sloth-lids">
          <ellipse cx="100" cy="108" rx="11" ry="3.5" fill="#8b5e3c" />
          <ellipse cx="132" cy="108" rx="11" ry="3.5" fill="#8b5e3c" />
        </g>
        <ellipse cx="116" cy="124" rx="5" ry="3.4" fill="#3d2b1f" />
        <path
          d="M106 134 Q116 142 126 134"
          fill="none"
          stroke="#3d2b1f"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M92 228 C86 258 78 276 70 282"
          fill="none"
          stroke="#8b5e3c"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d="M140 228 C148 258 158 276 168 280"
          fill="none"
          stroke="#8b5e3c"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path d="M64 280 L58 288" stroke="#2a1f16" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M70 282 L68 292" stroke="#2a1f16" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M76 280 L82 288" stroke="#2a1f16" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M162 278 L156 288" stroke="#2a1f16" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M168 280 L170 290" stroke="#2a1f16" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M174 278 L182 286" stroke="#2a1f16" strokeWidth="2.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}
