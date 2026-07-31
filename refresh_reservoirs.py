"""Daily refresh of reservoirs.json for the Utah Reservoir Drought Dashboard.

Pulls current-through-yesterday daily storage (af) for all 28 Bureau of
Reclamation-monitored Utah reservoirs from the RISE API, then reproduces the
same two drought metrics computed in the original reservoir_levels.ipynb
notebook (Phase 1 of the Esri SDK Cross-Platform Learning Track):

- pct_of_record_max: current storage vs. the highest storage seen in the
  pulled date range (proxy for % of physical capacity, not the real thing).
- seasonal_percentile: where today's storage ranks against every other
  year's value within a 7-day day-of-year window.

No local CSV cache -- this always re-pulls the full date range fresh, since
it runs in an ephemeral GitHub Actions environment. RISE's own disclaimer:
data is provisional and recent values are subject to revision.
"""

import datetime as dt
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

RISE_RESULT_URL = "https://data.usbr.gov/rise/api/result"
START_DATE = "20150101"
OUTPUT_PATH = Path(__file__).parent / "reservoirs.json"

# name -> (RISE catalog-item id for "Daily Instantaneous Lake/Reservoir
# Storage (af)", lat, lon). The first 12 item IDs and the seasonal/record-max
# methodology come directly from Brian's original notebook
# (~/Developer/mtnwest-geo/reservoir_levels.ipynb); the other 16 were
# rediscovered via the same RISE location -> catalogRecord -> catalogItem
# walk documented there, filtered to stateId=UT, types=Reservoir, and
# parameterName == "Lake/Reservoir Storage" -- since that mapping was never
# committed anywhere despite the 28-reservoir statewide expansion using it.
RESERVOIRS = {
    "Deer Creek": (290, 40.43511, -111.50035),
    "Jordanelle": (468, 40.60689, -111.41655),
    "Strawberry": (779, 40.16882, -111.1311),
    "Rockport": (706, 40.77498, -111.39859),
    "Echo": (314, 40.9574, -111.4179),
    "East Canyon": (310, 40.91017, -111.59293),
    "Pineview": (652, 41.26543, -111.80998),
    "Willard Bay": (866, 41.37738, -112.08339),
    "Scofield": (727, 39.77656, -111.05074),
    "Starvation": (764, 40.19324, -110.44722),
    "Flaming Gorge": (337, 40.97789, -109.57304),
    "Lake Powell": (509, 37.05778, -111.30332),
    "Causey": (219, 41.29828, -111.58591),
    "Currant Creek": (278, 40.33841, -111.05821),
    "Huntington North": (432, 39.38458, -111.09082),
    "Hyrum": (439, 41.62117, -111.86099),
    "Joes Valley": (463, 39.2901, -111.27888),
    "Lost Creek": (544, 41.18887, -111.39628),
    "Meeks Cabin": (574, 41.01664, -110.58344),
    "Moon Lake": (587, 40.57445, -110.50665),
    "Newton": (623, 41.8998, -111.97562),
    "Red Fleet": (685, 40.57832, -109.42853),
    "Stateline": (769, 40.98291, -110.39038),
    "Steinaker": (774, 40.51456, -109.53275),
    "Trial Lake": (4516, 40.6799, -110.956839),
    "Upper Stillwater": (826, 40.56565, -110.70044),
    "Washington Lake": (4530, 40.6765, -110.964),
    "Lost Lake": (4523, 40.6741, -110.9413),
}


def fetch_rise_series(item_id: int, start: str, end: str) -> pd.DataFrame:
    """Pull one RISE catalog item's daily results, paginating as needed."""
    rows = []
    page = 1
    while True:
        params = {
            "itemsPerPage": 2000,
            "order[dateTime]": "ASC",
            "itemId": item_id,
            "dateTime[after]": start,
            "dateTime[strictly_before]": end,
            "page": page,
        }
        resp = requests.get(RISE_RESULT_URL, params=params, timeout=60)
        resp.raise_for_status()
        payload = resp.json()
        rows.extend(payload["data"])
        if page * payload["meta"]["itemsPerPage"] >= payload["meta"]["totalItems"]:
            break
        page += 1

    if not rows:
        return pd.DataFrame(columns=["date", "storage_af"])
    df = pd.DataFrame([r["attributes"] for r in rows])
    df["dateTime"] = pd.to_datetime(df["dateTime"]).dt.tz_localize(None)
    return df[["dateTime", "result"]].rename(columns={"dateTime": "date", "result": "storage_af"})


def seasonal_percentile(group: pd.DataFrame, window_days: int = 7) -> float:
    """Where today's storage ranks vs. every other year's value in a +/-7-day day-of-year window."""
    today_doy = group["date"].max().dayofyear
    current_value = group.loc[group["date"].idxmax(), "storage_af"]
    doy_diff = np.minimum(
        np.abs(group["day_of_year"] - today_doy),
        365 - np.abs(group["day_of_year"] - today_doy),
    )
    window = group.loc[doy_diff <= window_days, "storage_af"]
    return float(np.mean(window <= current_value) * 100)


def main() -> None:
    end = (dt.datetime.utcnow() + dt.timedelta(days=1)).strftime("%Y%m%d")

    frames = []
    for name, (item_id, lat, lon) in RESERVOIRS.items():
        df = fetch_rise_series(item_id, START_DATE, end)
        if df.empty:
            print(f"WARNING: no data returned for {name} (item {item_id}) -- skipping")
            continue
        df["reservoir"] = name
        df["lat"] = lat
        df["lon"] = lon
        frames.append(df)
        time.sleep(0.5)  # be polite to RISE's server

    storage = pd.concat(frames, ignore_index=True)
    storage = storage.sort_values(["reservoir", "date"]).reset_index(drop=True)
    storage["day_of_year"] = storage["date"].dt.dayofyear

    latest = storage.groupby("reservoir").tail(1).set_index("reservoir")
    record_max = storage.groupby("reservoir")["storage_af"].max()
    seasonal_pctl = storage.groupby("reservoir", group_keys=False).apply(
        seasonal_percentile, include_groups=False
    )
    coords = storage.groupby("reservoir")[["lat", "lon"]].first()

    summary = pd.DataFrame({
        "current_storage_af": latest["storage_af"],
        "as_of": latest["date"].dt.date.astype(str),
        "pct_of_record_max": (latest["storage_af"] / record_max * 100).round(1),
        "seasonal_percentile": seasonal_pctl.round(1),
        "lat": coords["lat"],
        "lon": coords["lon"],
    }).sort_values("pct_of_record_max")

    records = []
    for name, row in summary.iterrows():
        records.append({
            "name": name,
            "current_storage_af": round(float(row["current_storage_af"]), 2),
            "as_of": row["as_of"],
            "pct_of_record_max": float(row["pct_of_record_max"]),
            "seasonal_percentile": float(row["seasonal_percentile"]),
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
        })

    OUTPUT_PATH.write_text(json.dumps(records, indent=2) + "\n")
    print(f"Wrote {len(records)} reservoirs to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
