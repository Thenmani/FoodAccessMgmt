import os
import io
import threading
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import pandas as pd
from dotenv import load_dotenv

from database import (
    SessionLocal, engine, Base,
    ACSRecord, UploadBatch,
    FSFDistribution, FSFUploadBatch,
)

load_dotenv()
Base.metadata.create_all(bind=engine)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-progress ACS fetch tracker ─────────────────────────────────────────────
acs_fetch_status: dict = {}

# ── ZIP population lookup ──────────────────────────────────────────────────────
ZIP_POPULATION = {
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
}
DEFAULT_ZIP_POP = 25000


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def safe_float(row, key, default=0.0):
    try:
        return float(row.get(key, default) or default)
    except (ValueError, TypeError):
        return default


def safe_int(row, key, default=0):
    try:
        return int(float(row.get(key, default) or default))
    except (ValueError, TypeError):
        return default


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


# ════════════════════════════════════════════════════════════════════════════════
#  ACS — AUTO FETCH FROM CENSUS API
# ════════════════════════════════════════════════════════════════════════════════

def _do_acs_fetch(year: int):
    acs_fetch_status[year] = {"status": "fetching", "message": f"Fetching ACS {year} from Census Bureau..."}
    try:
        api_key = os.getenv("CENSUS_API_KEY", "")
        from fetch_acs import fetch_acs_data
        df = fetch_acs_data(year=year, api_key=api_key)

        db = SessionLocal()
        try:
            db.query(UploadBatch).filter(
                UploadBatch.status == "active",
                UploadBatch.acs_year == year,
            ).update({"status": "archived"})

            batch = UploadBatch(
                filename=f"census_api_acs5_{year}.csv",
                uploaded_by="census_api",
                row_count=len(df),
                status="active",
                acs_year=year,
            )
            db.add(batch)
            db.commit()
            db.refresh(batch)

            for _, row in df.iterrows():
                record = ACSRecord(
                    tract_id                = str(row.get("tract_id", "")),
                    neighborhood            = "",
                    county                  = str(row.get("county", "")),
                    latitude                = None,
                    longitude               = None,
                    need_score              = safe_float(row, "need_score"),
                    food_access_index       = safe_float(row, "need_score"),
                    population              = safe_int(row, "population"),
                    median_income           = safe_float(row, "median_income"),
                    pct_below_poverty       = safe_float(row, "pct_below_poverty"),
                    pct_snap_enrollment     = safe_float(row, "pct_snap_enrollment"),
                    pct_no_vehicle          = safe_float(row, "pct_no_vehicle"),
                    pct_low_income          = safe_float(row, "pct_low_income"),
                    food_desert             = 0,
                    supermarket_dist_mi     = None,
                    pct_children_under18    = safe_float(row, "pct_children_under18"),
                    pct_seniors_65plus      = safe_float(row, "pct_seniors_65plus"),
                    unemployment_rate       = safe_float(row, "unemployment_rate"),
                    housing_cost_burden_pct = safe_float(row, "housing_cost_burden_pct"),
                    acs_year                = year,
                    upload_batch_id         = batch.id,
                )
                db.add(record)

            db.commit()
            acs_fetch_status[year] = {
                "status": "done",
                "message": f"ACS {year} loaded — {len(df)} tracts",
                "tracts": len(df),
            }
        finally:
            db.close()

    except Exception as e:
        acs_fetch_status[year] = {"status": "error", "message": str(e)}


