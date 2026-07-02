import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f5f0", fontFamily: "system-ui, sans-serif",
      display: "flex", flexDirection: "column",
    }}>

      {/* Header */}
      <div style={{
        background: "#1a3a2a", padding: "0 32px",
        display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 64,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 32, filter: "sepia(1) saturate(10) hue-rotate(-30deg)" }}>🌿</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>
              <span style={{ color: "#F47B20" }}>FEEDING</span>
              <sup style={{ color: "#F47B20", fontSize: 10, verticalAlign: "super" }}>®</sup>
            </div>
            <div style={{ color: "#9FE1CB", fontWeight: 700, fontSize: 14, letterSpacing: "0.04em", lineHeight: 1.2 }}>
              SOUTH FLORIDA
            </div>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 1 }}>
              Intelligence Platform
            </div>
          </div>
        </div>
        <a
          href="https://feedingsouthflorida.org"
          target="_blank"
          rel="noreferrer"
          style={{ color: "#9FE1CB", fontSize: 15, textDecoration: "none", fontWeight: 500 }}
        >
          feedingsouthflorida.org ↗
        </a>
      </div>

      {/* Hero */}
      <div style={{
        background: "#1a3a2a", padding: "28px 32px 32px",
        textAlign: "center", flexShrink: 0,
      }}>
        <div style={{
          display: "inline-block", background: "rgba(255,255,255,0.1)",
          color: "#9FE1CB", fontSize: 11, padding: "3px 14px",
          borderRadius: 20, marginBottom: 12, letterSpacing: "0.06em",
        }}>
          DATA-DRIVEN FOOD ACCESS TOOLS
        </div>
        <h1 style={{
          color: "#fff", fontSize: 28, fontWeight: 600,
          margin: "0 0 10px", lineHeight: 1.3,
        }}>
          Food access intelligence<br />for South Florida
        </h1>
        <p style={{
          color: "rgba(255,255,255,0.65)", fontSize: 14,
          maxWidth: 500, margin: "0 auto 24px", lineHeight: 1.6,
        }}>
          Identify where healthy food, education, and catering resources
          can drive the greatest community impact across three counties.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 48 }}>
          {[
            ["800K+", "meals per year"],
            ["3", "counties covered"],
            ["3", "intelligence tools"],
          ].map(([num, label]) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 600, color: "#5DCAA5" }}>{num}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2, letterSpacing: "0.04em" }}>
                {label.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flexDirection: "column", padding: "20px 24px 24px" }}>

        <div style={{
          fontSize: 11, fontWeight: 600, color: "#888",
          letterSpacing: "0.08em", marginBottom: 14,
        }}>
          PLATFORM TOOLS
        </div>

        {/* Tiles grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>

          {/* Tile 1 — Catering Menu Intelligence */}
          <div style={{
            background: "#fff", borderRadius: 12,
            border: "1px solid #e8e8e8", padding: "28px 24px",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: "#E6F1FB", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: 22, marginBottom: 16, flexShrink: 0,
            }}>🍽️</div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px", color: "#1a1a1a" }}>
              Catering Menu Intelligence
            </h2>
            <p style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.6, margin: 0 }}>
              Cut menu fatigue, save time, and buy smarter.
              Happier clients, higher margins, efficient operations.
            </p>
          </div>

          {/* Tile 2 — Health Equity Intelligence (clickable) */}
          <div
            onClick={() => navigate("/map")}
            style={{
              background: "#fff", borderRadius: 12,
              border: "2px solid #1D9E75", padding: "28px 24px",
              cursor: "pointer", transition: "box-shadow 0.15s",
              display: "flex", flexDirection: "column",
              boxSizing: "border-box",
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 20px rgba(29,158,117,0.15)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: "#E1F5EE", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: 22, marginBottom: 16, flexShrink: 0,
            }}>🗺️</div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px", color: "#1a1a1a" }}>
              Health Equity Intelligence
            </h2>
            <p style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.6, margin: 0 }}>
              Use data and AI to identify where healthy food and education
              can drive the greatest community impact.
            </p>
          </div>

          {/* Tile 3 — Dynamic Pricing Engine */}
          <div style={{
            background: "#fff", borderRadius: 12,
            border: "1px solid #e8e8e8", padding: "28px 24px",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: "#FAEEDA", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: 22, marginBottom: 16, flexShrink: 0,
            }}>💰</div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px", color: "#1a1a1a" }}>
              Dynamic Pricing Engine
            </h2>
            <p style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.6, margin: 0 }}>
              Drive growth, capture competitive prices on SKUs, apply configurable
              pricing rules and integrate automated workflows.
            </p>
          </div>

        </div>

        {/* Mission strip — centered */}
        <div style={{
          marginTop: 16, background: "#fff",
          borderRadius: 12, border: "1px solid #e8e8e8",
          padding: "14px 20px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>❤️</span>
          <p style={{ fontSize: 12, color: "#1a1a1a", margin: 0, lineHeight: 1.6 }}>
            <strong>Our mission:</strong> End hunger in South Florida by providing
            immediate access to nutritious food, leading hunger and poverty advocacy
            efforts, and transforming lives through innovative programming and education.
          </p>
        </div>

      </div>
    </div>
  );
}
