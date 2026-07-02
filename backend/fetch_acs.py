"""
fetch_acs.py
------------
Pulls ACS 5-year estimates from the US Census Bureau API
for the four FSF counties (Miami-Dade, Broward, Palm Beach, Monroe)
and returns a clean DataFrame ready to insert into the database.

Can be run standalone:
    python fetch_acs.py --year 2023

Or imported and called from main.py:
    from fetch_acs import fetch_acs_data
    df = fetch_acs_data(year=2023, api_key="YOUR_KEY")
"""

import os
import argparse
import requests
import numpy as np
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

# ── Constants ──────────────────────────────────────────────────────────────────

STATE = "12"  # Florida FIPS

COUNTIES = {
    "086": "Miami-Dade",
    "011": "Broward",
    "099": "Palm Beach",
    "087": "Monroe",
}

# ACS variable codes → readable column names
VARIABLES = {
    # Poverty
    "B17001_002E": "poverty_below",
    "B17001_001E": "poverty_total",
    # Income
    "B19013_001E": "median_income",
    # SNAP
    "B22010_002E": "snap_yes",
    "B22010_001E": "snap_total",
    # Vehicle access
    "B25044_003E": "owner_no_veh",
    "B25044_010E": "renter_no_veh",
    "B25044_001E": "veh_total",
    # Population
    "B01003_001E": "total_pop",
    # Unemployment
    "B23025_005E": "unemployed",
    "B23025_003E": "labor_force",
    # Housing cost burden (paying >30% income on housing)
    "B25070_007E": "housing_burden_30_34",
    "B25070_008E": "housing_burden_35_39",
    "B25070_009E": "housing_burden_40_49",
    "B25070_010E": "housing_burden_50plus",
    "B25070_001E": "housing_burden_total",
    # Children under 18
    "B09001_001E": "children_under18",
    # Seniors 65+
    "B01001_020E": "male_65_66",
    "B01001_021E": "male_67_69",
    "B01001_022E": "male_70_74",
    "B01001_023E": "male_75_79",
    "B01001_024E": "male_80_84",
    "B01001_025E": "male_85plus",
    "B01001_044E": "female_65_66",
    "B01001_045E": "female_67_69",
    "B01001_046E": "female_70_74",
    "B01001_047E": "female_75_79",
    "B01001_048E": "female_80_84",
    "B01001_049E": "female_85plus",
}

# ACS sentinel values that mean "not available"
SENTINEL_VALUES = {-666666666, -999999999, -888888888, -222222222, -333333333}


# ── Core fetch function ────────────────────────────────────────────────────────

