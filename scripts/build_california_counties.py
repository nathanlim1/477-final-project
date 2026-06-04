"""Build California county map bundles from Zillow ZIP data and Census TIGERweb."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
COUNTIES_DIR = DATA / "counties"

ZIP_ZHVI_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "Zip_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv"
)
ZIP_ZORI_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv"
)
COUNTY_ZHVI_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "County_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv"
)
CA_COUNTIES_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?"
    + urllib.parse.urlencode(
        {"where": "STATE='06'", "outFields": "GEOID,NAME", "f": "geojson", "outSR": 4326}
    )
)
TIGER_ZCTA = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/2/query"
)
TIGER_BG = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/10/query"
)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MIN_DATE = date(2016, 4, 30)


def fetch_json(url: str, retries: int = 4) -> dict:
    """Fetch JSON from a URL with simple retries."""

    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=180) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as error:  # noqa: PERF203
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}") from last_error


def download_csv(url: str, destination: Path) -> Path:
    """Download a CSV if it is missing or empty."""

    if destination.exists() and destination.stat().st_size > 1000:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, destination)
    return destination


def melt_zillow(path: Path, state_filter: str = "CA") -> pd.DataFrame:
    """Melt a wide Zillow ZIP or county CSV into long format."""

    frame = pd.read_csv(path, low_memory=False)
    frame = frame[frame["State"] == state_filter].copy()
    date_columns = [column for column in frame.columns if DATE_RE.match(str(column))]
    long_frame = frame.melt(
        id_vars=[column for column in frame.columns if column not in date_columns],
        value_vars=date_columns,
        var_name="date",
        value_name="value",
    )
    long_frame["date"] = pd.to_datetime(long_frame["date"]).dt.strftime("%Y-%m-%d")
    long_frame["value"] = pd.to_numeric(long_frame["value"], errors="coerce")
    long_frame = long_frame[long_frame["value"].notna()]
    long_frame = long_frame[pd.to_datetime(long_frame["date"]).dt.date >= MIN_DATE]
    return long_frame


def county_lookup(counties_geojson: dict) -> dict[str, str]:
    """Map normalized county names to 5-digit FIPS codes."""

    lookup: dict[str, str] = {}
    for feature in counties_geojson["features"]:
        fips = feature["properties"]["GEOID"]
        name = feature["properties"]["NAME"]
        lookup[normalize_county_name(name)] = fips
    return lookup


def normalize_county_name(name: str) -> str:
    """Return a county name without the trailing County suffix."""

    return str(name).replace(" County", "").strip()


def chunked(values: list[str], size: int) -> list[list[str]]:
    """Split a list into fixed-size chunks."""

    return [values[index : index + size] for index in range(0, len(values), size)]


def fetch_features_paginated(base_url: str, params: dict) -> list[dict]:
    """Fetch all features from an ArcGIS query endpoint."""

    features: list[dict] = []
    offset = 0
    while True:
        query = {**params, "resultOffset": offset, "resultRecordCount": 1000, "f": "geojson", "outSR": 4326}
        payload = fetch_json(f"{base_url}?{urllib.parse.urlencode(query)}")
        batch = payload.get("features", [])
        if not batch:
            break
        features.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return features


def fetch_zctas(zctas: list[str]) -> dict[str, dict]:
    """Fetch ZCTA geometries for a list of ZCTA codes."""

    features_by_zcta: dict[str, dict] = {}
    for batch in chunked(sorted(set(zctas)), 40):
        where = "ZCTA5 IN ({})".format(",".join(f"'{zcta}'" for zcta in batch))
        params = {
            "where": where,
            "outFields": "ZCTA5,GEOID,NAME,AREALAND,INTPTLAT,INTPTLON",
        }
        for feature in fetch_features_paginated(TIGER_ZCTA, params):
            zcta = feature["properties"]["ZCTA5"]
            features_by_zcta[zcta] = feature
    return features_by_zcta


def county_background_features(counties_geojson: dict) -> dict[str, list[dict]]:
    """Use county polygons as the neutral map background for each county bundle."""

    return {feature["properties"]["GEOID"]: [feature] for feature in counties_geojson["features"]}


def assign_zip_counties(zip_frame: pd.DataFrame, county_name_lookup: dict[str, str]) -> pd.Series:
    """Assign each ZIP row to a county FIPS using Zillow's CountyName field."""

    def to_fips(county_name: str) -> str | None:
        if pd.isna(county_name):
            return None
        normalized = normalize_county_name(str(county_name))
        return county_name_lookup.get(normalized)

    return zip_frame["CountyName"].map(to_fips)


