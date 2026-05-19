"""Build blended ZIP rent values from Zillow ZORI and HUD SAFMR workbooks."""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class HudWorkbook:
    """Configuration for a HUD SAFMR workbook."""

    fiscal_year: int
    filename: str


WORKBOOKS = [
    HudWorkbook(2011, "fy2011_equiv_zc_rents_acs.xls"),
    HudWorkbook(2012, "small_area_fmrs_fy2012.xls"),
    HudWorkbook(2013, "small_area_fmrs_fy2013.xls"),
    HudWorkbook(2014, "small_area_fmrs_fy2014.xls"),
    HudWorkbook(2015, "small_area_fmrs_fy2015f.xls"),
    HudWorkbook(2016, "final_fy2016_hypothetical_safmrs.xlsx"),
    HudWorkbook(2017, "FY2017_hypothetical_safmrs.xlsx"),
    HudWorkbook(2018, "fy2018_advisory_safmrs_revised_feb_2018.xlsx"),
    HudWorkbook(2019, "fy2019_safmrs_rev.xlsx"),
    HudWorkbook(2020, "fy2020_safmrs_rev.xlsx"),
    HudWorkbook(2021, "fy2021_safmrs_revised.xlsx"),
    HudWorkbook(2022, "fy2022_safmrs_revised.xlsx"),
    HudWorkbook(2023, "fy2023_safmrs_revised.xlsx"),
    HudWorkbook(2024, "fy2024_safmrs_revised.xlsx"),
    HudWorkbook(2025, "fy2025_safmrs.xlsx"),
    HudWorkbook(2026, "fy2026_safmrs_revised.xlsx"),
]


def normalized_column_name(value: Any) -> str:
    """Return a lowercase alphanumeric key for comparing messy workbook headers."""

    text = str(value).strip().lower()
    return re.sub(r"[^a-z0-9]", "", text)


def fiscal_year_for_date(value: str) -> int:
    """Map a calendar date to the HUD fiscal year that covers it."""

    year_text, month_text, _ = value.split("-", 2)
    year = int(year_text)
    month = int(month_text)
    if month >= 10:
        return year + 1
    return year


def patch_xlsx_core_dates(path: Path, temporary_dir: Path) -> Path:
    """Copy an XLSX and normalize date-only core properties for openpyxl."""

    if path.suffix.lower() != ".xlsx":
        return path

    destination = temporary_dir / path.name
    with zipfile.ZipFile(path, "r") as source_zip:
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as target_zip:
            for item in source_zip.infolist():
                content = source_zip.read(item.filename)
                if item.filename == "docProps/core.xml":
                    text = content.decode("utf-8")
                    text = re.sub(
                        r">(\d{4}-\d{2}-\d{2})<",
                        r">\1T00:00:00Z<",
                        text,
                    )
                    text = re.sub(r"T\s+(\d:)", r"T0\1", text)
                    text = re.sub(r"T\s+(\d{2}:)", r"T\1", text)
                    content = text.encode("utf-8")
                target_zip.writestr(item, content)

    return destination


def read_sheet_frames(path: Path, temporary_dir: Path) -> list[pd.DataFrame]:
    """Read every sheet from a HUD workbook as raw candidate tables."""

    readable_path = patch_xlsx_core_dates(path, temporary_dir)
    excel_file = pd.ExcelFile(readable_path)
    frames = []
    for sheet_name in excel_file.sheet_names:
        frame = excel_file.parse(sheet_name=sheet_name, dtype=object)
        if not frame.empty:
            frames.append(frame)
    return frames


def find_column(columns: list[str], candidates: set[str]) -> str | None:
    """Find the first column whose normalized name matches one of the candidates."""

    for column in columns:
        key = normalized_column_name(column)
        if key in candidates:
            return column
    return None


def find_rent_column(columns: list[str], bedroom_count: int) -> str | None:
    """Find the SAFMR column for a bedroom count."""

    exact_candidates = {
        f"arearentbr{bedroom_count}",
        f"safmr{bedroom_count}br",
        f"rent{bedroom_count}br",
        f"br{bedroom_count}",
    }
    for column in columns:
        key = normalized_column_name(column)
        if key in exact_candidates:
            return column
        if key.endswith(f"rentbr{bedroom_count}") or key.endswith(f"{bedroom_count}br"):
            return column
    return None


def zcta_from_value(value: Any) -> str:
    """Normalize a workbook ZIP/ZCTA value to a five-character string."""

    if pd.isna(value):
        return ""

    text = str(value).strip()
    if "." in text:
        text = text.split(".", 1)[0]
    return text.zfill(5)


def choose_best_duplicate(rows: pd.DataFrame) -> pd.Series:
    """Pick the best duplicate HUD row for the San Luis Obispo local market."""

    for _, row in rows.iterrows():
        joined = " ".join(str(value) for value in row.values if pd.notna(value)).lower()
        if "san luis obispo" in joined:
            return row
    return rows.iloc[0]


