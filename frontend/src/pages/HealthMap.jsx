import { useEffect, useRef, useState, useCallback } from "react";
import TrendChart from "./TrendChart";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const API = "http://127.0.0.1:8000";

const ACS_YEARS = [
  { value: 2024, label: "2020–2024 (Jan 2026) — Latest" },
  { value: 2023, label: "2019–2023 (Dec 2024)"          },
  { value: 2022, label: "2018–2022 (Dec 2023)"          },
  { value: 2021, label: "2017–2021 (Dec 2022)"          },
];

const NEED_LEGEND = [
  { color: "#2d1160", label: "Highest need", range: "90–100" },
  { color: "#440154", label: "Very high",    range: "75–90"  },
  { color: "#3b528b", label: "High",         range: "50–75"  },
  { color: "#21918c", label: "Moderate",     range: "25–50"  },
  { color: "#5ec962", label: "Low need",     range: "0–25"   },
];

const ACC_LEGEND = [
  { color: "#FFD700", label: "Excellent",  range: "65–100" },
  { color: "#185FA5", label: "Good",       range: "50–65"  },
  { color: "#5ec962", label: "Moderate",   range: "38–50"  },
  { color: "#F4C0D1", label: "Low",        range: "30–38"  },
  { color: "#7F77DD", label: "Minimal",    range: "0–30"   },
];

