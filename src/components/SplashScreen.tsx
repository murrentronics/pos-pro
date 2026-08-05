import { useEffect, useState } from "react";

// P.O.S. Pro logo — futuristic digital blue "P" on dark circuit background
function LogoMark({ size = 160 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="sp-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00d4ff" />
          <stop offset="100%" stopColor="#0047ab" />
        </linearGradient>
        <linearGradient id="sp-grad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00b4ff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0047ab" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id="sp-bg" cx="40%" cy="35%">
          <stop offset="0%" stopColor="#061c36" />
          <stop offset="100%" stopColor="#020810" />
        </radialGradient>
        <radialGradient id="sp-glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#00b4ff" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00b4ff" stopOpacity="0" />
        </radialGradient>
        <filter id="sp-blur">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Background circle */}
      <circle cx="256" cy="256" r="256" fill="url(#sp-bg)" />

      {/* Outer glow ring */}
      <circle cx="256" cy="256" r="240" fill="none" stroke="url(#sp-grad)" strokeWidth="2" opacity="0.35" />
      <circle cx="256" cy="256" r="228" fill="none" stroke="#00b4ff" strokeWidth="0.5" opacity="0.15" />

      {/* Circuit trace lines — horizontal */}
      <line x1="56" y1="200" x2="140" y2="200" stroke="#00b4ff" strokeWidth="1.5" opacity="0.18" />
      <line x1="56" y1="200" x2="56" y2="260" stroke="#00b4ff" strokeWidth="1.5" opacity="0.18" />
      <circle cx="56" cy="260" r="3" fill="#00b4ff" opacity="0.3" />
      <line x1="372" y1="312" x2="456" y2="312" stroke="#00b4ff" strokeWidth="1.5" opacity="0.18" />
      <line x1="456" y1="312" x2="456" y2="252" stroke="#00b4ff" strokeWidth="1.5" opacity="0.18" />
      <circle cx="456" cy="252" r="3" fill="#00b4ff" opacity="0.3" />
      <line x1="120" y1="380" x2="120" y2="430" stroke="#00b4ff" strokeWidth="1.5" opacity="0.12" />
      <circle cx="120" cy="430" r="3" fill="#00b4ff" opacity="0.2" />
      <line x1="392" y1="130" x2="392" y2="80" stroke="#00b4ff" strokeWidth="1.5" opacity="0.12" />
      <circle cx="392" cy="80" r="3" fill="#00b4ff" opacity="0.2" />

      {/* Inner glow behind P */}
      <circle cx="256" cy="230" r="130" fill="url(#sp-glow)" filter="url(#sp-blur)" />

      {/* The P letterform — bold, geometric, with open bowl */}
      {/* Vertical stem */}
      <rect x="148" y="110" width="52" height="292" rx="8" fill="url(#sp-grad)" />
      {/* Bowl top horizontal */}
      <rect x="148" y="110" width="158" height="52" rx="10" fill="url(#sp-grad)" />
      {/* Bowl bottom horizontal */}
      <rect x="148" y="228" width="148" height="48" rx="10" fill="url(#sp-grad)" />
      {/* Bowl right vertical */}
      <rect x="258" y="110" width="52" height="166" rx="10" fill="url(#sp-grad)" />

      {/* PRO badge pill */}
      <rect x="182" y="430" width="148" height="44" rx="14" fill="url(#sp-grad)" />
      <text
        x="256" y="460"
        fontFamily="Arial, sans-serif"
        fontSize="22"
        fontWeight="900"
        textAnchor="middle"
        fill="#000d1a"
        letterSpacing="4"
      >PRO</text>

      {/* Scan-line shimmer overlay */}
      <rect x="0" y="0" width="512" height="512" fill="url(#sp-grad2)" rx="256" opacity="0.08" />
    </svg>
  );
}

