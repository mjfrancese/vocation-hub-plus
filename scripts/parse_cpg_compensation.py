#!/usr/bin/env python3
"""
Parse CPG (Church Pension Group) clergy compensation PDF reports and store
the extracted data in a SQLite database.

Usage:
    python parse_cpg_compensation.py <pdf_path> <year> [--db-path path]

The script extracts diocese-level compensation, ASA-based compensation,
position-based compensation, experience-based compensation, and
revenue-based compensation tables from the annual PDF reports.
"""

import argparse
import os
import re
import sqlite3
import sys

import pdfplumber


# ---------------------------------------------------------------------------
# Known domestic diocese names (sorted longest-first for regex matching)
# ---------------------------------------------------------------------------

KNOWN_DIOCESES = sorted([
    "Alabama", "Alaska", "Albany", "Arizona", "Arkansas", "Atlanta",
    "Bethlehem", "California", "Central Florida", "Central Gulf Coast",
    "Central New York", "Central Pennsylvania", "Chicago", "Colorado",
    "Connecticut", "Dallas", "Delaware", "East Carolina", "East Tennessee",
    "Eastern Michigan", "Eastern Oregon", "Easton", "Eau Claire",
    "El Camino Real", "Florida", "Fond du Lac", "Fort Worth", "Georgia",
    "Great Lakes", "Hawaii", "Idaho", "Indianapolis", "Iowa", "Kansas",
    "Kentucky", "Lexington", "Long Island", "Los Angeles", "Louisiana",
    "Maine", "Maryland", "Massachusetts", "Michigan", "Milwaukee",
    "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New York", "Newark", "North Carolina",
    "North Dakota", "Northern California", "Northern Indiana",
    "Northern Michigan", "Northwest Texas", "Northwestern Pennsylvania",
    "Ohio", "Oklahoma", "Olympia", "Oregon", "Pennsylvania", "Pittsburgh",
    "Quincy", "Rhode Island", "Rio Grande", "Rochester", "San Diego",
    "San Joaquin", "South Carolina", "South Dakota", "Southeast Florida",
    "Southern Ohio", "Southern Virginia", "Southwest Florida",
    "Southwestern Virginia", "Spokane", "Springfield", "Tennessee", "Texas",
    "The Rio Grande", "Upper South Carolina", "Utah", "Vermont", "Virginia",
    "Washington", "West Missouri", "West Tennessee", "West Texas",
    "West Virginia", "Western Kansas", "Western Louisiana",
    "Western Massachusetts", "Western Michigan", "Western New York",
    "Western North Carolina", "Wyoming",
], key=lambda x: -len(x))

# Build a single regex alternation for diocese names
_DIOCESE_PATTERN = "|".join(re.escape(d) for d in KNOWN_DIOCESES)

# Multi-word diocese names that PDF text extraction may split across lines
_MULTIWORD_DIOCESES = [d for d in KNOWN_DIOCESES if " " in d]


def _normalize_diocese_text(text):
    """Rejoin diocese names that got split across lines in PDF extraction.

    For example, 'Northwestern\\nPennsylvania' becomes 'Northwestern Pennsylvania'.
    """
    for d in _MULTIWORD_DIOCESES:
        parts = d.split(" ")
        # Build a pattern that allows newlines between the words
        pattern = r'\b' + r'\s*\n\s*'.join(re.escape(p) for p in parts) + r'\b'
        text = re.sub(pattern, d, text)
    return text

# A value is either a dollar amount like $90,218 or "NR"
_VAL = r'(?:NR|\$[\d,]+)'
_NUM = r'\d[\d,]*'

# Pattern: diocese name followed by (on same line or next line) 6 value/number pairs
# Two formats observed in the PDF:
#   1. Diocese name on its own line, values on the next line
#   2. Diocese name on the same line as the values
_DIOCESE_ROW_RE = re.compile(
    rf'({_DIOCESE_PATTERN})\s*\n\s*({_VAL})\s+({_NUM})\s+({_VAL})\s+({_NUM})\s+({_VAL})\s+({_NUM})'
    rf'|({_DIOCESE_PATTERN})\s+({_VAL})\s+({_NUM})\s+({_VAL})\s+({_NUM})\s+({_VAL})\s+({_NUM})'
)


