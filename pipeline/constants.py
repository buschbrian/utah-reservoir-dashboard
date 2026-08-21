"""Every constant the reservoir pipeline is configured by, and today's date.

Paths, thresholds, schema and method versions, the reviewed source-coverage
table, and the two rosters that predate the reviewed admission files. Nothing
here fetches, computes or decides; it is the set of numbers and names the rest
of the pipeline is measured against, in one place so that changing one is a
visible, reviewable act.

Two of them are load-bearing in a way their type does not show:
`METHOD_VERSION` names the estimator behind the derived numbers and
`RESERVOIR_SCHEMA_VERSION` names the shape of the file carrying them. They are
not interchangeable -- see docs/architecture/hydrology-methods.md.
"""

from pathlib import Path

import pandas as pd


#: The repository root, which is one level above this package.
#:
#: Every committed file below is named relative to it. It used to be
#: `Path(__file__).parent` from a script that lived at the root; the paths
#: mean the same thing and are now written from a root that does not move when
#: a module does.
ROOT = Path(__file__).resolve().parent.parent

RISE_RESULT_URL = "https://data.usbr.gov/rise/api/result"
AWDB_DATA_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
START_DATE = "20150101"
SEASONAL_WINDOW_DAYS = 7
OUTPUT_PATH = ROOT / "reservoirs.json"
CAPACITY_PATH = ROOT / "capacities.json"
ADMITTED_RESERVOIRS_PATH = ROOT / "admitted_reservoirs.json"
ADMITTED_RISE_RESERVOIRS_PATH = ROOT / "admitted_rise_reservoirs.json"
ADMITTED_CDEC_RESERVOIRS_PATH = ROOT / "admitted_cdec_reservoirs.json"
ADMITTED_CDSS_RESERVOIRS_PATH = ROOT / "admitted_cdss_reservoirs.json"
NORMALS_PATH = ROOT / "normals.json"
COUNTIES_PATH = ROOT / "counties.json"
EXPORT_PATH = ROOT / "reference.json"

# A reservoir whose newest observation is older than this many days is
# flagged is_stale and called out in the run log and in the dashboards.
# 2 days is deliberately tight: RISE normally publishes through yesterday,
# so anything past "yesterday, plus a day of slack" is a real signal.
STALE_AFTER_DAYS = 2
AWDB_MONTHLY_STALE_AFTER_DAYS = 45

#: What this site does not read, state by state.
#:
#: Two federal programmes cover the large federal projects well and cover
#: everything else unevenly, so "the reservoirs this site tracks" and "the
#: stored water in this state" are different quantities -- in Colorado and
#: California they are very different. A dashboard that shows the first and
#: lets a reader take it for the second is not wrong in any single number and
#: is misleading as a whole.
#:
#: The counts beside these come from the payload itself; this is the part a
#: payload cannot know. Reviewed in `docs/WESTERN-SOURCE-CANDIDATES.md`, where
#: every endpoint below was fetched live rather than taken from documentation,
#: and re-reviewed when a provider is added. `status` is one of:
#:
#:   "more to add"        a usable public feed exists and is not read yet
#:   "not machine readable"  the data is published, but not in a usable form
#:   "none found"         the review looked for another source and found none
#:
#: "none found" is not "complete". It is the honest limit of a search.
SOURCE_COVERAGE_REVIEWED = "2026-08-21"
SOURCE_COVERAGE = {
    "CO": {"status": "more to add",
           "source": "Colorado Division of Water Resources",
           "url": "https://dwr.state.co.us/rest/get/help",
           "adds_about": 95,
           "note": "Read since 2026-08-21 for the ten storage stations inside "
                   "the drawn drainages. About 95 further reservoirs report "
                   "on the eastern slope, whose drainages reach the "
                   "Mississippi basin and are not drawn."},
    "CA": {"status": "more to add",
           "source": "California Data Exchange Center",
           "url": "https://cdec.water.ca.gov/",
           "adds_about": None,
           "note": "Read since 2026-08-20. The candidates admitted over or "
                   "held behind a screen are named, with their findings, in "
                   "admitted_cdec_reservoirs.json."},
    "MT": {"status": "more to add",
           "source": "U.S. Army Corps of Engineers water management",
           "url": "https://water.usace.army.mil/",
           "adds_about": None,
           "note": "Covers the large Missouri River reservoirs. The state's "
                   "own 22 dams publish no combined feed."},
    "AZ": {"status": "not machine readable",
           "source": "Salt River Project daily water report",
           "url": "https://streamflow.watershedconnection.com/dwr",
           "adds_about": 6,
           "note": "Six reservoirs are published as a web page only, and for "
                   "several of them it is the only current source."},
    "UT": {"status": "none found", "source": None, "url": None,
           "adds_about": None,
           "note": "No other public source of current storage was found."},
    "WY": {"status": "none found", "source": None, "url": None,
           "adds_about": None,
           "note": "The state water service was found to republish federal "
                   "readings rather than add its own."},
    "ID": {"status": "none found", "source": None, "url": None,
           "adds_about": None,
           "note": "The state water department points every reservoir at a "
                   "federal source."},
    "OR": {"status": "none found", "source": None, "url": None,
           "adds_about": None,
           "note": "The state water department publishes no feed a program "
                   "can read."},
    "WA": {"status": "none found", "source": None, "url": None,
           "adds_about": None,
           "note": "No independent state source was found."},
    "NV": {"status": "none found", "source": None, "url": None,
           "adds_about": None,
           "note": "No state source of reservoir storage was found. The "
                   "search was not exhaustive."},
    "NM": {"status": "none found", "source": None, "url": None,
           "adds_about": None,
           "note": "The state water office publishes stream measurements "
                   "rather than reservoir storage."},
}