// Arched "Welcome to" text drawn on an SVG arc
function ArchedText({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 320 120"
      width="320"
      height="120"
      style={{
        position: "absolute",
        top: "-60px",
        left: "50%",
        transform: "translateX(-50%)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.6s ease",
        pointerEvents: "none",
      }}
    >
      <defs>
        <path id="arc" d="M 20,100 A 140,140 0 0,1 300,100" />
      </defs>
      <text
        fontFamily="Georgia, serif"
        fontSize="22"
        fontWeight="700"
        fill="#00b4ff"
        letterSpacing="3"
      >
        <textPath href="#arc" startOffset="50%" textAnchor="middle">
          Welcome to
        </textPath>
      </text>
    </svg>
  );
}

interface SplashScreenProps {
  onDone: () => void;
  businessName?: string;
}

export function SplashScreen({ onDone, businessName }: SplashScreenProps) {
  // Animation phases:
  // 0 → logo rolls in (0–0.8s)
  // 1 → "Welcome to" arched text fades in (0.8–1.4s)
  // 2 → "P.O.S. Pro" text slides up (1.4–2.0s)
  // 3 → loading bar fills 0→100% (2.0–4.5s)
  // 4 → fade out (4.5–5.0s)
  // done → unmount

  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 800);
    const t2 = setTimeout(() => setPhase(2), 1400);
    const t3 = setTimeout(() => setPhase(3), 2000);
    // Animate progress bar from 0 to 100 over 2500ms
    const t4 = setTimeout(() => {
      const start = Date.now();
      const duration = 2500;
      const tick = () => {
        const elapsed = Date.now() - start;
        const pct = Math.min(100, Math.round((elapsed / duration) * 100));
        setProgress(pct);
        if (pct < 100) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, 2000);
    const t5 = setTimeout(() => setFadeOut(true), 4500);
    const t6 = setTimeout(() => onDone(), 4800); // unmount faster after fade starts

    return () => { [t1, t2, t3, t4, t5, t6].forEach(clearTimeout); };
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        opacity: fadeOut ? 0 : 1,
        transition: "opacity 0.5s ease",
        pointerEvents: fadeOut ? "none" : "all",
        // Safe area padding for notch devices
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Logo + arched text container */}
      <div style={{ position: "relative", marginBottom: "24px" }}>
        {/* Arched "Welcome to" */}
        <ArchedText visible={phase >= 1} />

        {/* Logo — rolls in from below with scale */}
        <div
          style={{
            transform: phase >= 0 ? "translateY(0) scale(1)" : "translateY(80px) scale(0.5)",
            opacity: phase >= 0 ? 1 : 0,
            transition: "transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.6s ease",
            marginTop: "60px",
          }}
        >
          <LogoMark size={180} />
        </div>
      </div>

      {/* "P.O.S. Pro" text + optional business name subtitle */}
      <div
        style={{
          transform: phase >= 2 ? "translateY(0)" : "translateY(20px)",
          opacity: phase >= 2 ? 1 : 0,
          transition: "transform 0.6s cubic-bezier(0.34, 1.2, 0.64, 1), opacity 0.5s ease",
          textAlign: "center",
          marginBottom: "48px",
        }}
      >
        <div
          style={{
            fontFamily: "Georgia, serif",
            fontSize: "28px",
            fontWeight: "900",
            letterSpacing: "3px",
            background: "linear-gradient(135deg, #00b4ff 0%, #0047ab 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          P.O.S. Pro
        </div>
        {businessName && (
          <div
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: "12px",
              fontWeight: "600",
              letterSpacing: "1px",
              color: "#666",
              marginTop: "4px",
            }}
          >
            {businessName}
          </div>
        )}
      </div>

      {/* Loading bar */}
      <div
        style={{
          width: "220px",
          opacity: phase >= 3 ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      >
        {/* Track */}
        <div
          style={{
            width: "100%",
            height: "3px",
            background: "#222",
            borderRadius: "2px",
            overflow: "hidden",
          }}
        >
          {/* Fill */}
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "linear-gradient(90deg, #00b4ff, #0047ab)",
              borderRadius: "2px",
              transition: "width 0.05s linear",
            }}
          />
        </div>
        {/* Percentage */}
        <div
          style={{
            textAlign: "center",
            marginTop: "8px",
            fontFamily: "Arial, sans-serif",
            fontSize: "11px",
            color: "#444",
            letterSpacing: "1px",
          }}
        >
          {progress}%
        </div>
      </div>
    </div>
  );
}
