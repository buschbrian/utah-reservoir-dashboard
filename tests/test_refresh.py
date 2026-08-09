"""Tests for refresh_reservoirs.py, run against synthetic series.

Deliberately does not touch the network: RISE is slow, rate-limited and
occasionally wrong, and none of that should decide whether CI is green.
_get_json is stubbed where the HTTP path itself is under test.

Run with `pytest tests/` or directly with `python tests/test_refresh.py`.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import refresh_reservoirs as R  # noqa: E402


TODAY = R.local_today()


def synthetic_series(stale_days: int = 0, start: str = "2015-01-01",
                     seed: int = 7, with_nulls: bool = False) -> pd.DataFrame:
    """A seasonal, gently declining daily storage series through today-stale_days."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, TODAY - pd.Timedelta(days=stale_days), freq="D")
    doy = idx.dayofyear.to_numpy()
    base = 50000 + 20000 * np.sin((doy - 100) / 365 * 2 * np.pi)
    trend = np.linspace(0, -12000, len(idx))
    values = base + trend + rng.normal(0, 300, len(idx))

    rows = [{"dateTime": d.isoformat(), "result": float(v)} for d, v in zip(idx, values)]
    if with_nulls:
        rows[-1]["result"] = None                 # trailing null
        rows[-2]["result"] = None
        rows.append(dict(rows[-1]))               # duplicate date, also null
    return _clean(rows)


def _clean(rows: list[dict]) -> pd.DataFrame:
    """Mirror of fetch_rise_series' cleaning, minus the HTTP."""
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["dateTime"], format="mixed", utc=True) \
                   .dt.tz_localize(None).dt.normalize()
    df["storage_af"] = pd.to_numeric(df["result"], errors="coerce")
    df = df.dropna(subset=["storage_af"])
    df = df[df["date"] <= TODAY]
    df = df.sort_values("date").drop_duplicates(subset="date", keep="last")
    return df[["date", "storage_af"]].reset_index(drop=True)


# --- cleaning -------------------------------------------------------------

def test_trailing_nulls_and_duplicate_dates_are_dropped():
    """A trailing null used to become the 'latest' reading and NaN every metric."""
    df = synthetic_series(with_nulls=True)
    assert df["storage_af"].notna().all()
    assert df["date"].is_unique


# --- headline metrics -----------------------------------------------------

def test_summarize_produces_a_complete_json_serializable_record():
    rec = R.summarize("Testwater", 999, 40.0, -111.0, synthetic_series(), TODAY)
    json.dumps(rec)  # no NaN/Infinity may leak into the output
    assert rec["days_stale"] == 0
    assert rec["is_stale"] is False
    assert rec["fetch_ok"] is True
    assert 0 <= rec["pct_of_record_max"] <= 100
    assert 0 <= rec["seasonal_percentile"] <= 100
    assert rec["change_30d_af"] is not None
    assert rec["change_365d_af"] is not None
    assert rec["pct_of_seasonal_normal"] is not None
    assert rec["peak_this_year_date"] is not None
    assert len(rec["monthly"]) == 12
    assert all(m["mean_af"] is not None for m in rec["monthly"])
    assert rec["monthly"][0]["normal_af"] is not None


def test_stale_series_is_flagged():
    rec = R.summarize("Frozen", 998, 40.0, -111.0, synthetic_series(stale_days=11), TODAY)
    assert rec["days_stale"] == 11
    assert rec["is_stale"] is True


def test_fresh_boundary_is_not_flagged():
    rec = R.summarize("Edge", 997, 40.0, -111.0,
                      synthetic_series(stale_days=R.STALE_AFTER_DAYS), TODAY)
    assert rec["is_stale"] is False


# --- metric corrections ---------------------------------------------------

def test_seasonal_percentile_excludes_the_current_year():
    """A record low for this week must be able to read as 0.

    When the current year was part of the comparison population, the value
    was being compared against itself, so the floor was above zero no matter
    how bad the year got.
    """
    idx = pd.date_range("2015-01-01", TODAY, freq="D")
    # Every prior year sits at 1000; the current year collapses to 10.
    values = np.where(idx.year < TODAY.year, 1000.0, 10.0)
    series = pd.Series(values, index=idx)
    assert R.seasonal_percentile(series, TODAY, 10.0) == 0.0


def test_seasonal_percentile_is_none_without_prior_years():
    """A first-year reservoir has nothing to rank against; say so, don't invent."""
    idx = pd.date_range(f"{TODAY.year}-01-01", TODAY, freq="D")
    series = pd.Series(np.linspace(100, 50, len(idx)), index=idx)
    assert np.isnan(R.seasonal_percentile(series, TODAY, 50.0))

    df = pd.DataFrame({"date": idx, "storage_af": series.to_numpy()})
    rec = R.summarize("Brand New", 996, 40.0, -111.0, df, TODAY)
    assert rec["seasonal_percentile"] is None
    assert rec["seasonal_normal_af"] is None
    assert rec["seasonal_sample_years"] == 0
    json.dumps(rec)


def test_seasonal_normal_uses_prior_years_only():
    """The normal is a climatology; this year must not drag it down."""
    idx = pd.date_range("2015-01-01", TODAY, freq="D")
    values = np.where(idx.year < TODAY.year, 1000.0, 10.0)
    series = pd.Series(values, index=idx)
    df = pd.DataFrame({"date": idx, "storage_af": series.to_numpy()})
    rec = R.summarize("Collapsed", 995, 40.0, -111.0, df, TODAY)
    assert rec["seasonal_normal_af"] == 1000.0
    assert rec["pct_of_seasonal_normal"] == 1.0
    assert rec["seasonal_sample_years"] == TODAY.year - 2015


