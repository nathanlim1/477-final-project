import json
from pathlib import Path

import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "src" / "data"
index = json.loads((DATA / "ca-county-index.json").read_text(encoding="utf-8"))
campuses = pd.read_csv(DATA / "ca-campuses.csv", dtype=str)
labels = campuses.groupby("county_fips")["short_label"].apply(lambda values: ", ".join(values.head(2))).to_dict()
for county in index["counties"]:
    county["campusLabel"] = labels.get(county["fips"], "")
(DATA / "ca-county-index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
print(f"Updated campus labels for {sum(1 for county in index['counties'] if county['campusLabel'])} counties")
