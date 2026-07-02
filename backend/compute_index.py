import pandas as pd

# Read the clean raw data produced by fetch_acs.py
df = pd.read_csv("acs_raw.csv")

# Indicator -> weight. Weights sum to 1.0.
# 'invert=True' means HIGH values mean LESS need (only median_income).
INDICATORS = {
    "poverty_rate":     {"weight": 0.40, "invert": False},
    "snap_rate":        {"weight": 0.20, "invert": False},
    "no_vehicle_rate":  {"weight": 0.20, "invert": False},
    "median_income":    {"weight": 0.20, "invert": True},
}

# --- Filter out non-residential / institutional tracts ---
# Census tracts numbered 9800-9999 are special-purpose (parks, airports,
# water, prisons) with little or no household population. Drop very-low-pop
# tracts too — they produce unstable rates and aren't siting candidates.
df["tract_code"] = df["GEOID"].astype(str).str[-6:]
df = df[df["tract_code"].astype(int) < 980000]
df = df[df["total_pop"] >= 100]

# --- Normalize each indicator to a 0-1 percentile rank across all tracts ---
# rank(pct=True) handles NaNs by leaving them NaN (tract simply doesn't score
# on that indicator). ascending=False inverts income so low income = high need.
for col, cfg in INDICATORS.items():
    ascending = not cfg["invert"]  # invert -> rank descending
    df[col + "_norm"] = df[col].rank(pct=True, ascending=ascending)

# --- Weighted sum -> need_score on 0-100 ---
# Compute as a weighted average over the indicators that ARE present for each
# tract, so a missing indicator doesn't unfairly drag the score to zero.
norm_cols = [c + "_norm" for c in INDICATORS]
weights = pd.Series({c + "_norm": INDICATORS[c]["weight"] for c in INDICATORS})

weighted = df[norm_cols].mul(weights, axis=1).sum(axis=1)
present_weight = df[norm_cols].notna().mul(weights, axis=1).sum(axis=1)
df["need_score"] = (weighted / present_weight) * 100

# Require at least 3 of the 4 indicators present, or the score isn't trustworthy.
present_count = df[norm_cols].notna().sum(axis=1)
df.loc[present_count < 3, "need_score"] = pd.NA

# --- Inspect the result ---
print("need_score summary:")
print(df["need_score"].describe().round(1))

print("\nTop 10 highest-need tracts:")
cols = ["GEOID", "county_name", "poverty_rate", "snap_rate",
        "no_vehicle_rate", "median_income", "need_score"]
print(df.sort_values("need_score", ascending=False)[cols].head(10).round(1).to_string(index=False))

print("\nLowest 5 (least need) — sanity check these look affluent:")
print(df.sort_values("need_score")[cols].head(5).round(1).to_string(index=False))

df.to_csv("acs_with_index.csv", index=False)
print("\nSaved to acs_with_index.csv")