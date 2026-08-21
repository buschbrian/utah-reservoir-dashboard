"""Reading a series at a date, and the twelve months behind today.

`value_asof` is why a change names the reading it is a change from: the
pipeline asks for a date and takes the nearest reading inside a tolerance, so
"change in 1 year" has covered 320 days to 410, and the interval it actually
measured is published beside it.
"""

import pandas as pd

from .numbers import _round


def value_asof(series: pd.Series, when: pd.Timestamp,
               tolerance_days: int = 10) -> tuple[float, pd.Timestamp] | None:
    """Most recent observation at or before `when`, with the date it was read.

    The date is returned because the label cannot be trusted without it. A
    provider is asked for a reading seven days back and answers with the
    nearest one it has, which for a month-end feed can be 45 days from the
    date asked for -- so "365-day change" has covered anything from 320 days
    to 410. The caller publishes the date and the elapsed days beside the
    figure rather than leaving the reader to assume the interval in its name.

    None when nothing falls inside the tolerance, which is a different answer
    from a change of zero.
    """
    sub = series[series.index <= when]
    if sub.empty:
        return None
    if (when - sub.index[-1]).days > tolerance_days:
        return None
    return float(sub.iloc[-1]), sub.index[-1]


def monthly_history(series: pd.Series, months: int = 12,
                    climate_months: list | None = None) -> list[dict]:
    """Last `months` calendar months: observed mean/min/max/end + two normals.

    `normal_af` is the median of that same calendar month's mean storage
    across every *earlier* year in the record, which is what makes the
    dashboard's 12-month chart readable as "above or below normal" rather
    than just "up or down".

    `climate_normal_af` is the same statistic over 1991-2020, read from the
    committed table. Both are published for every month so the chart can
    switch between them without refetching, and so the difference between them
    is visible rather than being a claim the reader has to take on trust.
    """
    if series.empty:
        return []

    by_month = series.resample("MS").agg(["mean", "min", "max", "last", "count"])
    monthly_means = by_month["mean"]

    out = []
    for period, row in by_month.tail(months).iterrows():
        same_month = monthly_means[monthly_means.index.month == period.month]
        prior_years = same_month[same_month.index.year < period.year].dropna()
        normal = float(prior_years.median()) if not prior_years.empty else None
        climate = (climate_months[period.month]
                   if climate_months and period.month < len(climate_months)
                   else None)
        out.append({
            "month": period.strftime("%Y-%m"),
            "mean_af": _round(row["mean"]),
            "min_af": _round(row["min"]),
            "max_af": _round(row["max"]),
            "end_af": _round(row["last"]),
            "days": int(row["count"]) if not pd.isna(row["count"]) else 0,
            "normal_af": _round(normal),
            "climate_normal_af": _round(climate),
        })
    return out
