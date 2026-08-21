"""Rounding and ratios, in the one place that decides how they are done.

Small enough to inline and deliberately not inlined: a percentage computed two
ways is two numbers with one name, and `None` rather than a zero denominator
is the difference between "no reading" and "empty".
"""

import math


def _round(value, places: int = 2):
    """Round for JSON output, mapping NaN/None to null (JSON has no NaN)."""
    if value is None:
        return None
    value = float(value)
    if math.isnan(value) or math.isinf(value):
        return None
    return round(value, places)


def _pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or not denominator:
        return None
    return _round(numerator / denominator * 100, 1)