def fetch_county(county_fips: str, year: int, api_key: str) -> pd.DataFrame:
    """Fetch ACS 5-year data for one county from Census API."""
    base_url = f"https://api.census.gov/data/{year}/acs/acs5"
    params = {
        "get": "NAME," + ",".join(VARIABLES.keys()),
        "for": "tract:*",
        "in": f"state:{STATE} county:{county_fips}",
        "key": api_key,
    }
    resp = requests.get(base_url, params=params, timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    return pd.DataFrame(rows[1:], columns=rows[0])


def clean_sentinels(df: pd.DataFrame) -> pd.DataFrame:
    """Replace Census sentinel values with NaN."""
    for col in VARIABLES.values():
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            df.loc[df[col].isin(SENTINEL_VALUES), col] = np.nan
            df.loc[df[col] < 0, col] = np.nan
    return df


def compute_rates(df: pd.DataFrame) -> pd.DataFrame:
    """Convert raw counts to rates (0–1 scale)."""
    # Poverty rate
    df["pct_below_poverty"] = (df["poverty_below"] / df["poverty_total"]).clip(0, 1)

    # SNAP enrollment rate
    df["pct_snap_enrollment"] = (df["snap_yes"] / df["snap_total"]).clip(0, 1)

    # No vehicle rate
    df["no_vehicle"] = df["owner_no_veh"] + df["renter_no_veh"]
    df["pct_no_vehicle"] = (df["no_vehicle"] / df["veh_total"]).clip(0, 1)

    # Unemployment rate
    df["pct_unemployment"] = (df["unemployed"] / df["labor_force"]).clip(0, 1)

    # Housing cost burden (% paying >30% of income on housing)
    df["housing_burden_30plus"] = (
        df["housing_burden_30_34"] + df["housing_burden_35_39"] +
        df["housing_burden_40_49"] + df["housing_burden_50plus"]
    )
    df["pct_housing_burden"] = (df["housing_burden_30plus"] / df["housing_burden_total"]).clip(0, 1)

    # Seniors 65+
    senior_cols = [
        "male_65_66","male_67_69","male_70_74","male_75_79","male_80_84","male_85plus",
        "female_65_66","female_67_69","female_70_74","female_75_79","female_80_84","female_85plus",
    ]
    df["seniors_65plus"] = df[[c for c in senior_cols if c in df.columns]].sum(axis=1)
    df["pct_seniors_65plus"] = (df["seniors_65plus"] / df["total_pop"]).clip(0, 1)

    # Children under 18
    df["pct_children_under18"] = (df["children_under18"] / df["total_pop"]).clip(0, 1)

    # Low income (proxy: poverty rate × 1.3 — captures near-poverty)
    df["pct_low_income"] = (df["pct_below_poverty"] * 1.3).clip(0, 1)

    return df


def compute_need_score(df: pd.DataFrame) -> pd.DataFrame:
    """
    Need score 0–100 weighted composite:
      poverty       × 30
      SNAP          × 20
      no vehicle    × 15
      low income    × 15
      food desert   × 20  (placeholder — always 0 until USDA data added)
    """
    df["need_score"] = (
        df["pct_below_poverty"].fillna(0) * 30 +
        df["pct_snap_enrollment"].fillna(0) * 20 +
        df["pct_no_vehicle"].fillna(0) * 15 +
        df["pct_low_income"].fillna(0) * 15
        # food_desert × 20 added when USDA data uploaded
    ).clip(0, 100).round(1)
    return df


def fetch_acs_data(year: int, api_key: str) -> pd.DataFrame:
    """
    Main function — fetch, clean and return ACS data for all 4 FSF counties.

    Returns a DataFrame with one row per census tract, columns matching
    the ACSRecord database model.
    """
    frames = []
    for fips, county_name in COUNTIES.items():
        try:
            df_county = fetch_county(fips, year, api_key)
            df_county["county_name"] = county_name
            frames.append(df_county)
            print(f"  ✓ {county_name}: {len(df_county)} tracts")
        except Exception as e:
            print(f"  ✗ {county_name} ({fips}): {e}")

    if not frames:
        raise RuntimeError("No data fetched — check API key and year")

    df = pd.concat(frames, ignore_index=True)

    # Rename raw variable columns
    df = df.rename(columns=VARIABLES)

    # Clean sentinel values
    df = clean_sentinels(df)

    # Compute rates
    df = compute_rates(df)

    # Compute need score
    df = compute_need_score(df)

    # Build stable GEOID = state + county + tract
    df["tract_id"] = df["state"] + df["county"] + df["tract"]

    # Final clean output
    out = df[[
        "tract_id", "county_name", "total_pop",
        "pct_below_poverty", "pct_snap_enrollment", "pct_no_vehicle",
        "pct_low_income", "pct_unemployment", "pct_housing_burden",
        "pct_children_under18", "pct_seniors_65plus",
        "median_income", "need_score",
    ]].rename(columns={
        "county_name":        "county",
        "total_pop":          "population",
        "pct_unemployment":   "unemployment_rate",
        "pct_housing_burden": "housing_cost_burden_pct",
    })

    # Drop rows where tract_id is empty or population is 0/NaN
    out = out[out["tract_id"].str.len() == 11]
    out = out[out["population"].fillna(0) > 0]

    return out.reset_index(drop=True)


# ── Standalone CLI ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch ACS 5-year data for FSF counties")
    parser.add_argument("--year", type=int, default=2024, help="ACS 5-year release year (e.g. 2024)")
    args = parser.parse_args()

    api_key = os.getenv("CENSUS_API_KEY")
    if not api_key:
        raise SystemExit("No CENSUS_API_KEY found — add it to backend/.env")

    print(f"\nFetching ACS 5-year {args.year} data...")
    df = fetch_acs_data(year=args.year, api_key=api_key)

    out_file = f"acs_raw_{args.year}.csv"
    df.to_csv(out_file, index=False)

    print(f"\n{'─'*50}")
    print(f"Tracts fetched : {len(df)}")
    print(f"Saved to       : {out_file}")
    print(f"\nSample need scores:")
    print(df.nlargest(5, "need_score")[["tract_id","county","need_score","pct_below_poverty"]].to_string(index=False))