def test_seasonal_window_wraps_correctly_across_a_leap_year():
    """The wrap-around used a flat 365, shifting the window in leap years."""
    idx = pd.date_range("2024-12-20", "2025-01-10", freq="D")  # 2024 is a leap year
    series = pd.Series(1.0, index=idx)
    window = R.seasonal_window(series, pd.Timestamp("2025-01-01"), window_days=3)
    assert set(window.index.date) == {
        d.date() for d in pd.date_range("2024-12-29", "2025-01-04", freq="D")
    }


def test_local_today_is_mountain_time():
    """days_stale is compared against local dates, so today must be local too."""
    expected = pd.Timestamp.now(R.LOCAL_TZ).normalize().tz_localize(None)
    assert R.local_today() == expected


# --- degenerate inputs ----------------------------------------------------

def test_short_series_has_no_year_over_year_change_and_no_normals():
    df = synthetic_series()
    df = df[df["date"] >= TODAY - pd.Timedelta(days=120)]
    rec = R.summarize("Newish", 994, 40.0, -111.0, df, TODAY)
    json.dumps(rec)
    assert rec["change_365d_af"] is None
    assert len(rec["monthly"]) <= 5
    assert all(m["normal_af"] is None for m in rec["monthly"])


def test_single_observation_series_does_not_crash():
    df = synthetic_series().tail(1).reset_index(drop=True)
    rec = R.summarize("OnePoint", 993, 40.0, -111.0, df, TODAY)
    json.dumps(rec)
    assert rec["pct_of_record_max"] == 100.0
    assert len(rec["monthly"]) == 1


# --- carry-forward --------------------------------------------------------

def test_carry_forward_preserves_values_and_marks_the_failure():
    """A reservoir we can't fetch keeps its last record instead of vanishing."""
    previous = R.summarize("Frozen", 992, 40.0, -111.0,
                           synthetic_series(stale_days=11), TODAY)
    carried = R.carry_forward(previous, TODAY, "fetch failed: boom")
    assert carried["current_storage_af"] == previous["current_storage_af"]
    assert carried["fetch_ok"] is False
    assert carried["is_stale"] is True
    assert carried["days_stale"] == 11
    assert "boom" in carried["fetch_error"]


# --- previous-output loading ---------------------------------------------

def test_load_previous_accepts_both_file_shapes_and_survives_garbage(tmp_path):
    array_file = tmp_path / "array.json"
    array_file.write_text(json.dumps([{"name": "A", "as_of": "2026-01-01"}]))
    envelope_file = tmp_path / "envelope.json"
    envelope_file.write_text(json.dumps({"reservoirs": [{"name": "B", "as_of": "2026-01-01"}]}))
    broken_file = tmp_path / "broken.json"
    broken_file.write_text("{not json")

    assert set(R.load_previous(array_file)) == {"A"}
    assert set(R.load_previous(envelope_file)) == {"B"}
    assert R.load_previous(broken_file) == {}
    assert R.load_previous(tmp_path / "missing.json") == {}


# --- pagination -----------------------------------------------------------

def test_pagination_stops_on_an_empty_page_despite_lying_meta(monkeypatch):
    """meta claiming a million rows must not out-vote an empty page."""
    calls = {"n": 0}

    def fake_get(params):
        calls["n"] += 1
        data = [] if params["page"] > 3 else [
            {"attributes": {"dateTime": f"2015-01-{i + 1:02d}T00:00:00Z", "result": 1.0}}
            for i in range(3)
        ]
        return {"data": data, "meta": {"itemsPerPage": 2000, "totalItems": 999999}}

    monkeypatch.setattr(R, "_get_json", fake_get)
    frame = R.fetch_rise_series(1, "20150101", "20260810")
    assert calls["n"] == 4
    assert len(frame) == 3


def test_pagination_stops_when_meta_is_missing(monkeypatch):
    calls = {"n": 0}

    def fake_get(params):
        calls["n"] += 1
        return {"data": [{"attributes": {"dateTime": "2015-01-01T00:00:00Z", "result": 5.0}}]}

    monkeypatch.setattr(R, "_get_json", fake_get)
    R.fetch_rise_series(1, "20150101", "20260810")
    assert calls["n"] == 1


def test_pagination_is_bounded(monkeypatch):
    """Even a server that always claims more must not loop forever."""
    calls = {"n": 0}

    def fake_get(params):
        calls["n"] += 1
        return {
            "data": [{"attributes": {"dateTime": "2015-01-01T00:00:00Z", "result": 5.0}}],
            "meta": {"itemsPerPage": 1, "totalItems": 10 ** 9},
        }

    monkeypatch.setattr(R, "_get_json", fake_get)
    R.fetch_rise_series(1, "20150101", "20260810")
    assert calls["n"] == R.MAX_PAGES


# --- published output -----------------------------------------------------

def test_committed_reservoirs_json_is_well_formed():
    """Guards the file the dashboards actually read."""
    payload = json.loads((Path(__file__).resolve().parent.parent / "reservoirs.json").read_text())
    assert isinstance(payload, dict), "expected the envelope shape"
    records = payload["reservoirs"]
    assert len(records) == payload["reservoir_count"] == len(R.RESERVOIRS)
    assert payload["stale_count"] == sum(1 for r in records if r["is_stale"])

    for record in records:
        for key in ("name", "as_of", "days_stale", "is_stale", "fetch_ok",
                    "current_storage_af", "record_max_af", "pct_of_record_max",
                    "lat", "lon", "monthly"):
            assert key in record, f"{record.get('name')} missing {key}"
        assert -180 <= record["lon"] <= 0 and 0 <= record["lat"] <= 90
        assert record["monthly"], f"{record['name']} has no monthly history"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