def _parse_dollar(s):
    """Parse a dollar string like '$90,218' to float, or None for 'NR'."""
    if s == "NR":
        return None
    return float(s.replace("$", "").replace(",", ""))


def _parse_int(s):
    """Parse an integer string like '1,023' to int."""
    return int(s.replace(",", ""))


# ---------------------------------------------------------------------------
# Diocese tables
# ---------------------------------------------------------------------------

def parse_diocese_tables(text, province):
    """Extract diocese compensation rows from text.

    Returns a list of dicts with keys:
        diocese, province, female_median, female_count,
        male_median, male_count, all_median, all_count
    """
    text = _normalize_diocese_text(text)
    results = []
    for m in _DIOCESE_ROW_RE.finditer(text):
        if m.group(1):
            # Format 1: diocese on its own line
            name = m.group(1)
            vals = m.group(2, 3, 4, 5, 6, 7)
        else:
            # Format 2: diocese on same line as values
            name = m.group(8)
            vals = m.group(9, 10, 11, 12, 13, 14)

        results.append({
            "diocese": name,
            "province": province,
            "female_median": _parse_dollar(vals[0]),
            "female_count": _parse_int(vals[1]),
            "male_median": _parse_dollar(vals[2]),
            "male_count": _parse_int(vals[3]),
            "all_median": _parse_dollar(vals[4]),
            "all_count": _parse_int(vals[5]),
        })
    return results


# ---------------------------------------------------------------------------
# ASA tables
# ---------------------------------------------------------------------------

_ASA_CATEGORIES = [
    "Family (0-75)",
    "Pastoral (76-140)",
    "Transitional (141-225)",
    "Program (226-400)",
    "Resource (401+)",
]

_ASA_CAT_PATTERN = "|".join(re.escape(c) for c in _ASA_CATEGORIES)
_ASA_ROW_RE = re.compile(
    rf'(Female|Male|All)\s+({_ASA_CAT_PATTERN})\s+({_VAL})\s+({_NUM})'
    rf'|({_ASA_CAT_PATTERN})\s+({_VAL})\s+({_NUM})'
)


def parse_asa_tables(text):
    """Extract ASA-based compensation rows.

    Returns list of dicts: gender, asa_category, median, count
    """
    results = []
    current_gender = None
    for m in _ASA_ROW_RE.finditer(text):
        if m.group(1):
            current_gender = m.group(1)
            category = m.group(2)
            median_str = m.group(3)
            count_str = m.group(4)
        else:
            category = m.group(5)
            median_str = m.group(6)
            count_str = m.group(7)

        if current_gender is None:
            continue

        results.append({
            "gender": current_gender,
            "asa_category": category,
            "median": _parse_dollar(median_str),
            "count": _parse_int(count_str),
        })
    return results


# ---------------------------------------------------------------------------
# Position tables
# ---------------------------------------------------------------------------

_POSITIONS = [
    "Senior Rector",
    "Solo Rector",
    "Assistant",
    "Specialty Minister",
    "Parish Deacon",
]

_POS_PATTERN = "|".join(re.escape(p) for p in _POSITIONS)
_POS_ROW_RE = re.compile(
    rf'(Female|Male|All)\s+({_POS_PATTERN})\s+({_VAL})\s+({_NUM})'
    rf'|({_POS_PATTERN})\s+({_VAL})\s+({_NUM})'
)


def parse_position_tables(text):
    """Extract position-based compensation rows.

    Returns list of dicts: gender, position_type, median, count
    """
    results = []
    current_gender = None
    for m in _POS_ROW_RE.finditer(text):
        if m.group(1):
            current_gender = m.group(1)
            position = m.group(2)
            median_str = m.group(3)
            count_str = m.group(4)
        else:
            position = m.group(5)
            median_str = m.group(6)
            count_str = m.group(7)

        if current_gender is None:
            continue

        results.append({
            "gender": current_gender,
            "position_type": position,
            "median": _parse_dollar(median_str),
            "count": _parse_int(count_str),
        })
    return results


# ---------------------------------------------------------------------------
# Experience (Credited Service) tables
# ---------------------------------------------------------------------------

_SERVICE_BRACKETS = [
    "Less than 5 years",
    "5 to 9 years",
    "10 to 19 years",
    "20 years plus",
]

