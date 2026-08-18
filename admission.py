"""Decide if a candidate reservoir can be published.

A candidate is a storage station in one of our drainage areas that the
dashboard does not track yet. To publish it, we must know how much water it
holds now and how much it holds when it is full. The providers give us the
first number. They do not give us the second. We take the second from the
National Inventory of Dams, which is a different dataset, from a different
agency, with different names for the same dams.

That join is the risk. If we attach the wrong dam to a reservoir, nothing
fails. The map draws a circle, the totals add up, and the number is wrong.
So this module does the join with rules that can be tested, and it records
the evidence for each decision.

Two rules, in this order:

1. Confirm the dam by its position, then by its name. Two dams can share a
   name. Two dams cannot share a location.
2. Compare the storage we have seen against the storage the dam can hold.
   Reject the match only if the reservoir holds more water than the dam can
   contain, because that means we matched the wrong dam.

Standard library only, and no network. The caller reads the dam records; this
module only decides. See ADR-015 for why the rules are these rules, and
docs/PHASE-1.6-PLAN.md for the measurements they come from.
"""

import math
import re

# How close a dam must be for its position alone to confirm it, in kilometres.
#
# Measured: 30 of the 34 candidate stations sit within 1.4 km of their dam,
# because a storage gauge is installed at the dam or the outlet. At that range
# a second dam is not a realistic possibility, so the name does not have to
# agree -- and it often does not. The inventory calls Wolford Mountain
# Reservoir "Ritschard".
NEAR_RADIUS_KM = 2.0

# How far away a dam may be when the name agrees as well.
#
# Some published points describe the water, not the dam. Measured against the
# 29 reservoirs whose dam is already confirmed by its inventory identifier,
# the distance from the point to its own dam runs from 0.01 km to 20.87 km:
# Lake Powell 20.87 km, Flaming Gorge 14.50 km, Strawberry 9.59 km, and Lake
# Granby's gauge is 3.85 km from Granby Dam. One small radius would refuse six
# matches that are known to be right. Two pieces of weaker evidence, name and
# position, are accepted together where either alone would not be enough.
NAMED_RADIUS_KM = 25.0

# How much more water than the published figure a reservoir may hold when the
# inventory gives no maximum pool.
#
# Reservoirs are operated a little above the conservation pool. Where the
# inventory gives a maximum pool, that is a real ceiling and no allowance is
# needed. Where it gives none, the only figure available describes the normal
# level, so a small allowance keeps a reservoir that sits just above it from
# being read as a wrong dam. Measured: Stagecoach Reservoir holds 36,474
# acre-feet against a conservation pool of 36,439, which is 35 acre-feet more,
# or one part in a thousand.
CONSERVATION_ALLOWANCE = 0.02

EARTH_RADIUS_KM = 6371.0088

_NOISE = re.compile(r"\b(reservoir|lake|dam|and|powerplant|no|number|res|nr)\b", re.I)


def normalize_name(name):
    """Reduce a name to the part two agencies are likely to agree on."""
    return re.sub(r"[^a-z0-9]+", "", _NOISE.sub(" ", name or "").lower())