def extract_hud_rows(workbook: HudWorkbook, hud_dir: Path, zctas: set[str], temporary_dir: Path) -> list[dict[str, Any]]:
    """Extract one averaged 1-4BR SAFMR row per target ZCTA from a workbook."""

    path = hud_dir / workbook.filename
    frames = read_sheet_frames(path, temporary_dir)
    extracted_rows = []

    for frame in frames:
        columns = list(frame.columns)
        zip_column = find_column(
            columns,
            {
                "zip",
                "zcta",
                "zipcode",
                "zipcode5",
                "zipcodeid",
                "zipcodevalue",
                "zipcodearea",
                "zipcodes",
                "zipid",
            },
        )
        if zip_column is None:
            zip_column = find_column(columns, {"zip_code", "zipcode"})
        rent_columns = [find_rent_column(columns, bedroom_count) for bedroom_count in range(1, 5)]
        if zip_column is None or any(column is None for column in rent_columns):
            continue

        working = frame.copy()
        working["_zcta"] = working[zip_column].map(zcta_from_value)
        working = working[working["_zcta"].isin(zctas)]
        if working.empty:
            continue

        for zcta, zcta_rows in working.groupby("_zcta", sort=True):
            selected = choose_best_duplicate(zcta_rows)
            bed_values = []
            for column in rent_columns:
                value = pd.to_numeric(selected[column], errors="coerce")
                bed_values.append(float(value) if pd.notna(value) else None)
            numeric_bed_values = [value for value in bed_values if value is not None]
            if len(numeric_bed_values) != 4:
                continue
            extracted_rows.append(
                {
                    "fiscalYear": workbook.fiscal_year,
                    "zcta": zcta,
                    "hudSafmr1Br": round(numeric_bed_values[0]),
                    "hudSafmr2Br": round(numeric_bed_values[1]),
                    "hudSafmr3Br": round(numeric_bed_values[2]),
                    "hudSafmr4Br": round(numeric_bed_values[3]),
                    "hudSafmr": round(sum(numeric_bed_values) / len(numeric_bed_values)),
                    "sourceFile": workbook.filename,
                }
            )
        break

    return extracted_rows


def read_hud_safmrs(hud_dir: Path, zctas: set[str]) -> pd.DataFrame:
    """Read and combine HUD SAFMR values for the requested ZCTAs."""

    temporary_dir = Path(tempfile.mkdtemp(prefix="hud-safmr-"))
    try:
        rows = []
        for workbook in WORKBOOKS:
            rows.extend(extract_hud_rows(workbook, hud_dir, zctas, temporary_dir))
        return pd.DataFrame(rows)
    finally:
        shutil.rmtree(temporary_dir, ignore_errors=True)


def clean_optional_number(value: Any) -> float | None:
    """Convert an optional CSV numeric value to a float."""

    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    if text == "":
        return None
    return float(text)


def blend_rent_values(zori: float | None, hud_safmr: float | None) -> tuple[int | None, str]:
    """Blend Zillow ZORI and HUD SAFMR according to the dashboard rule."""

    if zori is not None and hud_safmr is not None:
        return round((zori + hud_safmr) / 2), "Zillow ZORI + HUD SAFMR"
    if hud_safmr is not None:
        return round(hud_safmr), "HUD SAFMR"
    if zori is not None:
        return round(zori), "Zillow ZORI"
    return None, ""


def build_blended_csv(input_path: Path, output_path: Path, hud_output_path: Path, hud_dir: Path) -> None:
    """Update the ZIP housing CSV with HUD SAFMR and blended rent values."""

    housing = pd.read_csv(input_path, dtype={"zcta": str})
    zctas = set(housing["zcta"].dropna().astype(str).str.zfill(5))
    hud = read_hud_safmrs(hud_dir, zctas)
    if hud.empty:
        raise RuntimeError("No HUD SAFMR rows were extracted for the dashboard ZCTAs.")

    hud = hud.drop_duplicates(subset=["fiscalYear", "zcta"], keep="first")
    hud_lookup = {
        (int(row["fiscalYear"]), str(row["zcta"])): int(row["hudSafmr"])
        for _, row in hud.iterrows()
    }

    hud_values = []
    blended_values = []
    rent_sources = []
    fiscal_years = []

    for _, row in housing.iterrows():
        fiscal_year = fiscal_year_for_date(str(row["date"]))
        zcta = str(row["zcta"]).zfill(5)
        zori = clean_optional_number(row.get("zori"))
        hud_safmr = hud_lookup.get((fiscal_year, zcta))
        blended_rent, rent_source = blend_rent_values(zori, hud_safmr)
        fiscal_years.append(fiscal_year)
        hud_values.append(hud_safmr)
        blended_values.append(blended_rent)
        rent_sources.append(rent_source)

    housing["hudFiscalYear"] = fiscal_years
    housing["hudSafmr"] = hud_values
    housing["blendedRent"] = blended_values
    housing["rentSource"] = rent_sources

    housing.to_csv(output_path, index=False, quoting=csv.QUOTE_MINIMAL)
    hud.sort_values(["fiscalYear", "zcta"]).to_csv(hud_output_path, index=False)

    coverage = hud.groupby("fiscalYear")["zcta"].nunique().to_dict()
    missing_summary = []
    for year in sorted(set(fiscal_years)):
        count = int(coverage.get(year, 0))
        if count < len(zctas):
            missing_summary.append(f"FY{year}: {len(zctas) - count} missing")
    print(f"Wrote {output_path}")
    print(f"Wrote {hud_output_path}")
    print(f"HUD coverage by fiscal year: {coverage}")
    if missing_summary:
        print("Missing HUD ZIP coverage: " + "; ".join(missing_summary))
    print(housing["rentSource"].value_counts(dropna=False).to_string())


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("src/data/slo-zip-housing.csv"))
    parser.add_argument("--output", type=Path, default=Path("src/data/slo-zip-housing.csv"))
    parser.add_argument("--hud-output", type=Path, default=Path("src/data/slo-hud-safmr.csv"))
    parser.add_argument("--hud-dir", type=Path, default=Path.home() / "Downloads")
    return parser.parse_args()


def main() -> None:
    """Run the HUD SAFMR blend update."""

    args = parse_args()
    build_blended_csv(args.input, args.output, args.hud_output, args.hud_dir)


if __name__ == "__main__":
    main()