def build_zip_housing(
    county_fips: str,
    county_name: str,
    zips: list[str],
    zhvi_long: pd.DataFrame,
    zori_long: pd.DataFrame,
    zcta_features: dict[str, dict],
) -> list[dict[str, object]]:
    """Build housing rows for one county."""

    zhvi = zhvi_long[zhvi_long["RegionName"].astype(str).str.zfill(5).isin(zips)].copy()
    zori = zori_long[zori_long["RegionName"].astype(str).str.zfill(5).isin(zips)].copy()
    zhvi["zcta"] = zhvi["RegionName"].astype(str).str.zfill(5)
    zori["zcta"] = zori["RegionName"].astype(str).str.zfill(5)

    zori_lookup = {
        (row["zcta"], row["date"]): row["value"]
        for _, row in zori.iterrows()
    }

    rows: list[dict[str, object]] = []
    for _, record in zhvi.iterrows():
        zcta = record["zcta"]
        city = str(record.get("City") or zcta).strip() or zcta
        place = f"{zcta} {city}"
        zori_value = zori_lookup.get((zcta, record["date"]))
        blended_rent = round(float(zori_value)) if zori_value is not None else ""
        rent_source = "Zillow ZORI" if zori_value is not None else ""
        feature = zcta_features.get(zcta, {})
        properties = feature.get("properties", {})
        latitude = float(str(properties.get("INTPTLAT", record.get("Latitude") or 0)).replace("+", ""))
        longitude = float(str(properties.get("INTPTLON", record.get("Longitude") or 0)).replace("+", ""))
        rows.append(
            {
                "place": place,
                "kind": "zcta",
                "zcta": zcta,
                "city": city,
                "latitude": latitude,
                "longitude": longitude,
                "zhvi": round(float(record["value"])),
                "zori": round(float(zori_value)) if zori_value is not None else "",
                "date": record["date"],
                "label_dx": 10,
                "label_dy": 0,
                "note": (
                    f"Zillow ZIP-level market for {city}; mapped with Census 2020 ZCTA {zcta} "
                    f"in {county_name}."
                ),
                "hudSafmr": "",
                "blendedRent": blended_rent,
                "rentSource": rent_source,
                "hudFiscalYear": "",
            }
        )
    return rows