# A reservoir whose newest observation is older than this many days is
# withdrawn from the payload entirely rather than published as stale.
#
# Being late and being from another season are different faults, and the
# second one is not fixed by a label. `carry_forward` keeps publishing the
# last known value because a point vanishing from the map with no explanation
# is worse than a point that says it is a few days behind -- that is right,
# and it stays right, for a gap measured in days.
#
# It stops being right somewhere before two months. A May reading standing in
# an August column is not a late measurement of August, it is an accurate
# measurement of spring, and the difference between those is most of the melt.
# Storage here is strongly seasonal: it is the same reason the seasonal
# normal compares a date against the same date in prior years instead of
# against an annual mean. Worse, `statewideRollup` sums `current_storage_af`
# across the scope with no freshness filter, so a carried-forward spring
# figure is not merely displayed out of season, it is added into a regional
# total presented as now.
#
# 60 days rather than a strict calendar two months because the threshold has
# to clear a month-end feed that has missed one publication: such a feed can
# legitimately reach about 45 days (AWDB_MONTHLY_STALE_AFTER_DAYS) before
# anything is wrong, and 60 leaves it room without letting a whole season
# through. ADR-056.
WITHDRAW_AFTER_DAYS = 60

# Which baseline the site opens on.
#
# "climate" is the 1991-2020 standard, and it is the default because the
# alternative was never a choice anybody made: the recent baseline exists only
# because START_DATE is 2015, and 2015 onward is the driest stretch in the
# modern record here. A reservoir measured against it is measured against the
# drought, so a bad year reads as ordinary. The snowpack half of the site has
# always used 1991-2020, so this also makes one dashboard use one definition
# of normal. Change this one constant to open on the recent baseline instead;
# both are published either way and the reader can switch.
DEFAULT_BASELINE = "climate"

# A baseline built from fewer than this many calendar years is published with
# its year count, but is not offered as the default for that reservoir. Ten
# years is where a median stops being a description of one decade's weather.
MIN_BASELINE_YEARS = 10

# Version of the reference export's shape, not of the numbers in it. It is
# here so a reader that finds a payload it does not understand can say so
# instead of quietly rendering half of it.
#
# 3 since ADR-066: `capacity_catalog.capacities` is keyed by the station id
# every reservoir record already publishes as `source_station_id`, and was
# keyed by the reservoir's name. That is a break, and it is versioned rather
# than slipped in -- a name cannot key a roster that holds two Lost Creeks,
# and a consumer indexing by name should be told rather than left to find a
# key it knows has quietly become a different reservoir's.
#
# 4 since ADR-067: `geography.state` is gone. No page draws a mask from it
# any more, and a reader still expecting the field should be told rather than
# handed a payload that silently stopped carrying one.
EXPORT_SCHEMA_VERSION = 4
RESERVOIR_SCHEMA_VERSION = 1

#: The estimator behind the derived numbers, separate from the shape of the
#: file carrying them. `tools/build_normal_baselines.py` publishes the same
#: string for the committed climate normals, and the two must agree: the
#: whole point of publishing both baselines is that a reader can compare them,
#: and two medians taken different ways are not a comparison.
#:
#: "-1" was the same annual estimator on `dayofyear`, where a calendar date
#: took two different positions depending on whether its year was a leap year.
#: "-2" matches on `canonical_day`, so a window centred on 19 August holds
#: every 19 August.
#: "-3" attributes each reading the year-end wrap keeps to the window
#: instance it is evidence about, so a vote near 1 January is one winter --
#: grouping by calendar year had medianed a year's early-January readings
#: with its late-December ones, two winters about 360 days apart in one vote.
METHOD_VERSION = "storage-normal-annual-3"