export default function HealthMap() {
  const mapContainer = useRef(null);
  const map          = useRef(null);
  const fullBounds   = useRef(null);
  const pollRef      = useRef(null);

  // ── Layer
  const [activeLayer,    setActiveLayer]    = useState("need");

  // ── ACS
  const [acsYear,        setAcsYear]        = useState(2024);
  const [acsStatus,      setAcsStatus]      = useState({});

  // ── FSF — available years loaded from backend
  const [fsfAvailYears,  setFsfAvailYears]  = useState([]);   // [{year, rows, filename}]
  const [fsfYear,        setFsfYear]        = useState(null); // null = no selection yet

  // ── Upload panel
  const [uploadOpen,     setUploadOpen]     = useState(false);
  const [showTrend,      setShowTrend]      = useState(false);
  const [activeTab,      setActiveTab]      = useState("upload");
  const [uploadYear,     setUploadYear]     = useState("");
  const [fsfFile,        setFsfFile]        = useState(null);
  const [fsfUploading,   setFsfUploading]   = useState(false);
  const [fsfMsg,         setFsfMsg]         = useState("");

  // ── History
  const [fsfHistory,     setFsfHistory]     = useState([]);
  const [selectedIds,    setSelectedIds]    = useState(new Set());
  const [deleting,       setDeleting]       = useState(false);

  // ── Tract click
  const [selected,       setSelected]       = useState(null);

  // ── Toast
  const [toast,          setToast]          = useState("");

  const showToast = (msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(""), duration);
  };

  // ── Fetch FSF available years ──────────────────────────────────────────────
  const fetchFsfAvailYears = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/fsf/available-years`);
      const data = await res.json();
      setFsfAvailYears(data);
    } catch { setFsfAvailYears([]); }
  }, []);

  // ── Fetch FSF upload history ───────────────────────────────────────────────
  const fetchFsfHistory = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/fsf/upload-history`);
      const data = await res.json();
      setFsfHistory(data);
    } catch { setFsfHistory([]); }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Fetch available years
      try {
        const res  = await fetch(`${API}/api/fsf/available-years`);
        const data = await res.json();
        setFsfAvailYears(data);
        // Auto-select latest year
        if (data && data.length > 0) {
          const latest = data.sort((a, b) => b.year - a.year)[0].year;
          setFsfYear(latest);
          setUploadYear(latest);
        }
      } catch { setFsfAvailYears([]); }
      // Fetch history
      try {
        const res  = await fetch(`${API}/api/fsf/upload-history`);
        const data = await res.json();
        setFsfHistory(data);
      } catch { setFsfHistory([]); }
    };
    init();
  }, []);

  // ── Load ACS tracts ────────────────────────────────────────────────────────
  const loadAcsData = useCallback(async (year) => {
    if (!map.current) return;
    const source = map.current.getSource("tracts");
    if (!source) return;
    try {
      const res = await fetch(`${API}/api/acs/tracts?acs_year=${year}`);
      if (!res.ok) return;
      const apiData = await res.json();
      const lookup = {};
      apiData.forEach(t => { lookup[t.tract_id] = t; });

      const geojson = await (await fetch("/tracts_2022.geojson")).json();
      geojson.features.forEach(f => {
        const m = lookup[f.properties.GEOID];
        if (m) {
          f.properties.need_score           = m.need_score;
          f.properties.median_income        = m.median_income;
          f.properties.total_pop            = m.population;
          f.properties.county_name          = m.county;
          f.properties.poverty_rate         = m.pct_below_poverty        ? +(m.pct_below_poverty    * 100).toFixed(1) : null;
          f.properties.snap_rate            = m.pct_snap_enrollment      ? +(m.pct_snap_enrollment  * 100).toFixed(1) : null;
          f.properties.no_vehicle_rate      = m.pct_no_vehicle           ? +(m.pct_no_vehicle       * 100).toFixed(1) : null;
          f.properties.food_desert          = m.food_desert;
          f.properties.supermarket_dist_mi  = m.supermarket_dist_mi;
          f.properties.unemployment_rate    = m.unemployment_rate        ? +(m.unemployment_rate    * 100).toFixed(1) : null;
          f.properties.housing_cost_burden  = m.housing_cost_burden_pct  ? +(m.housing_cost_burden_pct * 100).toFixed(1) : null;
        } else {
          f.properties.need_score = null;
        }
      });
      source.setData(geojson);
      map.current.setPaintProperty("tracts-fill", "fill-color", [
        "step", ["coalesce", ["get", "need_score"], -1],
        "#cccccc", 0, "#5ec962", 25, "#21918c", 50, "#3b528b", 75, "#440154", 90, "#2d1160",
      ]);
    } catch (e) { console.error("ACS load error", e); }
  }, []);

  // ── Load FSF data ──────────────────────────────────────────────────────────
  const loadFsfData = useCallback(async (year) => {
    if (!map.current || !year) return;
    const source = map.current.getSource("tracts");
    if (!source) return;
    try {
      const res = await fetch(`${API}/api/fsf/distributions?dist_year=${year}`);
      if (!res.ok) return;
      const apiData = await res.json();

      // Normalize county names for matching
      const normalizeCounty = (name) => {
        if (!name) return "";
        const n = name.toLowerCase().trim();
        if (n.includes("miami") || n.includes("dade"))   return "miami-dade";
        if (n.includes("broward"))                        return "broward";
        if (n.includes("palm"))                           return "palm beach";
        return "";
      };

      // Aggregate by county — sum totals, average impact_score
      const countyAgg = {};
      apiData.forEach(d => {
        const key = normalizeCounty(d.county);
        if (!key) return;
        if (!countyAgg[key]) {
          countyAgg[key] = {
            households_served:  0,
            individuals_served: 0,
            meals_served:       0,
            impact_score_sum:      0,
            count:              0,
            dist_year:          d.dist_year,
          };
        }
        countyAgg[key].households_served  += d.households_served  || 0;
        countyAgg[key].individuals_served += d.individuals_served || 0;
        countyAgg[key].meals_served       += d.meals_served       || 0;
        countyAgg[key].impact_score_sum      += d.impact_score || 0;
        countyAgg[key].count              += 1;
      });

      // Recalculate impact_score from aggregated totals (same formula as backend)
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

      // Also accumulate pop per ZIP for accurate avg
      const countyPop = {};
      apiData.forEach(d => {
        const key = normalizeCounty(d.county);
        if (!key) return;
        const pop = ZIP_POP[String(d.zip_code).padStart(5,"0")] || DEFAULT_POP;
        countyPop[key] = (countyPop[key] || 0) + pop;
      });

      Object.keys(countyAgg).forEach(k => {
        const c = countyAgg[k];
        const avgInd   = c.individuals_served / Math.max(c.count, 1);
        const avgMeals = c.meals_served       / Math.max(c.count, 1);
        const avgPop   = (countyPop[k] || DEFAULT_POP * c.count) / Math.max(c.count, 1);
        const popPct    = Math.min((avgInd / avgPop) / 0.05, 1.0) * 60;
        const mealsSc   = Math.min((avgMeals / Math.max(avgInd, 1)) / 5.0, 1.0) * 40;
        c.impact_score = Math.round((popPct + mealsSc) * 10) / 10;
      });



      // Map GEOID county FIPS → normalized county name
      // Miami-Dade = 086, Broward = 011, Palm Beach = 099, Monroe = 087
      const fipsToCounty = {
        "12086": "miami-dade",
        "12011": "broward",
        "12099": "palm beach",
        };

      const geojson = await (await fetch("/tracts_2022.geojson")).json();
      geojson.features.forEach(f => {
        const geoid      = f.properties.GEOID || "";
        const fipsPrefix = geoid.slice(0, 5);
        const countyKey  = fipsToCounty[fipsPrefix];
        const match      = countyKey ? countyAgg[countyKey] : null;

        if (match) {
          f.properties.impact_score          = match.impact_score;
          f.properties.households_served  = match.households_served;
          f.properties.individuals_served = match.individuals_served;
          f.properties.meals_served       = match.meals_served;
          f.properties.dist_year          = match.dist_year;
        } else {
          f.properties.impact_score          = null;
          f.properties.households_served  = null;
          f.properties.individuals_served = null;
          f.properties.meals_served       = null;
        }
      });

      source.setData(geojson);
      map.current.setPaintProperty("tracts-fill", "fill-color", [
        "step", ["coalesce", ["get", "impact_score"], -1],
        "#cccccc", 0, "#7F77DD", 30, "#F4C0D1", 38, "#5ec962", 50, "#185FA5", 65, "#FFD700",
      ]);
    } catch (e) { console.error("FSF load error", e); }
  }, []);

  // ── Trigger ACS fetch ──────────────────────────────────────────────────────
  const triggerAcsFetch = useCallback(async (year) => {
    setAcsStatus(prev => ({ ...prev, [year]: { status: "fetching", message: `Fetching ACS ${year}...` } }));
    showToast(`Fetching ACS ${year} from Census Bureau...`, 8000);
    try {
      const res  = await fetch(`${API}/api/acs/fetch?acs_year=${year}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setAcsStatus(prev => ({ ...prev, [year]: { status: "error", message: data.detail } }));
        showToast(`❌ ${data.detail}`);
        return;
      }
      if (data.cached) {
        setAcsStatus(prev => ({ ...prev, [year]: { status: "done", message: `ACS ${year} loaded`, tracts: data.tracts || 0 } }));
        await loadAcsData(year);
        showToast(`✅ ACS ${year} data loaded`);
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const sr   = await fetch(`${API}/api/acs/fetch-status?acs_year=${year}`);
          const stat = await sr.json();
          setAcsStatus(prev => ({ ...prev, [year]: stat }));
          if (stat.status === "done") {
            clearInterval(pollRef.current);
            await loadAcsData(year);
            showToast(`✅ ACS ${year} — ${stat.tracts || "Data"} loaded successfully`);
          } else if (stat.status === "error") {
            clearInterval(pollRef.current);
            showToast(`❌ ${stat.message}`);
          }
        } catch { clearInterval(pollRef.current); }
      }, 2000);
    } catch (e) {
      setAcsStatus(prev => ({ ...prev, [year]: { status: "error", message: e.message } }));
      showToast("❌ Could not reach backend");
    }
  }, [loadAcsData]);

  // ── ACS year change ────────────────────────────────────────────────────────
  const handleAcsYearChange = useCallback(async (year) => {
    setAcsYear(year);
    setSelected(null);
    if (map.current) map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
    if (acsStatus[year]?.status === "done") {
      await loadAcsData(year);
      showToast(`Switched to ACS ${year}`);
    } else if (acsStatus[year]?.status !== "fetching") {
      await triggerAcsFetch(year);
    }
  }, [acsStatus, loadAcsData, triggerAcsFetch]);

  // ── FSF year change from combo ─────────────────────────────────────────────
  const handleFsfYearChange = useCallback(async (year) => {
    if (!year) return;
    setFsfYear(year);
    setSelected(null);
    if (map.current) map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
    await loadFsfData(year);
    showToast(`Loaded FSF distribution data for ${year}`);
  }, [loadFsfData]);

  // ── Layer switch ───────────────────────────────────────────────────────────
  const handleLayerSwitch = useCallback((layer) => {
    setActiveLayer(layer);
    setSelected(null);
    setUploadOpen(false);
    if (map.current) map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
    if (layer === "need") {
      loadAcsData(acsYear);
    } else {
      if (fsfYear) {
        loadFsfData(fsfYear);
      } else if (fsfAvailYears.length > 0) {
        const latest = [...fsfAvailYears].sort((a,b) => b.year - a.year)[0].year;
        setFsfYear(latest);
        loadFsfData(latest);
      } else {
        const source = map.current?.getSource("tracts");
        if (source && map.current) {
          map.current.setPaintProperty("tracts-fill", "fill-color", "#cccccc");
        }
      }
    }
  }, [acsYear, fsfYear, loadAcsData, loadFsfData]);

  // ── FSF Upload ─────────────────────────────────────────────────────────────
  const handleFsfUpload = async () => {
    if (!fsfFile || !uploadYear) return;
    setFsfUploading(true);
    setFsfMsg("");
    const formData = new FormData();
    formData.append("file", fsfFile);
    try {
      const res  = await fetch(`${API}/api/fsf/upload?dist_year=${uploadYear}`, {
        method: "POST", body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");

      setFsfFile(null);
      setUploadYear("");
      await fetchFsfAvailYears();
      await fetchFsfHistory();

      // Auto-select the uploaded year in combo and load map
      setFsfYear(data.year);
      setActiveLayer("impact");
      await loadFsfData(data.year);
      setUploadOpen(false);
      showToast(`✅ ${data.rows_imported} rows imported for ${data.year}`);
    } catch (err) {
      setFsfMsg(`❌ ${err.message || "Upload failed. Please try again."}`);
    }
    setFsfUploading(false);
  };

  // ── Delete FSF batches ─────────────────────────────────────────────────────
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setDeleting(true);

    // Find which years are being deleted
    const deletedYears = new Set(
      fsfHistory.filter(b => selectedIds.has(b.id)).map(b => b.dist_year)
    );

    for (const id of selectedIds) {
      try { await fetch(`${API}/api/fsf/upload-history/${id}`, { method: "DELETE" }); }
      catch { /* continue */ }
    }
    setSelectedIds(new Set());
    await fetchFsfAvailYears();
    await fetchFsfHistory();

    // If currently selected year was deleted, reset combo
    if (fsfYear && deletedYears.has(fsfYear)) {
      setFsfYear(null);
      if (activeLayer === "impact" && map.current) {
        map.current.setPaintProperty("tracts-fill", "fill-color", "#cccccc");
      }
    }

    setDeleting(false);
    showToast(`${count} file(s) deleted`);
  };

  const toggleSelectId = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = (checked) => {
    setSelectedIds(checked ? new Set(fsfHistory.map(b => b.id)) : new Set());
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-80.3, 26.3],
      zoom: 8,
      minZoom: 6,
    });

    map.current.on("load", () => {
      map.current.addSource("tracts", { type: "geojson", data: "/tracts_2022.geojson" });

      fetch("/tracts_2022.geojson").then(r => r.json()).then(geojson => {
        const b = new maplibregl.LngLatBounds();
        geojson.features.forEach(f => {
          if (!f.geometry) return;
          const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
          polys.forEach(poly => poly.forEach(ring => ring.forEach(c => b.extend(c))));
        });
        map.current.fitBounds(b, { padding: 60, duration: 0 });
        fullBounds.current = b;
        const sw = b.getSouthWest(), ne = b.getNorthEast();
        map.current.setMaxBounds([[sw.lng - 2, sw.lat - 2], [ne.lng + 2, ne.lat + 2]]);
      });

      map.current.addLayer({
        id: "tracts-fill", type: "fill", source: "tracts",
        paint: {
          "fill-color": [
            "step", ["coalesce", ["get", "need_score"], -1],
            "#cccccc", 0, "#5ec962", 25, "#21918c", 50, "#3b528b", 75, "#440154", 90, "#2d1160",
          ],
          "fill-opacity": 0.72,
        },
      });
      map.current.addLayer({
        id: "tracts-outline", type: "line", source: "tracts",
        paint: { "line-color": "#ffffff", "line-width": 0.3 },
      });
      map.current.addLayer({
        id: "tracts-selected", type: "line", source: "tracts",
        paint: { "line-color": "#000000", "line-width": 2.5 },
        filter: ["==", "GEOID", ""],
      });

      map.current.on("click", "tracts-fill", e => {
        const props = e.features[0].properties;
        setSelected(props);
        map.current.setFilter("tracts-selected", ["==", "GEOID", props.GEOID]);
        const bounds = new maplibregl.LngLatBounds();
        const geom   = e.features[0].geometry;
        const rings  = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
        rings.forEach(ring => ring.forEach(c => bounds.extend(c)));
        map.current.fitBounds(bounds, {
          padding: { top: 80, bottom: 80, left: 80, right: 320 },
          maxZoom: 13, duration: 800,
        });
      });
      map.current.on("mouseenter", "tracts-fill", () => { map.current.getCanvas().style.cursor = "pointer"; });
      map.current.on("mouseleave", "tracts-fill", () => { map.current.getCanvas().style.cursor = ""; });

      // Auto-fetch ACS 2024 on load
      triggerAcsFetch(2024);
    });
  }, [loadAcsData, triggerAcsFetch]);

  const fmt = (v, suffix = "") =>
    v === null || v === undefined || v === "" ? "—" : `${Number(v).toFixed(1)}${suffix}`;

  const legend      = activeLayer === "need" ? NEED_LEGEND : ACC_LEGEND;
  const legendTitle = activeLayer === "need" ? "Need score" : "Impact score";
  const legendSrc   = activeLayer === "need"
    ? `ACS ${ACS_YEARS.find(y => y.value === acsYear)?.label || acsYear}`
    : fsfYear ? `FSF Distribution ${fsfYear}` : "No year selected";

  const currentAcsStatus = acsStatus[acsYear];
  const isFetching = currentAcsStatus?.status === "fetching";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", fontFamily: "system-ui, sans-serif" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 108, left: "50%", transform: "translateX(-50%)",
          background: "#085041", color: "#fff", padding: "8px 20px",
          borderRadius: 20, fontSize: 13, fontWeight: 500, zIndex: 100,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)", whiteSpace: "nowrap",
        }}>{toast}</div>
      )}

      {/* ── Header ── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 50,
        background: "#1a3a2a", display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 20px", zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20, filter: "sepia(1) saturate(10) hue-rotate(-30deg)" }}>🌿</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>
            Feeding South Florida — Health Equity Intelligence
          </span>
        </div>
        <a href="/" style={{
          color: "#9FE1CB", border: "1px solid #9FE1CB", borderRadius: 6,
          padding: "4px 12px", fontSize: 12, textDecoration: "none",
        }}>← Home</a>
      </div>

      {/* ── Control Bar ── */}
      <div style={{
        position: "absolute", top: 50, left: 0, right: 0, height: 46,
        background: "#1a3a2a", borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", gap: 14, padding: "0 20px", zIndex: 20,
      }}>
        {/* Layer toggle */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 6, padding: 3, gap: 2 }}>
          {[["need", "Need score"], ["impact", "Impact score"]].map(([key, label]) => (
            <button key={key} onClick={() => handleLayerSwitch(key)} style={{
              padding: "4px 14px", borderRadius: 4, fontSize: 12, cursor: "pointer",
              border: "none", fontWeight: 500, transition: "all 0.15s",
              background: activeLayer === key ? (key === "need" ? "#440154" : "#185FA5") : "transparent",
              color: activeLayer === key ? "#fff" : "rgba(255,255,255,0.6)",
            }}>{label}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)" }} />

        {/* Need score controls */}
        {activeLayer === "need" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#9FE1CB", fontSize: 11, whiteSpace: "nowrap" }}>ACS Year:</span>
            <select value={acsYear} onChange={e => handleAcsYearChange(Number(e.target.value))}
              disabled={isFetching}
              style={{
                background: "#0f2a1c", color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6, padding: "4px 8px", fontSize: 11,
                cursor: isFetching ? "not-allowed" : "pointer", minWidth: 220,
              }}>
              {ACS_YEARS.map(y => <option key={y.value} value={y.value}>{y.label}</option>)}
            </select>
            {currentAcsStatus && (
              <span style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap",
                background: isFetching ? "rgba(255,200,0,0.2)"
                  : currentAcsStatus.status === "done"  ? "rgba(29,158,117,0.25)"
                  : currentAcsStatus.status === "error" ? "rgba(226,75,74,0.25)" : "transparent",
                color: isFetching ? "#FAC775"
                  : currentAcsStatus.status === "done"  ? "#9FE1CB"
                  : currentAcsStatus.status === "error" ? "#F09595" : "#fff",
              }}>
                {isFetching ? "⏳ Fetching from Census Bureau..."
                  : currentAcsStatus.status === "done"  ? `✓ ${currentAcsStatus.tracts ? currentAcsStatus.tracts + " tracts loaded" : "Data loaded"}`
                  : currentAcsStatus.status === "error" ? `✗ ${currentAcsStatus.message}` : ""}
              </span>
            )}
          </div>
        )}

        {/* Impact score — year selector (left side) */}
        {activeLayer === "impact" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#9FE1CB", fontSize: 11, whiteSpace: "nowrap" }}>FSF Year:</span>
            <select
              value={fsfYear || ""}
              onChange={e => handleFsfYearChange(e.target.value ? Number(e.target.value) : null)}
              style={{
                background: "#0f2a1c", color: fsfYear ? "#fff" : "rgba(255,255,255,0.4)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6, padding: "4px 8px", fontSize: 11,
                cursor: "pointer", minWidth: 200,
              }}>
              <option value="">Select year...</option>
              {fsfAvailYears.map(y => (
                <option key={y.year} value={y.year}>{y.year}</option>
              ))}
            </select>
          </div>
        )}

        {/* Upload CSV + Trend Chart buttons — pinned to far right */}
        {activeLayer === "impact" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {fsfAvailYears.length >= 2 && (
              <button onClick={() => setShowTrend(true)} style={{
                background: "transparent", color: "#9FE1CB",
                border: "1px solid #9FE1CB", borderRadius: 6,
                padding: "5px 12px", fontSize: 12,
                cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap",
              }}>📈 Trend chart</button>
            )}
            <button onClick={() => { setUploadOpen(!uploadOpen); setSelected(null); }} style={{
              background: uploadOpen ? "#085041" : "#1D9E75", color: "#fff", border: "none",
              borderRadius: 6, padding: "6px 14px", fontSize: 12,
              cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap",
            }}>⬆ Upload CSV</button>
          </div>
        )}
      </div>

      {/* Map */}
      <div ref={mapContainer} style={{ position: "absolute", inset: 0, top: 96 }} />

      {/* Zoom */}
      <div style={{ position: "absolute", top: 156, left: 16, display: "flex", flexDirection: "column", gap: 2, zIndex: 10 }}>
        {["+", "−"].map((label, i) => (
          <button key={label} onClick={() => i === 0 ? map.current.zoomIn() : map.current.zoomOut()} style={{
            width: 30, height: 30, fontSize: 18, lineHeight: 1, background: "#fff",
            border: "none", borderRadius: i === 0 ? "6px 6px 0 0" : "0 0 6px 6px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.2)", cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      {/* Reset */}
      <button onClick={() => {
        if (fullBounds.current) map.current.fitBounds(fullBounds.current, { padding: 60, duration: 800 });
        setSelected(null);
        map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
      }} style={{
        position: "absolute", top: 112, left: 16, zIndex: 10,
        background: "#fff", border: "none", borderRadius: 8,
        padding: "7px 13px", fontSize: 12, fontWeight: 600,
        cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      }}>↺ Reset view</button>

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 24, left: 24, zIndex: 10,
        background: "rgba(255,255,255,0.97)", padding: "12px 15px",
        borderRadius: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", fontSize: 12,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{legendTitle}</div>
        {legend.map(({ color, label, range }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 15, height: 15, background: color, borderRadius: 3, flexShrink: 0 }} />
            <span style={{ flex: 1, color: "#444" }}>{label}</span>
            <span style={{ color: "#999", fontSize: 11 }}>{range}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8 }}>
          <div style={{ width: 13, height: 13, background: "#cccccc" }} />
          <span style={{ color: "#888", fontSize: 11 }}>No data</span>
        </div>
        <div style={{ borderTop: "0.5px solid #eee", marginTop: 8, paddingTop: 6, fontSize: 10, color: "#aaa" }}>
          {legendSrc}
        </div>
      </div>

      {/* ── Upload Panel ── */}
      {uploadOpen && activeLayer === "impact" && (
        <div style={{
          position: "absolute", top: 96, right: 0, bottom: 0, width: 320,
          background: "#fff", boxShadow: "-2px 0 8px rgba(0,0,0,0.12)",
          zIndex: 15, display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: "0.5px solid #f0f0f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>FSF Distribution Data</div>
              <button onClick={() => setUploadOpen(false)}
                style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#888", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 3, lineHeight: 1.5 }}>
              Upload annual distribution CSV to visualize impact score.
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "0.5px solid #e8e8e8" }}>
            {[["upload","Upload"],["history","History"],["fields","Fields"]].map(([key, label]) => (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                flex: 1, padding: "9px 0", textAlign: "center", fontSize: 12,
                cursor: "pointer", background: "#fff", border: "none",
                borderBottom: activeTab === key ? "2px solid #1D9E75" : "2px solid transparent",
                color: activeTab === key ? "#1D9E75" : "#888",
                fontWeight: activeTab === key ? 600 : 400,
              }}>{label}</button>
            ))}
          </div>

          {/* Upload tab */}
          {activeTab === "upload" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 5, fontWeight: 500 }}>Distribution year</div>
                <select value={uploadYear} onChange={e => { setUploadYear(e.target.value); setFsfFile(null); setFsfMsg(""); }}
                  style={{ width: "100%", background: "#fff", border: "0.5px solid #ccc", borderRadius: 8, padding: "8px 10px", fontSize: 13, cursor: "pointer" }}>
                  <option value="">Select year to upload...</option>
                  {[2025, 2024, 2023, 2022, 2021].map(y => (
                    <option key={y} value={y}>
                      {y}{fsfAvailYears.find(a => a.year === y) ? " — Replace existing data" : " — Upload new"}
                    </option>
                  ))}
                </select>
              </div>

              {uploadYear && (
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 5, fontWeight: 500 }}>CSV file</div>
                  <label style={{
                    display: "block", border: "2px dashed #1D9E75",
                    borderRadius: 8, padding: "18px 12px", textAlign: "center",
                    cursor: "pointer", background: "#f8fffe",
                  }}>
                    <div style={{ fontSize: 26, color: "#1D9E75", marginBottom: 6 }}>📂</div>
                    <div style={{ fontSize: 13, color: fsfFile ? "#085041" : "#1D9E75", fontWeight: 500 }}>
                      {fsfFile ? fsfFile.name : "Click to select CSV file"}
                    </div>
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>
                      e.g. fsf_distribution_{uploadYear}.csv
                    </div>
                    <input type="file" accept=".csv" style={{ display: "none" }}
                      onChange={e => { setFsfFile(e.target.files[0]); setFsfMsg(""); }} />
                  </label>
                </div>
              )}

              <button onClick={handleFsfUpload} disabled={!fsfFile || !uploadYear || fsfUploading} style={{
                width: "100%", padding: "10px",
                background: fsfFile && uploadYear && !fsfUploading ? "#1D9E75" : "#ccc",
                color: "#fff", border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 600,
                cursor: fsfFile && uploadYear && !fsfUploading ? "pointer" : "not-allowed",
              }}>
                {fsfUploading ? "Uploading…" : "Submit"}
              </button>

              {fsfMsg && (
                <div style={{
                  padding: "10px 14px", borderRadius: 6,
                  background: fsfMsg.includes("✅") ? "#E1F5EE" : "#FCECEA",
                  color: fsfMsg.includes("✅") ? "#0F6E56" : "#a32d2d",
                  fontSize: 13,
                }}>{fsfMsg}</div>
              )}
            </div>
          )}

          {/* History tab — grouped by year */}
          {activeTab === "history" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#888" }}>{fsfHistory.length} file{fsfHistory.length !== 1 ? "s" : ""} uploaded</span>
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedIds.size === 0 || deleting}
                  style={{
                    padding: "5px 12px", fontSize: 12, fontWeight: 500,
                    background: selectedIds.size > 0 ? "#FCEBEB" : "#f5f5f5",
                    color: selectedIds.size > 0 ? "#A32D2D" : "#bbb",
                    border: selectedIds.size > 0 ? "0.5px solid #f5b8b8" : "0.5px solid #e8e8e8",
                    borderRadius: 6, cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                  }}>
                  🗑 Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                </button>
              </div>

              {fsfHistory.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999", textAlign: "center", marginTop: 20 }}>No uploads yet.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 28, padding: "6px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#888", borderBottom: "0.5px solid #e8e8e8", background: "#fafafa" }}>
                        <input type="checkbox"
                          checked={selectedIds.size === fsfHistory.length && fsfHistory.length > 0}
                          onChange={e => toggleSelectAll(e.target.checked)}
                          style={{ accentColor: "#1D9E75", cursor: "pointer" }} />
                      </th>
                      {["Year","File","Rows","Status"].map(h => (
                        <th key={h} style={{ padding: "6px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#888", letterSpacing: "0.05em", borderBottom: "0.5px solid #e8e8e8", background: "#fafafa" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fsfHistory.map(b => (
                      <tr key={b.id} style={{ background: selectedIds.has(b.id) ? "#E1F5EE" : "transparent" }}>
                        <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5" }}>
                          <input type="checkbox" checked={selectedIds.has(b.id)}
                            onChange={() => toggleSelectId(b.id)}
                            style={{ accentColor: "#1D9E75", cursor: "pointer" }} />
                        </td>
                        <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5", fontWeight: 600, color: "#1D9E75" }}>{b.dist_year}</td>
                        <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5", fontSize: 11, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.filename}</td>
                        <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5" }}>{b.row_count?.toLocaleString()}</td>
                        <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5" }}>
                          <span style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 10, fontWeight: 500,
                            background: b.status === "active" ? "#1D9E75" : "#e0e0e0",
                            color: b.status === "active" ? "#fff" : "#777",
                          }}>{b.status === "active" ? "ACTIVE" : "ARCHIVED"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Fields tab */}
          {activeTab === "fields" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#888", letterSpacing: "0.06em", marginBottom: 4 }}>REQUIRED CSV COLUMNS</div>
              {[
                ["zip_code",           "Where food was distributed", true],
                ["county",             "One of 4 counties",          true],
                ["households_served",  "Per ZIP per month",          true],
                ["individuals_served", "Per ZIP per month",          true],
                ["meals_served",       "No. of meals served",        true],
                ["month",              "Monthly breakdown",          false],
              ].map(([col, note, req]) => (
                <div key={col} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "0.5px solid #f5f5f5" }}>
                  <span style={{ fontSize: 11, color: "#185FA5", background: "#E6F1FB", padding: "2px 7px", borderRadius: 4, fontFamily: "monospace", flexShrink: 0 }}>{col}</span>
                  <span style={{ fontSize: 11, color: "#666", flex: 1 }}>{note}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, flexShrink: 0, background: req ? "#FCEBEB" : "#E1F5EE", color: req ? "#A32D2D" : "#0F6E56" }}>
                    {req ? "required" : "optional"}
                  </span>
                </div>
              ))}
              <div style={{ background: "#f8f8f8", borderRadius: 6, padding: 10, fontSize: 11, color: "#666", lineHeight: 1.7, marginTop: 4 }}>
                County must be exactly one of:<br />
                <strong>Miami-Dade · Broward · Palm Beach</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Trend Chart Modal ── */}
      {showTrend && <TrendChart onClose={() => setShowTrend(false)} />}

      {/* ── Tract Sidebar ── */}
      {selected && !uploadOpen && (
        <div style={{
          position: "absolute", top: 96, right: 0, bottom: 0, width: 300,
          background: "#fff", boxShadow: "-2px 0 8px rgba(0,0,0,0.12)",
          padding: "18px 20px", overflowY: "auto", zIndex: 15,
        }}>
          <button onClick={() => { setSelected(null); map.current.setFilter("tracts-selected", ["==", "GEOID", ""]); }}
            style={{ float: "right", border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>×</button>

          {activeLayer === "need" ? (
            <>
              <h2 style={{ margin: "0 0 3px", fontSize: 17, fontWeight: 600 }}>
                Need score: {fmt(selected.need_score)}
              </h2>
              <p style={{ margin: "0 0 18px", color: "#888", fontSize: 12 }}>
                {selected.county_name} County · Tract {selected.GEOID}
              </p>
              <Stat label="Population"          value={selected.total_pop ? Number(selected.total_pop).toLocaleString() : "—"} note={`ACS ${acsYear}`} />
              <Stat label="Below poverty"       value={fmt(selected.poverty_rate, "%")}       note="vs ~13% nationally" />
              <Stat label="Receiving SNAP"      value={fmt(selected.snap_rate, "%")}           note="of households" />
              <Stat label="No vehicle"          value={fmt(selected.no_vehicle_rate, "%")}     note="of households" />
              <Stat label="Unemployment"        value={fmt(selected.unemployment_rate, "%")}   note="of labor force" />
              <Stat label="Housing cost burden" value={fmt(selected.housing_cost_burden, "%")} note="spending >30% on housing" />
              <Stat label="Food desert"
                value={selected.food_desert === 1 || selected.food_desert === "1" ? "Yes" : selected.food_desert === 0 || selected.food_desert === "0" ? "No" : "—"}
                note="USDA 2019" />
              <Stat label="Nearest supermarket"
                value={selected.supermarket_dist_mi ? `${Number(selected.supermarket_dist_mi).toFixed(1)} mi` : "—"}
                note="distance to nearest store" />
              <Stat label="Median income"
                value={selected.median_income ? `$${Math.round(selected.median_income).toLocaleString()}` : "—"}
                note="household, per year" />
            </>
          ) : (
            <>
              <h2 style={{ margin: "0 0 3px", fontSize: 17, fontWeight: 600, color: "#185FA5" }}>
                Impact score: {fmt(selected.impact_score)}
              </h2>
              <p style={{ margin: "0 0 18px", color: "#888", fontSize: 12 }}>
                {selected.county_name} County · FSF {fsfYear}
              </p>
              <Stat label="Meals served"        value={selected.meals_served       ? Number(selected.meals_served).toLocaleString()       : "—"} note="total meals (annual)" />
              <Stat label="Individuals served"  value={selected.individuals_served ? Number(selected.individuals_served).toLocaleString() : "—"} note="people reached" />
              <Stat label="Households served"   value={selected.households_served  ? Number(selected.households_served).toLocaleString()  : "—"} note="family units" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#bbb" }}>{note}</div>
    </div>
  );
}