def write_geojson(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": features}, handle)


def build_county_index(
    counties_geojson: dict,
    county_zhvi_long: pd.DataFrame,
    county_zip_counts: dict[str, int],
    campuses: pd.DataFrame,
) -> dict:
    """Build the county navigation index."""

    latest_by_region = (
        county_zhvi_long.sort_values("date")
        .groupby("RegionName", as_index=False)
        .tail(1)
        .set_index("RegionName")
    )
    campus_labels = (
        campuses.groupby("county_fips")["short_label"]
        .apply(lambda labels: ", ".join(labels.head(2)))
        .to_dict()
    )
    entries = []
    for feature in sorted(counties_geojson["features"], key=lambda item: item["properties"]["NAME"]):
        fips = feature["properties"]["GEOID"]
        name = feature["properties"]["NAME"]
        region_id = str(int(fips))
        latest = latest_by_region.loc[region_id]["value"] if region_id in latest_by_region.index else None
        entries.append(
            {
                "fips": fips,
                "name": name,
                "shortName": normalize_county_name(name),
                "latestZhvi": round(float(latest)) if latest is not None else None,
                "zipCount": county_zip_counts.get(fips, 0),
                "campusLabel": campus_labels.get(fips, ""),
            }
        )
    return {"counties": entries, "defaultFips": "06079"}


def preserve_slo_bundle() -> None:
    """Copy the curated San Luis Obispo bundle if a generated one is not requested."""

    destination = COUNTIES_DIR / "06079"
    if (destination / "zip-housing.csv").exists():
        return
    destination.mkdir(parents=True, exist_ok=True)
    shutil = __import__("shutil")
    for filename, source_name in {
        "bg.geojson": "slo-bg.geojson",
        "zctas.geojson": "slo-zctas.geojson",
        "zip-housing.csv": "slo-zip-housing.csv",
    }.items():
        shutil.copy2(DATA / source_name, destination / filename)


def run_build(selected: set[str] | None, skip_tiger: bool) -> None:
    cache_dir = ROOT / ".cache" / "zillow"
    cache_dir.mkdir(parents=True, exist_ok=True)

    counties_geojson = fetch_json(CA_COUNTIES_URL)
    write_geojson(DATA / "ca-counties.geojson", counties_geojson["features"])
    county_name_lookup = county_lookup(counties_geojson)

    zhvi_long = melt_zillow(download_csv(ZIP_ZHVI_URL, cache_dir / "zip_zhvi.csv"))
    zori_long = melt_zillow(download_csv(ZIP_ZORI_URL, cache_dir / "zip_zori.csv"))
    county_zhvi_long = melt_zillow(download_csv(COUNTY_ZHVI_URL, cache_dir / "county_zhvi.csv"))

    zhvi_long["zcta"] = zhvi_long["RegionName"].astype(str).str.zfill(5)
    zhvi_long["county_fips"] = assign_zip_counties(zhvi_long, county_name_lookup)
    zhvi_long = zhvi_long[zhvi_long["county_fips"].notna()].copy()

    zips_by_county: dict[str, list[str]] = (
        zhvi_long.groupby("county_fips")["zcta"].apply(lambda values: sorted(set(values))).to_dict()
    )

    all_zctas = sorted({zcta for zctas in zips_by_county.values() for zcta in zctas})
    print(f"Fetching {len(all_zctas)} ZCTA boundaries from Census TIGERweb...")
    zcta_features = {} if skip_tiger else fetch_zctas(all_zctas)
    block_groups_by_county = county_background_features(counties_geojson)
    print("Prepared county background polygons.")

    campuses = pd.read_csv(DATA / "ca-campuses.csv", dtype={"county_fips": str})
    campuses["county_fips"] = campuses["county_fips"].str.zfill(5)

    for feature in counties_geojson["features"]:
        fips = feature["properties"]["GEOID"]
        if selected and fips not in selected:
            continue
        county_name = feature["properties"]["NAME"]
        zips = zips_by_county.get(fips, [])
        county_dir = COUNTIES_DIR / fips
        county_dir.mkdir(parents=True, exist_ok=True)

        if fips == "06079" and (DATA / "slo-zip-housing.csv").exists():
            preserve_slo_bundle()
            print(f"Preserved curated bundle for {county_name}")
            continue

        if not zips:
            print(f"Skipping {county_name}: no ZIP markets")
            continue

        housing_rows = build_zip_housing(fips, county_name, zips, zhvi_long, zori_long, zcta_features)
        default_places = sorted({row["place"] for row in housing_rows})
        housing_path = county_dir / "zip-housing.csv"
        with housing_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(housing_rows[0].keys()))
            writer.writeheader()
            writer.writerows(housing_rows)

        zcta_features_for_county = []
        for zcta in zips:
            feature = zcta_features.get(zcta)
            if not feature:
                continue
            place = next(row["place"] for row in housing_rows if row["zcta"] == zcta)
            enriched = {
                **feature,
                "properties": {
                    **feature["properties"],
                    "zcta": zcta,
                    "place": place,
                    "name": feature["properties"].get("NAME", f"ZCTA5 {zcta}"),
                },
            }
            zcta_features_for_county.append(enriched)
        write_geojson(county_dir / "zctas.geojson", zcta_features_for_county)

        write_geojson(county_dir / "bg.geojson", block_groups_by_county.get(fips, [feature]))

        meta = {
            "fips": fips,
            "name": county_name,
            "defaultPlace": default_places[0] if default_places else "",
            "places": default_places,
        }
        with (county_dir / "meta.json").open("w", encoding="utf-8") as handle:
            json.dump(meta, handle, indent=2)

        print(f"Built {county_name}: {len(zips)} ZIP markets, {len(housing_rows)} rows")

    index = build_county_index(counties_geojson, county_zhvi_long, {fips: len(zips) for fips, zips in zips_by_county.items()}, campuses)
    with (DATA / "ca-county-index.json").open("w", encoding="utf-8") as handle:
        json.dump(index, handle, indent=2)

    county_housing = county_zhvi_long.copy()
    county_housing["fips"] = county_housing["RegionName"].astype(str).str.zfill(5)
    county_housing = county_housing.rename(columns={"value": "zhvi", "date": "date"})
    county_housing[["fips", "date", "zhvi"]].to_csv(DATA / "ca-county-housing.csv", index=False)

    print(f"Wrote {DATA / 'ca-counties.geojson'}")
    print(f"Wrote {DATA / 'ca-county-index.json'}")
    print(f"Wrote {DATA / 'ca-county-housing.csv'}")


def parse_args() -> argparse.Namespace:
    """Parse command line arguments for the county data build."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--counties",
        nargs="*",
        help="Optional county FIPS codes to build (defaults to all counties)",
    )
    parser.add_argument(
        "--skip-tiger",
        action="store_true",
        help="Skip TIGER geometry downloads (debug only)",
    )
    return parser.parse_args()


def main() -> None:
    """Run the county data build from command line arguments."""

    args = parse_args()
    selected = {value.zfill(5) for value in args.counties} if args.counties else None
    preserve_slo_bundle()
    run_build(selected, args.skip_tiger)
    print("California county build complete.", flush=True)


if __name__ == "__main__":
    main()