# name -> (RISE catalog-item id for "Daily Instantaneous Lake/Reservoir
# Storage (af)", lat, lon). The first 12 item IDs and the seasonal/record-max
# methodology come directly from Brian's original notebook
# (~/Developer/mtnwest-geo/reservoir_levels.ipynb); the other 16 were
# rediscovered via the same RISE location -> catalogRecord -> catalogItem
# walk documented there, filtered to stateId=UT, types=Reservoir, and
# parameterName == "Lake/Reservoir Storage" -- since that mapping was never
# committed anywhere despite the 28-reservoir statewide expansion using it.
#
# IMPROVEMENT: this mapping is hand-maintained and has no verification step.
# If Reclamation retires a catalog item (which is one of the plausible
# explanations for a reservoir going permanently stale), this dict keeps
# happily requesting a dead id and gets an empty series back forever. Worth
# adding a weekly job that re-walks location -> catalogRecord -> catalogItem
# for stateId=UT and diffs the discovered ids against this dict.
#
# RISE catalog item id -> (name, latitude, longitude). Keyed by the id and not
# by the name, because a name is not an identity: the west holds a Lost Creek
# in Utah and another in Oregon, 946 km apart, and a name-keyed roster cannot
# hold both -- the second silently becomes the first, with its capacity, its
# climate normal and its link (ADR-066). The id is what the payload already
# publishes as `source_station_id`, and ADR-003 already calls it the stable
# provider identity.
BASE_RISE_RESERVOIRS = {
    "290": ("Deer Creek", 40.43511, -111.50035),
    "468": ("Jordanelle", 40.60689, -111.41655),
    "779": ("Strawberry", 40.16882, -111.1311),
    "706": ("Rockport", 40.77498, -111.39859),
    "314": ("Echo", 40.9574, -111.4179),
    "310": ("East Canyon", 40.91017, -111.59293),
    "652": ("Pineview", 41.26543, -111.80998),
    "866": ("Willard Bay", 41.37738, -112.08339),
    "727": ("Scofield", 39.77656, -111.05074),
    "764": ("Starvation", 40.19324, -110.44722),
    "337": ("Flaming Gorge", 40.97789, -109.57304),
    "509": ("Lake Powell", 37.05778, -111.30332),
    # RISE item 6124, reached by walking location 3514 -> catalog record 4370
    # (Lower Colorado Hydrologic Database) -> its four water-operations items.
    # The `locationId` query filter is ignored by the API and returns an
    # unfiltered page, which is how four Utah reservoirs first came back
    # wearing Lake Mead's name; the walk is the way in (ADR-062).
    #
    # The point is "Lake Mead At Temple Bar", RISE location 3534 -- on the
    # water, like every other published point here. The obvious choice was
    # Hoover Dam, which is what RISE publishes for the *storage* location, and
    # it is the one point on this lake that cannot be used: the dam is the
    # basin outlet, so it sits exactly on the 150100 divide (ADR-062).
    "6124": ("Lake Mead", 36.0467, -114.2733),
    "219": ("Causey", 41.29828, -111.58591),
    "278": ("Currant Creek", 40.33841, -111.05821),
    "432": ("Huntington North", 39.38458, -111.09082),
    "439": ("Hyrum", 41.62117, -111.86099),
    "463": ("Joes Valley", 39.2901, -111.27888),
    "544": ("Lost Creek", 41.18887, -111.39628),
    "574": ("Meeks Cabin", 41.01664, -110.58344),
    "587": ("Moon Lake", 40.57445, -110.50665),
    "623": ("Newton", 41.8998, -111.97562),
    "685": ("Red Fleet", 40.57832, -109.42853),
    "769": ("Stateline", 40.98291, -110.39038),
    "774": ("Steinaker", 40.51456, -109.53275),
    "4516": ("Trial Lake", 40.6799, -110.956839),
    "826": ("Upper Stillwater", 40.56565, -110.70044),
    "4530": ("Washington Lake", 40.6765, -110.964),
    "4523": ("Lost Lake", 40.6741, -110.9413),
    # Wyoming, on the Green above Flaming Gorge. Admitted under the
    # intersect-Utah rule (ADR-009): its dam sits in 140401 Upper Green,
    # one of the fifteen drainage areas that touch the state. It is the
    # only one of Reclamation's five Upper Colorado candidates that
    # qualifies -- the other four drain through basins that never enter
    # Utah. See tools/audit_connected_reservoirs.py.
    "347": ("Fontenelle", 42.05781, -110.09665),
}

