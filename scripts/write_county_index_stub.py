import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
url = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?"
    + urllib.parse.urlencode(
        {"where": "STATE='06'", "outFields": "GEOID,NAME", "f": "geojson", "outSR": 4326}
    )
)
counties = json.load(urllib.request.urlopen(url, timeout=60))
(DATA / "ca-counties.geojson").write_text(json.dumps(counties), encoding="utf-8")
entries = [
    {
        "fips": feature["properties"]["GEOID"],
        "name": feature["properties"]["NAME"],
        "shortName": feature["properties"]["NAME"].replace(" County", ""),
        "latestZhvi": None,
        "zipCount": 0,
        "campusLabel": "",
    }
    for feature in counties["features"]
]
index = {"counties": sorted(entries, key=lambda item: item["name"]), "defaultFips": "06079"}
(DATA / "ca-county-index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
print(f"Wrote {len(entries)} counties")