def distance_km(a, b):
    """Great-circle distance between two (longitude, latitude) points."""
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    half = (math.sin((lat2 - lat1) / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(half))


class Match:
    """One dam, and how we know it is the right one."""

    def __init__(self, dam, distance, confirmed_by):
        self.dam = dam
        self.distance_km = distance
        self.confirmed_by = confirmed_by

    def __repr__(self):
        return (f"Match({self.dam.get('name')!r}, {self.distance_km:.2f} km, "
                f"{self.confirmed_by})")


class Decision:
    """The answer for one candidate, with the evidence that produced it."""

    def __init__(self, name, admitted, reason, match=None,
                 capacity_af=None, capacity_basis=None):
        self.name = name
        self.admitted = admitted
        self.reason = reason
        self.match = match
        self.capacity_af = capacity_af
        self.capacity_basis = capacity_basis

    def evidence(self):
        """A record of the decision, for the published capacity table."""
        if not self.match:
            return {"name": self.name, "admitted": self.admitted, "reason": self.reason}
        dam = self.match.dam
        return {
            "name": self.name,
            "admitted": self.admitted,
            "reason": self.reason,
            "capacity_af": self.capacity_af,
            "capacity_basis": self.capacity_basis,
            "normal_storage_af": positive(dam.get("normal_storage_af")),
            "max_storage_af": positive(dam.get("max_storage_af")),
            "nid_storage_af": positive(dam.get("nid_storage_af")),
            "nid_id": dam.get("nid_id"),
            "nid_dam_name": dam.get("name"),
            "dam_lon": dam.get("lon"),
            "dam_lat": dam.get("lat"),
            "match_distance_km": round(self.match.distance_km, 3),
            "match_confirmed_by": self.match.confirmed_by,
        }

    def __repr__(self):
        return f"Decision({self.name!r}, admitted={self.admitted}, {self.reason!r})"


def positive(value):
    """The inventory writes an unknown storage figure as zero or as a blank."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def find_dam(point, name, dams, plausible=None):
    """Find the dam for a reservoir, by position first and by name second.

    A dam is confirmed two ways. It is near enough that nothing else could be
    the dam, or it is further away and named the same. Anything weaker than
    both is refused; see the constants above for the measurements.

    `plausible` is an optional test the caller applies to a candidate before
    distance is considered at all -- for "could this structure hold the water
    we have watched this reservoir hold?". It exists because position alone
    picks the nearest *thing*, not the nearest dam: Huntington North has a
    Pacificorp settling pond 0.29 km from its gauge holding 360 acre-feet,
    and its own dam 13.49 km away holding 5,420, against 4,259 acre-feet this
    project has actually observed in the reservoir. Without the test the pond
    wins on position and the answer is confidently wrong.

    Returns a Match, or None when no dam is close enough to be sure.
    """
    if not dams:
        return None
    wanted = normalize_name(name)
    measured = sorted(((distance_km(point, (dam["lon"], dam["lat"])), dam) for dam in dams
                       if dam.get("lon") is not None and dam.get("lat") is not None),
                      key=lambda pair: pair[0])
    if plausible is not None:
        measured = [pair for pair in measured if plausible(pair[1])]
    if not measured:
        return None

    # Position is the primary evidence. A matching name outside this radius
    # must never override a structure at the gauge.
    near = [(distance, dam) for distance, dam in measured if distance <= NEAR_RADIUS_KM]
    if near:
        # Among structures that are all near enough to be the dam, a matching
        # name says which one. Hyrum's gauge has Hyrum Dike 0.93 km away and
        # Hyrum Dam 1.06 km; both are the same impoundment and hold the same
        # water, and the dam is the structure this project means. Where no
        # near name agrees the nearest still wins, which is the previous
        # behaviour and the measured one.
        named_near = [pair for pair in near
                      if normalize_name(pair[1].get("name")) == wanted]
        if named_near:
            distance, dam = named_near[0]
            return Match(dam, distance, "name and position")
        distance, dam = near[0]
        return Match(dam, distance, "position")

    # Name is a fallback only for provider points placed on the water rather
    # than at the outlet. At that range both pieces of evidence are required.
    named = [(distance, dam) for distance, dam in measured
             if normalize_name(dam.get("name")) == wanted and distance <= NAMED_RADIUS_KM]
    if named:
        distance, dam = named[0]
        return Match(dam, distance, "name and position")
    return None


def capacity_of(dam):
    """The number to divide by, and which figure it is.

    The conservation pool is what an operator means by "full", so it is
    preferred. The maximum pool includes water held back in a flood and is
    used only when there is no conservation figure. The inventory's own
    headline figure is the last resort. See ADR-003.
    """
    normal = positive(dam.get("normal_storage_af"))
    if normal:
        return normal, "normal_storage"
    maximum = positive(dam.get("max_storage_af"))
    if maximum:
        return maximum, "max_storage"
    headline = positive(dam.get("nid_storage_af"))
    if headline:
        return headline, "nid_storage"
    return None, None


def holds_more_than_the_dam(dam, observed_max_af):
    """True when the reservoir has held more water than the dam can contain.

    This is the test that finds a wrong match. Compare against the maximum
    pool, which is the most water the structure holds and is a real ceiling.

    Where the inventory publishes no maximum pool, the remaining figures
    describe the normal level, so they get the small allowance above. The
    inventory's headline figure is treated the same way: for Stagecoach
    Reservoir it simply repeats the conservation pool, so reading it as a
    ceiling would refuse the reservoir over 35 acre-feet.
    """
    if observed_max_af is None:
        return False
    maximum = positive(dam.get("max_storage_af"))
    if maximum:
        return observed_max_af > maximum
    others = [value for value in (positive(dam.get("nid_storage_af")),
                                  positive(dam.get("normal_storage_af"))) if value]
    if others:
        return observed_max_af > max(others) * (1 + CONSERVATION_ALLOWANCE)
    return False


def could_hold(dam, observed_max_af):
    """A lenient screen for choosing between candidate structures.

    Deliberately not `holds_more_than_the_dam`, which is the strict ceiling
    used to *accept* a match once it is found. This is the weaker question
    asked while there are still several candidates: could this structure be
    the one, at all?

    The difference is not academic. Echo has been observed holding 74,791
    acre-feet against a maximum pool of 73,940, which is 1.2% over -- the
    strict test refuses it, and the reviewed capacity table accepts it,
    because reservoirs are operated a little above their pools. Using the
    strict test to choose between candidates therefore throws away the right
    dam and settles for whatever is left, which is how Trial Lake ends up
    matched to Washington Lake Dam.

    So every figure gets the same small allowance here, including a real
    maximum pool. A structure still has to be in the right order of
    magnitude: Huntington North's gauge has a settling pond 0.29 km away
    holding 360 acre-feet, and no allowance makes that a reservoir seen
    holding 4,259.
    """
    if not observed_max_af:
        return True
    figures = [value for value in (positive(dam.get("max_storage_af")),
                                   positive(dam.get("nid_storage_af")),
                                   positive(dam.get("normal_storage_af"))) if value]
    if not figures:
        return True
    return max(figures) * (1 + CONSERVATION_ALLOWANCE) >= observed_max_af


def admit(candidate, dams):
    """Decide one candidate.

    `candidate` needs a `name`, a `lon`, a `lat` and an `observed_max_af`.
    Each dam needs a `name`, a `lon`, a `lat` and at least one storage figure.
    """
    name = candidate["name"]
    observed = candidate.get("observed_max_af")
    if not observed:
        return Decision(name, False, "no storage series")

    # The lenient screen is applied while choosing, not after. Applied after,
    # the wrong structure has already won on position, and the strict ceiling
    # below then refuses the *candidate* -- "holds more water than the dam
    # can contain" -- when the truth is that its real dam sits further out.
    point = (candidate["lon"], candidate["lat"])
    match = find_dam(point, name, dams,
                     plausible=lambda dam: could_hold(dam, observed))
    if not match:
        # Asked again without the screen, for the honest refusal: a
        # structure at the gauge that could not hold the water is a
        # different fact from no structure at all, and the audit's refusal
        # buckets read the difference.
        undersized = find_dam(point, name, dams)
        if undersized:
            return Decision(
                name, False,
                f"holds more water than the dam can contain "
                f"({observed:,.0f} acre-feet seen)", undersized)
        return Decision(name, False, "no dam close enough to confirm")

    capacity, basis = capacity_of(match.dam)
    if not capacity:
        return Decision(name, False, "the matched dam publishes no storage figure", match)

    if holds_more_than_the_dam(match.dam, observed):
        return Decision(
            name, False,
            f"holds more water than the dam can contain "
            f"({observed:,.0f} acre-feet seen)", match)

    return Decision(name, True, f"confirmed by {match.confirmed_by}", match,
                    capacity, basis)


def admit_all(candidates, dams):
    """Decide every candidate. Order is kept, so the output can be reviewed."""
    return [admit(candidate, dams) for candidate in candidates]