# Additional reservoirs in the Utah Division of Water Resources' statewide
# inventory that are not in the RISE set above. AWDB's RESC element is
# reservoir storage volume in acre-feet. Only Utah Lake and Smith and
# Morehouse currently publish a current daily series; the other stations are
# derived monthly values and are deliberately labeled/aged as monthly data.
# Station triplet -> (name, lat, lon, capacity af, cadence). Keyed by the
# triplet for the reason the RISE roster is keyed by its item id: a name is a
# label, not an identity (ADR-066).
BASE_AWDB_RESERVOIRS = {
    "10055500:ID:BOR": ("Bear Lake", 42.11667, -111.30000, 1302000.0, "monthly"),
    "09UTBSWR:UT:BOR": ("Big Sand Wash", 40.30006, -110.22139, 25700.0, "monthly"),
    "09UTCLEV:UT:BOR": ("Cleveland", 39.57758, -111.23896, 5400.0, "monthly"),
    "10UTGTVL:UT:BOR": ("Grantsville", 40.54185, -112.50567, 3300.0, "monthly"),
    "09UTGUNL:UT:BOR": ("Gunlock", 37.25136, -113.77556, 10400.0, "monthly"),
    "10216200:UT:BOR": ("Gunnison", 39.20635, -111.71103, 20300.0, "monthly"),
    "09UTJACK:UT:BOR": ("Jackson Flat", 37.00576, -112.51995, 4083.0, "monthly"),
    "09UTKENS:UT:BOR": ("Ken's Lake", 38.48126, -109.42845, 2300.0, "monthly"),
    "10UTENTL:UT:BOR": ("Lower Enterprise", 37.52601, -113.85091, 2600.0, "monthly"),
    "09UTMILF:UT:BOR": ("Miller Flat", 39.54028, -111.24222, 5200.0, "monthly"),
    "09UTMILL:UT:BOR": ("Millsite", 39.09558, -111.18794, 18061.0, "monthly"),
    "10238500:UT:BOR": ("Minersville", 38.21747, -112.83550, 23300.0, "monthly"),
    "10188000:UT:BOR": ("Otter Creek", 38.17082, -112.02436, 52500.0, "monthly"),
    "10UTPANG:UT:BOR": ("Panguitch", 37.72436, -112.62790, 22300.0, "monthly"),
    "10191000:UT:BOR": ("Piute", 38.32387, -112.19131, 71800.0, "monthly"),
    "10105200:UT:BOR": ("Porcupine", 41.51828, -111.74624, 11300.0, "monthly"),
    "09UTQUAI:UT:BOR": ("Quail Creek", 37.18022, -113.38098, 40000.0, "monthly"),
    "09UTSAND:UT:BOR": ("Sand Hollow", 37.11417, -113.37472, 50000.0, "monthly"),
    "10UT03JJ:UT:BOR": ("Settlement Canyon", 40.51086, -112.29504, 1000.0, "monthly"),
    "10128000:UT:BOR": ("Smith and Morehouse", 40.76202, -111.10338, 8100.0, "daily"),
    "10UTENTU:UT:BOR": ("Upper Enterprise", 37.51939, -113.86197, 10000.0, "monthly"),
    "10166500:UT:BOR": ("Utah Lake", 40.35867, -111.89339, 870900.0, "daily"),
    "10UTWOOD:UT:BOR": ("Woodruff Creek", 41.46666, -111.31838, 4000.0, "monthly"),
    "10020200:WY:BOR": ("Woodruff Narrows", 41.50273, -111.01602, 57300.0, "monthly"),
    "10218500:UT:BOR": ("Yuba", 39.37218, -112.03327, 236000.0, "monthly"),
}

#: The zone "today" is decided in.
#:
#: Not because every reservoir is on Mountain Time -- at western scope they
#: run from Pacific to Central -- but because at the hour this pipeline
#: actually runs, the choice cannot change a single figure. The refresh cron
#: is 12:00 UTC, which is 04:00 Pacific through 06:00 Central: every western
#: zone is on the same calendar date, hours from the nearest boundary, so
#: `local_today()` returns the same day whichever of them is named.
#:
#: That is a property of the schedule rather than of the code, so
#: tests/test_refresh.py asserts it instead of this comment being trusted. A
#: manual run near local midnight is the case it does not cover, and the
#: figure it would move is `days_stale` by one day.
LOCAL_TZ = "America/Denver"

def local_today() -> pd.Timestamp:
    """Today's date in Mountain Time, as a tz-naive midnight timestamp.

    This used to be UTC. Between 18:00 and 24:00 MT, UTC is already tomorrow,
    so an evening run reported every reservoir a day staler than a morning
    run of the same data -- and a reservoir sitting exactly on the threshold
    would flip in and out of `is_stale` purely by clock time. The reservoirs,
    the gages and the readers are all on Mountain Time; the dates RISE
    publishes are local dates, so comparing them against a local today is the
    apples-to-apples version.

    Handles DST automatically via the zoneinfo database, so it does not drift
    the way the workflow's fixed-UTC cron does.
    """
    return pd.Timestamp.now(LOCAL_TZ).normalize().tz_localize(None)