@app.post("/api/acs/fetch")
def trigger_acs_fetch(acs_year: int = Query(2024)):
    api_key = os.getenv("CENSUS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="CENSUS_API_KEY not set in backend/.env")

    if acs_year not in range(2019, 2026):
        raise HTTPException(status_code=400, detail="Year must be between 2019 and 2025")

    if acs_fetch_status.get(acs_year, {}).get("status") == "fetching":
        return {"message": f"Already fetching ACS {acs_year}...", "cached": False}

    db = SessionLocal()
    existing = db.query(UploadBatch).filter(
        UploadBatch.acs_year == acs_year,
        UploadBatch.status == "active",
    ).first()
    db.close()

    if existing:
        acs_fetch_status[acs_year] = {
            "status": "done",
            "message": f"ACS {acs_year} already loaded",
            "tracts": existing.row_count,
        }
        return {"message": f"ACS {acs_year} already in database", "cached": True, "tracts": existing.row_count or 0}

    acs_fetch_status[acs_year] = {"status": "fetching", "message": "Starting..."}
    t = threading.Thread(target=_do_acs_fetch, args=(acs_year,), daemon=True)
    t.start()
    return {"message": f"Fetching ACS {acs_year} in background...", "cached": False}


@app.get("/api/acs/fetch-status")
def get_acs_fetch_status(acs_year: int = Query(2024)):
    status = acs_fetch_status.get(acs_year)
    if not status:
        db = SessionLocal()
        existing = db.query(UploadBatch).filter(
            UploadBatch.acs_year == acs_year,
            UploadBatch.status == "active",
        ).first()
        db.close()
        if existing:
            return {"status": "done", "message": f"ACS {acs_year} loaded", "tracts": existing.row_count or 0}
        return {"status": "not_started", "message": f"ACS {acs_year} not yet fetched", "tracts": 0}
    return status


@app.get("/api/acs/tracts")
def get_acs_tracts(acs_year: int = Query(2024), db: Session = Depends(get_db)):
    batch = db.query(UploadBatch).filter(
        UploadBatch.status == "active",
        UploadBatch.acs_year == acs_year,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail=f"No ACS data loaded for year {acs_year}")

    records = db.query(ACSRecord).filter(ACSRecord.upload_batch_id == batch.id).all()
    return [
        {
            "tract_id":                r.tract_id,
            "neighborhood":            r.neighborhood,
            "county":                  r.county,
            "need_score":              r.need_score,
            "food_access_index":       r.food_access_index,
            "population":              r.population,
            "median_income":           r.median_income,
            "pct_below_poverty":       r.pct_below_poverty,
            "pct_snap_enrollment":     r.pct_snap_enrollment,
            "pct_no_vehicle":          r.pct_no_vehicle,
            "food_desert":             r.food_desert,
            "supermarket_dist_mi":     r.supermarket_dist_mi,
            "unemployment_rate":       r.unemployment_rate,
            "housing_cost_burden_pct": r.housing_cost_burden_pct,
            "acs_year":                r.acs_year,
        }
        for r in records
    ]


@app.get("/api/acs/available-years")
def get_acs_available_years(db: Session = Depends(get_db)):
    batches = db.query(UploadBatch).filter(UploadBatch.status == "active").all()
    return [{"year": b.acs_year, "tracts": b.row_count} for b in batches]


@app.get("/api/acs/upload-history")
def get_acs_history(db: Session = Depends(get_db)):
    batches = db.query(UploadBatch).order_by(UploadBatch.uploaded_at.desc()).all()
    return [
        {
            "id":          b.id,
            "filename":    b.filename,
            "uploaded_by": b.uploaded_by,
            "uploaded_at": str(b.uploaded_at),
            "row_count":   b.row_count,
            "acs_year":    b.acs_year,
            "status":      b.status,
        }
        for b in batches
    ]


@app.delete("/api/acs/upload-history/{batch_id}")
def delete_acs_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    db.query(ACSRecord).filter(ACSRecord.upload_batch_id == batch_id).delete()
    db.delete(batch)
    db.commit()
    return {"message": f"ACS batch {batch_id} deleted"}


# ════════════════════════════════════════════════════════════════════════════════
#  FSF ACCOMPLISHMENT SCORE
# ════════════════════════════════════════════════════════════════════════════════

@app.post("/api/fsf/upload")
async def upload_fsf_csv(
    file: UploadFile = File(...),
    dist_year: int = Query(...),
    uploaded_by: str = "manager",
    db: Session = Depends(get_db),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files accepted")

    contents = await file.read()
    try:
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    required = {"zip_code", "county", "households_served", "individuals_served", "meals_served"}
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(sorted(missing))}")

    # Archive previous active batch for this year
    db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active",
        FSFUploadBatch.dist_year == dist_year,
    ).update({"status": "archived"})

    batch = FSFUploadBatch(
        filename=file.filename,
        uploaded_by=uploaded_by,
        row_count=len(df),
        dist_year=dist_year,
        status="active",
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    for _, row in df.iterrows():
        zip_code   = str(row.get("zip_code", "")).strip().zfill(5)
        ind_served = safe_int(row, "individuals_served")
        meals      = safe_int(row, "meals_served")
        zip_pop    = ZIP_POPULATION.get(zip_code, DEFAULT_ZIP_POP)

        # Impact score (0-100) calibrated to realistic FSF monthly data:
        # Population reach (60%):  benchmark = 5% of ZIP pop per month → score of 60
        # Meals per capita (40%):  benchmark = 5 meals/person/month    → score of 40
        pop_pct      = min((ind_served / zip_pop) / 0.05, 1.0) * 60
        meals_score  = min((meals / max(ind_served, 1)) / 5.0, 1.0) * 40
        acc_score    = round(pop_pct + meals_score, 1)

        record = FSFDistribution(
            zip_code            = zip_code,
            county              = str(row.get("county", "")),
            households_served   = safe_int(row, "households_served"),
            individuals_served  = ind_served,
            meals_served        = meals,
            month               = str(row.get("month", "")),
            dist_year           = dist_year,
            impact_score= acc_score,
            upload_batch_id     = batch.id,
        )
        db.add(record)

    db.commit()

    # Recalculate county-level impact scores from aggregated totals
    FIPS_COUNTY = {"12086":"Miami-Dade","12011":"Broward","12099":"Palm Beach","12087":"Monroe"}
    county_agg = {}
    for _, row in df.iterrows():
        c = str(row.get("county","")).strip()
        n = c.lower()
        if "miami" in n or "dade" in n:   key = "Miami-Dade"
        elif "broward" in n:               key = "Broward"
        elif "palm" in n:                  key = "Palm Beach"
        else: continue
        z   = str(row.get("zip_code","")).zfill(5)
        ind = safe_int(row, "individuals_served")
        mls = safe_int(row, "meals_served")
        pop = ZIP_POPULATION.get(z, DEFAULT_ZIP_POP)
        if key not in county_agg:
            county_agg[key] = {"ind":0,"meals":0,"pop":0,"count":0}
        county_agg[key]["ind"]   += ind
        county_agg[key]["meals"] += mls
        county_agg[key]["pop"]   += pop
        county_agg[key]["count"] += 1

    # Update all rows for each county with the county-level score
    for county, agg in county_agg.items():
        if agg["count"] == 0: continue
        avg_ind   = agg["ind"]   / agg["count"]
        avg_meals = agg["meals"] / agg["count"]
        avg_pop   = agg["pop"]   / agg["count"]
        pop_pct     = min((avg_ind / avg_pop) / 0.05, 1.0) * 60
        meals_score = min((avg_meals / max(avg_ind, 1)) / 5.0, 1.0) * 40
        county_score = round(pop_pct + meals_score, 1)
        db.query(FSFDistribution).filter(
            FSFDistribution.upload_batch_id == batch.id,
            FSFDistribution.county == county,
        ).update({"impact_score": county_score})

    db.commit()
    return {"message": "Upload successful", "batch_id": batch.id, "rows_imported": len(df), "year": dist_year}


@app.get("/api/fsf/distributions")
def get_fsf_distributions(dist_year: int = Query(...), db: Session = Depends(get_db)):
    batch = db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active",
        FSFUploadBatch.dist_year == dist_year,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail=f"No FSF data uploaded for {dist_year}")

    records = db.query(FSFDistribution).filter(FSFDistribution.upload_batch_id == batch.id).all()
    return [
        {
            "zip_code":              r.zip_code,
            "county":                r.county,
            "households_served":     r.households_served,
            "individuals_served":    r.individuals_served,
            "meals_served":          r.meals_served,
            "month":                 r.month,
            "dist_year":             r.dist_year,
            "impact_score":  r.impact_score,
        }
        for r in records
    ]


