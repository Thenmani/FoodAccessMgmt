import { useEffect, useRef, useState, useCallback } from "react";

const API = "http://127.0.0.1:8000";
const COUNTIES = ["Miami-Dade", "Broward", "Palm Beach"];
const COUNTY_COLORS = {
  "Miami-Dade": { line: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D" },
  "Broward":    { line: "#185FA5", bg: "#E6F1FB", text: "#0C447C" },
  "Palm Beach": { line: "#D4A017", bg: "#FEFBD8", text: "#7A5C00" },
};
const METRICS = [
  { key: "impact_score",         label: "Impact score" },
  { key: "total_meals",       label: "Total meals served"   },
  { key: "total_individuals", label: "Individuals served"   },
  { key: "total_households",  label: "Households served"    },
];

function normalizeCounty(name) {
  if (!name) return "";
  const n = name.toLowerCase().trim();
  if (n.includes("miami") || n.includes("dade")) return "Miami-Dade";
  if (n.includes("broward"))                      return "Broward";
  if (n.includes("palm"))                         return "Palm Beach";
  if (n.includes("monroe"))                       return "Monroe";
  return "";
}

function fmtVal(v, metric) {
  if (v === null || v === undefined) return "";
  if (metric === "impact_score") return Number(v).toFixed(1);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + "K";
  return v.toLocaleString();
}

export default function TrendChart({ onClose }) {
  const chartRef  = useRef(null);
  const chartInst = useRef(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [metric,    setMetric]    = useState("impact_score");
  const [trendData, setTrendData] = useState(null);
  const [chartjsReady, setChartjsReady] = useState(!!window.Chart);

  // ── Load Chart.js ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.Chart) { setChartjsReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
    s.onload = () => setChartjsReady(true);
    document.head.appendChild(s);
  }, []);

  // ── Fetch trend data ───────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res   = await fetch(`${API}/api/fsf/available-years`);
        const years = await res.json();
        if (!years || years.length < 2) {
          setError(`Upload data for at least 2 years to see the trend chart. You have ${years?.length || 0} year(s) uploaded.`);
          setLoading(false);
          return;
        }

        const yearlyData = {};
        for (const { year } of years) {
          try {
            const r    = await fetch(`${API}/api/fsf/distributions?dist_year=${year}`);
            const data = await r.json();
            yearlyData[year] = data;
          } catch { yearlyData[year] = []; }
        }

        // Aggregate by county per year
        const trend = {};
        COUNTIES.forEach(c => { trend[c] = {}; });

        for (const [year, records] of Object.entries(yearlyData)) {
          const agg = {};
          COUNTIES.forEach(c => { agg[c] = { acc_sum:0, count:0, meals:0, individuals:0, households:0 }; });

          // ZIP population lookup (same as backend)
          const ZIP_POP = {
            "33054":28000,"33055":32000,"33056":34000,"33127":19000,"33128":15000,
            "33130":21000,"33132":14000,"33135":24000,"33136":18000,"33142":27000,
            "33147":31000,"33150":22000,"33161":29000,"33162":31000,"33169":38000,
            "33125":22000,"33126":31000,"33133":18000,"33134":20000,"33138":19000,
            "33149":12000,"33155":29000,"33165":33000,"33166":28000,"33174":26000,
            "33175":35000,"33177":38000,"33178":41000,"33179":32000,"33180":28000,
            "33311":35000,"33312":42000,"33313":39000,"33314":28000,"33315":18000,
            "33316":12000,"33317":44000,"33319":37000,"33322":46000,"33324":41000,
            "33325":38000,"33328":43000,"33060":38000,"33062":29000,"33063":44000,
            "33064":36000,"33065":42000,"33068":38000,"33069":31000,"33071":40000,
            "33073":35000,"33076":28000,"33309":32000,"33334":29000,"33351":36000,
            "33388":18000,"33441":31000,"33442":28000,"33444":22000,"33445":24000,
            "33409":28000,"33430":18000,"33435":24000,"33460":21000,"33461":32000,
            "33462":27000,"33463":35000,"33467":41000,"33472":29000,"33484":31000,
            "33401":28000,"33403":18000,"33404":22000,"33405":19000,"33406":31000,
            "33407":24000,"33408":21000,"33410":38000,"33411":42000,"33412":19000,
            "33413":36000,"33414":31000,"33415":38000,"33417":29000,"33418":44000,
            "33426":24000,"33428":31000,"33431":28000,"33432":32000,"33433":36000,
            "33040":24000,"33050":11000,"33001":8000,"33036":9000,"33037":14000,
            "33042":7000,"33043":6000,"33044":5000,"33045":4000,"33051":6000,
          };
          const DEFAULT_POP = 25000;

          records.forEach(r => {
            const key = normalizeCounty(r.county);
            if (!key || !agg[key]) return;
            agg[key].meals       += r.meals_served        || 0;
            agg[key].individuals += r.individuals_served  || 0;
            agg[key].households  += r.households_served   || 0;
            agg[key].count       += 1;
            // Store ZIP for pop lookup
            const pop = ZIP_POP[String(r.zip_code).padStart(5,"0")] || DEFAULT_POP;
            agg[key].pop_total   = (agg[key].pop_total || 0) + pop;
          });

          COUNTIES.forEach(c => {
            const a = agg[c];
            if (!a.count) {
              trend[c][year] = { impact_score:0, total_meals:0, total_individuals:0, total_households:0 };
              return;
            }
            // Recalculate score from aggregated totals — same formula as backend
            const avgPop    = (a.pop_total || DEFAULT_POP * a.count) / a.count;
            const avgInd    = a.individuals / a.count;
            const avgMeals  = a.meals / a.count;
            const popPct    = Math.min((avgInd / avgPop) / 0.05, 1.0) * 60;
            const mealsSc   = Math.min((avgMeals / Math.max(avgInd, 1)) / 5.0, 1.0) * 40;
            const impact_score = Math.round((popPct + mealsSc) * 10) / 10;
            trend[c][year] = {
              impact_score,
              total_meals:       a.meals,
              total_individuals: a.individuals,
              total_households:  a.households,
            };
          });
        }

        const sortedYears = years.map(y => y.year).sort();
        setTrendData({ trend, years: sortedYears });
      } catch (e) {
        setError("Could not load trend data. Is the backend running?");
      }
      setLoading(false);
    };
    load();
  }, []);

  // ── Draw chart ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!trendData || !chartRef.current || loading || !chartjsReady) return;
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }

    const { trend, years } = trendData;
    const isDark     = matchMedia("(prefers-color-scheme: dark)").matches;
    const gridColor  = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
    const labelColor = isDark ? "#aaa" : "#777";

    const datasets = COUNTIES.map(county => ({
      label:               county,
      data:                years.map(y => trend[county][y]?.[metric] ?? null),
      borderColor:         COUNTY_COLORS[county].line,
      backgroundColor:     COUNTY_COLORS[county].line + "18",
      borderWidth:         2.5,
      pointRadius:         5,
      pointHoverRadius:    7,
      pointBackgroundColor: COUNTY_COLORS[county].line,
      pointBorderColor:    "#fff",
      pointBorderWidth:    1.5,
      tension:             0.35,
      fill:                false,
      spanGaps:            true,
    }));

    chartInst.current = new window.Chart(chartRef.current, {
      type: "line",
      data: { labels: years.map(String), datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction:         { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? "#222" : "#fff",
            borderColor:     isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
            borderWidth:     1,
            titleColor:      isDark ? "#eee" : "#333",
            bodyColor:       isDark ? "#ccc" : "#555",
            padding:         12,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmtVal(ctx.parsed.y, metric)}`,
            },
          },
        },
        scales: {
          x: {
            grid:  { color: gridColor },
            ticks: { color: labelColor, font: { size: 12 }, autoSkip: false },
          },
          y: {
            grid:  { color: gridColor },
            ticks: { color: labelColor, font: { size: 12 }, callback: v => fmtVal(v, metric) },
            min: metric === "impact_score" ? 0 : undefined,
            max: metric === "impact_score" ? 100 : undefined,
          },
        },
      },
    });
  }, [trendData, metric, loading, chartjsReady]);

  useEffect(() => () => { if (chartInst.current) chartInst.current.destroy(); }, []);

  // ── Summary cards ──────────────────────────────────────────────────────────
  const summaryCards = trendData ? (() => {
    const { trend, years } = trendData;
    const last  = years[years.length - 1];
    const first = years[0];
    let meals=0, individuals=0, avgScore=0, cnt=0;
    COUNTIES.forEach(c => {
      const d = trend[c][last];
      if (!d) return;
      meals       += d.total_meals;
      individuals += d.total_individuals;
      avgScore    += d.impact_score;
      cnt++;
    });
    avgScore = cnt > 0 ? (avgScore / cnt).toFixed(1) : 0;

    let firstMeals = 0;
    COUNTIES.forEach(c => { firstMeals += trend[c][first]?.total_meals || 0; });
    const growth = firstMeals > 0 ? "+" + (((meals - firstMeals) / firstMeals) * 100).toFixed(0) + "%" : "—";

    return [
      { label: `Total meals (${last})`,        value: meals >= 1e6 ? (meals/1e6).toFixed(2)+"M" : Math.round(meals/1000)+"K" },
      { label: `Individuals served (${last})`,  value: individuals >= 1e6 ? (individuals/1e6).toFixed(2)+"M" : Math.round(individuals/1000)+"K" },
      { label: "Avg impact score",      value: avgScore + " / 100" },
      { label: `Meal growth (${first}→${last})`,value: growth },
    ];
  })() : [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(10,20,15,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "#ffffff",
        borderRadius: 16, border: "1px solid #e0e0e0",
        width: "100%", maxWidth: 880, padding: "28px 32px",
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>
              FSF impact score trend
            </h2>
            <p style={{ fontSize: 13, color: "#666", margin: 0 }}>
              Year-over-year community impact progress by county
            </p>
          </div>
          <button onClick={onClose} style={{
            border: "none", background: "none", fontSize: 22,
            cursor: "pointer", color: "#666", lineHeight: 1,
          }}>×</button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#666", fontSize: 14 }}>
            Loading trend data...
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{
            background: "#FFF3CD", color: "#856404",
            padding: "14px 16px", borderRadius: 8, fontSize: 13, textAlign: "center",
          }}>{error}</div>
        )}

        {/* Content */}
        {!loading && !error && trendData && (
          <>
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginBottom: 20 }}>
              {summaryCards.map(({ label, value }) => (
                <div key={label} style={{
                  background: "#f5f5f5",
                  borderRadius: 8, padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 500, color: "#1a1a1a" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Metric toggles */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {METRICS.map(m => (
                <button key={m.key} onClick={() => setMetric(m.key)} style={{
                  padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                  border: "0.5px solid",
                  borderColor: metric === m.key ? "#185FA5" : "var(--color-border-secondary)",
                  background:  metric === m.key ? "#E6F1FB"  : "transparent",
                  color:       metric === m.key ? "#0C447C"  : "var(--color-text-secondary)",
                  fontWeight:  metric === m.key ? 500 : 400,
                }}>{m.label}</button>
              ))}
            </div>

            {/* County legend */}
            <div style={{ display: "flex", gap: 20, marginBottom: 14, flexWrap: "wrap" }}>
              {COUNTIES.map(c => (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 28, height: 3, background: COUNTY_COLORS[c].line, borderRadius: 2 }} />
                  <span style={{ fontSize: 12, color: "#666" }}>{c}</span>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div style={{ position: "relative", height: 300, marginBottom: 20, background: "#fff", borderRadius: 8, padding: "8px 4px" }}>
              <canvas ref={chartRef}
                role="img"
                aria-label="Line chart showing FSF impact score trend by county">
                FSF food distribution trend by county.
              </canvas>
            </div>

            {/* Per-county cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
              {COUNTIES.map(county => {
                const { trend, years } = trendData;
                const last  = years[years.length - 1];
                const first = years[0];
                const ld = trend[county][last];
                const fd = trend[county][first];
                const change = ld && fd ? (ld.impact_score - fd.impact_score).toFixed(1) : null;
                const col = COUNTY_COLORS[county];
                return (
                  <div key={county} style={{
                    background: col.bg, borderRadius: 8, padding: "12px 14px",
                    border: `0.5px solid ${col.line}44`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: col.text, marginBottom: 6 }}>{county}</div>
                    <div style={{ fontSize: 22, fontWeight: 500, color: col.text }}>
                      {ld ? ld.impact_score.toFixed(1) : "—"}
                    </div>
                    <div style={{ fontSize: 11, color: col.text + "99", marginTop: 2 }}>
                      score in {last}
                    </div>
                    {change !== null && (
                      <div style={{
                        fontSize: 11, marginTop: 6, fontWeight: 500,
                        color: parseFloat(change) >= 0 ? "#3B6D11" : "#A32D2D",
                      }}>
                        {parseFloat(change) >= 0 ? "▲" : "▼"} {Math.abs(change)} since {first}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