_SVC_PATTERN = "|".join(re.escape(b) for b in _SERVICE_BRACKETS)
_SVC_ROW_RE = re.compile(
    rf'(Female|Male|All)\s+({_SVC_PATTERN})\s+({_VAL})\s+({_NUM})'
    rf'|({_SVC_PATTERN})\s+({_VAL})\s+({_NUM})'
)


def parse_experience_tables(text):
    """Extract experience-based compensation rows.

    Returns list of dicts: gender, service_bracket, median, count
    """
    results = []
    current_gender = None
    for m in _SVC_ROW_RE.finditer(text):
        if m.group(1):
            current_gender = m.group(1)
            bracket = m.group(2)
            median_str = m.group(3)
            count_str = m.group(4)
        else:
            bracket = m.group(5)
            median_str = m.group(6)
            count_str = m.group(7)

        if current_gender is None:
            continue

        results.append({
            "gender": current_gender,
            "service_bracket": bracket,
            "median": _parse_dollar(median_str),
            "count": _parse_int(count_str),
        })
    return results


# ---------------------------------------------------------------------------
# Revenue (Operating Revenue) tables
# ---------------------------------------------------------------------------

_REVENUE_BRACKETS = [
    r"Less than \$75,000",
    r"\$75,000 - \$150,000",
    r"\$150,001 - \$250,000",
    r"\$250,001 - \$350,000",
    r"\$350,001 - \$450,000",
    r"\$450,001 - \$1,000,000",
    r"\$1,000,000 plus",
]

_REV_PATTERN = "|".join(_REVENUE_BRACKETS)
_REV_ROW_RE = re.compile(
    rf'(Female|Male|All)\s+({_REV_PATTERN})\s+({_VAL})\s+({_NUM})'
    rf'|({_REV_PATTERN})\s+({_VAL})\s+({_NUM})'
)


def parse_revenue_tables(text):
    """Extract revenue-based compensation rows.

    Returns list of dicts: gender, revenue_bracket, median, count
    """
    results = []
    current_gender = None
    for m in _REV_ROW_RE.finditer(text):
        if m.group(1):
            current_gender = m.group(1)
            bracket = m.group(2)
            median_str = m.group(3)
            count_str = m.group(4)
        else:
            bracket = m.group(5)
            median_str = m.group(6)
            count_str = m.group(7)

        if current_gender is None:
            continue

        results.append({
            "gender": current_gender,
            "revenue_bracket": bracket,
            "median": _parse_dollar(median_str),
            "count": _parse_int(count_str),
        })
    return results


# ---------------------------------------------------------------------------
# PDF parsing
# ---------------------------------------------------------------------------

# Map province numbers (Roman numerals) from page titles
_PROVINCE_RE = re.compile(
    r'Province\s+(I{1,3}V?|IV|V(?:I{1,3})?|VI{1,3}|IX)\s+Dioceses'
)