@app.get("/api/fsf/available-years")
def get_fsf_available_years(db: Session = Depends(get_db)):
    """Return list of years that have uploaded FSF data."""
    batches = db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active"
    ).order_by(FSFUploadBatch.dist_year.desc()).all()
    return [{"year": b.dist_year, "rows": b.row_count, "filename": b.filename} for b in batches]


@app.get("/api/fsf/upload-history")
def get_fsf_history(db: Session = Depends(get_db)):
    batches = db.query(FSFUploadBatch).order_by(
        FSFUploadBatch.dist_year.desc(),
        FSFUploadBatch.uploaded_at.desc()
    ).all()
    return [
        {
            "id":          b.id,
            "filename":    b.filename,
            "uploaded_by": b.uploaded_by,
            "uploaded_at": str(b.uploaded_at),
            "row_count":   b.row_count,
            "dist_year":   b.dist_year,
            "status":      b.status,
        }
        for b in batches
    ]


@app.delete("/api/fsf/upload-history/{batch_id}")
def delete_fsf_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(FSFUploadBatch).filter(FSFUploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    db.query(FSFDistribution).filter(FSFDistribution.upload_batch_id == batch_id).delete()
    db.delete(batch)
    db.commit()
    return {"message": f"FSF batch {batch_id} deleted"}


@app.patch("/api/fsf/upload-history/{batch_id}/activate")
def activate_fsf_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(FSFUploadBatch).filter(FSFUploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active",
        FSFUploadBatch.dist_year == batch.dist_year,
    ).update({"status": "archived"})
    batch.status = "active"
    db.commit()
    return {"message": f"FSF batch {batch_id} is now active"}


# ── Legacy endpoints ───────────────────────────────────────────────────────────
@app.get("/api/tracts")
def get_tracts_legacy(db: Session = Depends(get_db)):
    return get_acs_tracts(acs_year=2024, db=db)

@app.get("/api/upload-history")
def get_history_legacy(db: Session = Depends(get_db)):
    return get_acs_history(db=db)