def parse_pdf(pdf_path):
    """Open a CPG compensation PDF and extract all tables.

    Returns a dict with keys:
        diocese_rows, asa_rows, position_rows, experience_rows, revenue_rows
    """
    pdf = pdfplumber.open(pdf_path)
    all_text = ""
    diocese_rows = []
    asa_rows = []
    position_rows = []
    experience_rows = []
    revenue_rows = []

    for page in pdf.pages:
        text = page.extract_text() or ""
        all_text += text + "\n"

        # Check for diocese pages and extract province number
        province_match = _PROVINCE_RE.search(text)
        if province_match:
            province = province_match.group(1)
            diocese_rows.extend(parse_diocese_tables(text, province))

    # Parse the non-diocese tables from the full text
    asa_rows = parse_asa_tables(all_text)
    position_rows = parse_position_tables(all_text)
    experience_rows = parse_experience_tables(all_text)
    revenue_rows = parse_revenue_tables(all_text)

    pdf.close()

    return {
        "diocese_rows": diocese_rows,
        "asa_rows": asa_rows,
        "position_rows": position_rows,
        "experience_rows": experience_rows,
        "revenue_rows": revenue_rows,
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS compensation_diocesan (
    year INTEGER NOT NULL,
    diocese TEXT NOT NULL,
    province TEXT,
    female_median REAL,
    female_count INTEGER,
    male_median REAL,
    male_count INTEGER,
    all_median REAL,
    all_count INTEGER,
    UNIQUE(year, diocese)
);

CREATE TABLE IF NOT EXISTS compensation_by_asa (
    year INTEGER NOT NULL,
    gender TEXT NOT NULL,
    asa_category TEXT NOT NULL,
    median REAL,
    count INTEGER,
    UNIQUE(year, gender, asa_category)
);

CREATE TABLE IF NOT EXISTS compensation_by_position (
    year INTEGER NOT NULL,
    gender TEXT NOT NULL,
    position_type TEXT NOT NULL,
    median REAL,
    count INTEGER,
    UNIQUE(year, gender, position_type)
);

CREATE TABLE IF NOT EXISTS compensation_by_experience (
    year INTEGER NOT NULL,
    gender TEXT NOT NULL,
    service_bracket TEXT NOT NULL,
    median REAL,
    count INTEGER,
    UNIQUE(year, gender, service_bracket)
);

CREATE TABLE IF NOT EXISTS compensation_by_revenue (
    year INTEGER NOT NULL,
    gender TEXT NOT NULL,
    revenue_bracket TEXT NOT NULL,
    median REAL,
    count INTEGER,
    UNIQUE(year, gender, revenue_bracket)
);
"""


def insert_into_db(db_path, year, diocese_rows=None, asa_rows=None,
                   position_rows=None, experience_rows=None,
                   revenue_rows=None):
    """Create tables if needed and insert/replace all rows."""
    os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.executescript(_SCHEMA)

    if diocese_rows:
        for r in diocese_rows:
            cur.execute(
                """INSERT OR REPLACE INTO compensation_diocesan
                   (year, diocese, province, female_median, female_count,
                    male_median, male_count, all_median, all_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (year, r["diocese"], r["province"],
                 r["female_median"], r["female_count"],
                 r["male_median"], r["male_count"],
                 r["all_median"], r["all_count"]),
            )

    if asa_rows:
        for r in asa_rows:
            cur.execute(
                """INSERT OR REPLACE INTO compensation_by_asa
                   (year, gender, asa_category, median, count)
                   VALUES (?, ?, ?, ?, ?)""",
                (year, r["gender"], r["asa_category"], r["median"], r["count"]),
            )

    if position_rows:
        for r in position_rows:
            cur.execute(
                """INSERT OR REPLACE INTO compensation_by_position
                   (year, gender, position_type, median, count)
                   VALUES (?, ?, ?, ?, ?)""",
                (year, r["gender"], r["position_type"], r["median"], r["count"]),
            )

    if experience_rows:
        for r in experience_rows:
            cur.execute(
                """INSERT OR REPLACE INTO compensation_by_experience
                   (year, gender, service_bracket, median, count)
                   VALUES (?, ?, ?, ?, ?)""",
                (year, r["gender"], r["service_bracket"], r["median"], r["count"]),
            )

    if revenue_rows:
        for r in revenue_rows:
            cur.execute(
                """INSERT OR REPLACE INTO compensation_by_revenue
                   (year, gender, revenue_bracket, median, count)
                   VALUES (?, ?, ?, ?, ?)""",
                (year, r["gender"], r["revenue_bracket"], r["median"], r["count"]),
            )

    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Parse CPG clergy compensation PDF and store in SQLite"
    )
    parser.add_argument("pdf_path", help="Path to the CPG compensation PDF")
    parser.add_argument("year", type=int, help="Report year (e.g. 2023)")
    parser.add_argument(
        "--db-path", default="data/vocationhub.db",
        help="Path to SQLite database (default: data/vocationhub.db)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.pdf_path):
        print(f"Error: PDF not found: {args.pdf_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsing {args.pdf_path} for year {args.year}...")
    data = parse_pdf(args.pdf_path)

    print(f"  Dioceses: {len(data['diocese_rows'])}")
    print(f"  ASA rows: {len(data['asa_rows'])}")
    print(f"  Position rows: {len(data['position_rows'])}")
    print(f"  Experience rows: {len(data['experience_rows'])}")
    print(f"  Revenue rows: {len(data['revenue_rows'])}")

    insert_into_db(
        args.db_path, args.year,
        diocese_rows=data["diocese_rows"],
        asa_rows=data["asa_rows"],
        position_rows=data["position_rows"],
        experience_rows=data["experience_rows"],
        revenue_rows=data["revenue_rows"],
    )
    print(f"Data written to {args.db_path}")


if __name__ == "__main__":
    main()
