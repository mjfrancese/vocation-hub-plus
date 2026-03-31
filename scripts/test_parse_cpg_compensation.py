"""Tests for CPG compensation PDF parser."""
import sqlite3
import tempfile
import os
import pytest

from parse_cpg_compensation import (
    parse_diocese_tables,
    parse_asa_tables,
    parse_position_tables,
    parse_experience_tables,
    parse_revenue_tables,
    insert_into_db,
)

# ---------------------------------------------------------------------------
# Sample text extracted from real PDF structure (offline, no PDF needed)
# ---------------------------------------------------------------------------

SAMPLE_DIOCESE_TEXT_PROVINCE_I = """\
Compensation by Gender and Province I Dioceses
Female Male All
Diocese Median Number Median Number Median Number
Connecticut
$90,218 52 $107,665 52 $98,990 104
Maine
$71,709 15 $65,359 21 $68,534 36
Massachusetts
$88,787 71 $107,172 92 $100,000 163
New Hampshire
NR 8 $67,900 12 $67,900 20
Rhode Island
$72,000 18 $85,000 16 $78,000 34
Vermont
$69,846 13 $84,000 9 $75,049 22
Western Massachusetts
$74,500 14 $80,000 11 $77,000 25
29"""

SAMPLE_DIOCESE_TEXT_INLINE = """\
Compensation by Gender and Province V Dioceses
Female Male All
Diocese Median Number Median Number Median Number
Chicago $92,932 37 $85,113 61 $89,400 98
Eastern Michigan $43,000 8 $70,897 5 $65,000 13
Eau Claire NR 2 NR 4 $50,407 6
Fond du Lac $70,780 9 $69,133 13 $69,957 22
34"""

SAMPLE_ASA_TEXT = """\
Compensation by Gender and Average Sunday
Attendance (ASA)
Gender Church Size Median Number % of Total
Female Family (0-75) $71,000 839 24.3%
Pastoral (76-140) $90,740 351 8.6%
Transitional (141-225) $86,281 177 3.2%
Program (226-400) $76,207 118 1.7%
Resource (401+) $92,698 45 0.2%
Male Family (0-75) $74,872 1,175 34.3%
Pastoral (76-140) $98,789 631 17.7%
Transitional (141-225) $109,273 317 6.5%
Program (226-400) $119,959 212 3.3%
Resource (401+) $137,363 80 0.4%
All Family (0-75) $73,090 2,014 60.0%
Pastoral (76-140) $96,388 982 27.8%
Transitional (141-225) $101,957 494 10.7%
Program (226-400) $96,496 330 5.1%
Resource (401+) $112,875 125 0.6%
18"""

SAMPLE_POSITION_TEXT = """\
Compensation by Gender and Position
Gender Position Median Number % of Total
Female Senior Rector $113,783 189 2.8%
Solo Rector $75,759 976 21.8%
Assistant $73,662 405 7.3%
Specialty Minister $84,774 361 7.4%
Parish Deacon $550 114 1.1%
Male Senior Rector $128,695 498 9.2%
Solo Rector $83,856 1636 37.0%
Assistant $75,450 403 6.9%
Specialty Minister $93,080 387 7.6%
Parish Deacon $300 56 0.4%
All Senior Rector $123,442 687 13.2%
Solo Rector $80,176 2612 59.6%
Assistant $74,946 808 15.5%
Specialty Minister $88,811 748 16.7%
Parish Deacon $354 170 2.1%
16"""

SAMPLE_EXPERIENCE_TEXT = """\
Compensation by Gender and Credited Service
Gender Credited Service Median Number % of Total
Female Less than 5 years $66,168 470 9.4%
5 to 9 years $75,732 486 9.4%
10 to 19 years $88,641 706 14.9%
20 years plus $101,962 313 5.4%
Male Less than 5 years $67,565 553 11.0%
5 to 9 years $80,683 636 13.5%
10 to 19 years $97,099 1047 21.1%
20 years plus $111,547 733 15.3%
All Less than 5 years $67,000 1,023 21.5%
5 to 9 years $79,058 1,122 24.1%
10 to 19 years $93,820 1,753 37.6%
20 years plus $108,930 1,046 22.2%
17"""

SAMPLE_REVENUE_TEXT = """\
Compensation by Gender and Operating Revenue
Gender Operating Revenue Median Number % of Total
Female Less than $75,000 $22,466 83 1.2%
$75,000 - $150,000 $55,137 206 4.7%
$150,001 - $250,000 $71,946 319 8.5%
$250,001 - $350,000 $82,495 212 4.9%
$350,001 - $450,000 $93,125 137 2.5%
$450,001 - $1,000,000 $92,531 353 9.0%
$1,000,000 plus $86,952 284 5.3%
Male Less than $75,000 $31,217 133 2.5%
$75,000 - $150,000 $49,595 277 7.2%
$150,001 - $250,000 $75,000 441 12.5%
$250,001 - $350,000 $87,721 389 10.8%
$350,001 - $450,000 $98,895 250 6.1%
$450,001 - $1,000,000 $107,165 602 15.9%
$1,000,000 plus $125,721 439 8.9%
All Less than $75,000 $26,695 216 4.8%
$75,000 - $150,000 $50,864 483 13.9%
$150,001 - $250,000 $72,960 760 22.3%
$250,001 - $350,000 $85,672 601 17.4%
$350,001 - $450,000 $96,734 387 10.2%
$450,001 - $1,000,000 $102,311 955 28.0%
$1,000,000 plus $107,650 723 14.8%
19"""


# ---------------------------------------------------------------------------
# Diocese table tests
# ---------------------------------------------------------------------------

class TestParseDioceseTables:
    def test_extracts_all_dioceses(self):
        rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_PROVINCE_I, "I")
        names = [r["diocese"] for r in rows]
        assert len(rows) == 7
        assert "Connecticut" in names
        assert "Western Massachusetts" in names

    def test_dollar_amounts_parsed(self):
        rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_PROVINCE_I, "I")
        ct = [r for r in rows if r["diocese"] == "Connecticut"][0]
        assert ct["female_median"] == 90218.0
        assert ct["female_count"] == 52
        assert ct["male_median"] == 107665.0
        assert ct["male_count"] == 52
        assert ct["all_median"] == 98990.0
        assert ct["all_count"] == 104

    def test_nr_values_as_none(self):
        rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_PROVINCE_I, "I")
        nh = [r for r in rows if r["diocese"] == "New Hampshire"][0]
        assert nh["female_median"] is None
        assert nh["female_count"] == 8
        assert nh["male_median"] == 67900.0

    def test_stores_province(self):
        rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_PROVINCE_I, "I")
        assert all(r["province"] == "I" for r in rows)

    def test_inline_format(self):
        """Some pages put the diocese name on the same line as values."""
        rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_INLINE, "V")
        assert len(rows) == 4
        chi = [r for r in rows if r["diocese"] == "Chicago"][0]
        assert chi["female_median"] == 92932.0
        assert chi["all_count"] == 98

    def test_inline_nr(self):
        rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_INLINE, "V")
        ec = [r for r in rows if r["diocese"] == "Eau Claire"][0]
        assert ec["female_median"] is None
        assert ec["male_median"] is None
        assert ec["all_median"] == 50407.0


# ---------------------------------------------------------------------------
# ASA table tests
# ---------------------------------------------------------------------------

class TestParseAsaTables:
    def test_extracts_all_categories(self):
        rows = parse_asa_tables(SAMPLE_ASA_TEXT)
        categories = set(r["asa_category"] for r in rows)
        assert "Family (0-75)" in categories
        assert "Pastoral (76-140)" in categories
        assert "Transitional (141-225)" in categories
        assert "Program (226-400)" in categories
        assert "Resource (401+)" in categories

    def test_extracts_all_genders(self):
        rows = parse_asa_tables(SAMPLE_ASA_TEXT)
        genders = set(r["gender"] for r in rows)
        assert genders == {"Female", "Male", "All"}

    def test_correct_values(self):
        rows = parse_asa_tables(SAMPLE_ASA_TEXT)
        female_family = [r for r in rows if r["gender"] == "Female" and r["asa_category"] == "Family (0-75)"][0]
        assert female_family["median"] == 71000.0
        assert female_family["count"] == 839

    def test_total_rows(self):
        rows = parse_asa_tables(SAMPLE_ASA_TEXT)
        assert len(rows) == 15  # 3 genders x 5 categories


# ---------------------------------------------------------------------------
# Position table tests
# ---------------------------------------------------------------------------

class TestParsePositionTables:
    def test_extracts_positions(self):
        rows = parse_position_tables(SAMPLE_POSITION_TEXT)
        positions = set(r["position_type"] for r in rows)
        assert "Senior Rector" in positions
        assert "Parish Deacon" in positions

    def test_correct_values(self):
        rows = parse_position_tables(SAMPLE_POSITION_TEXT)
        male_sr = [r for r in rows if r["gender"] == "Male" and r["position_type"] == "Senior Rector"][0]
        assert male_sr["median"] == 128695.0
        assert male_sr["count"] == 498

    def test_total_rows(self):
        rows = parse_position_tables(SAMPLE_POSITION_TEXT)
        assert len(rows) == 15  # 3 genders x 5 positions


# ---------------------------------------------------------------------------
# Experience table tests
# ---------------------------------------------------------------------------

class TestParseExperienceTables:
    def test_extracts_brackets(self):
        rows = parse_experience_tables(SAMPLE_EXPERIENCE_TEXT)
        brackets = set(r["service_bracket"] for r in rows)
        assert "Less than 5 years" in brackets
        assert "20 years plus" in brackets

    def test_total_rows(self):
        rows = parse_experience_tables(SAMPLE_EXPERIENCE_TEXT)
        assert len(rows) == 12  # 3 genders x 4 brackets


# ---------------------------------------------------------------------------
# Revenue table tests
# ---------------------------------------------------------------------------

class TestParseRevenueTables:
    def test_extracts_brackets(self):
        rows = parse_revenue_tables(SAMPLE_REVENUE_TEXT)
        brackets = set(r["revenue_bracket"] for r in rows)
        assert "Less than $75,000" in brackets
        assert "$1,000,000 plus" in brackets

    def test_total_rows(self):
        rows = parse_revenue_tables(SAMPLE_REVENUE_TEXT)
        assert len(rows) == 21  # 3 genders x 7 brackets

    def test_correct_values(self):
        rows = parse_revenue_tables(SAMPLE_REVENUE_TEXT)
        all_top = [r for r in rows if r["gender"] == "All" and r["revenue_bracket"] == "$1,000,000 plus"][0]
        assert all_top["median"] == 107650.0
        assert all_top["count"] == 723


# ---------------------------------------------------------------------------
# Database insert tests
# ---------------------------------------------------------------------------

class TestInsertIntoDb:
    def test_creates_tables_and_inserts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            diocese_rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_PROVINCE_I, "I")
            asa_rows = parse_asa_tables(SAMPLE_ASA_TEXT)
            position_rows = parse_position_tables(SAMPLE_POSITION_TEXT)
            experience_rows = parse_experience_tables(SAMPLE_EXPERIENCE_TEXT)
            revenue_rows = parse_revenue_tables(SAMPLE_REVENUE_TEXT)

            insert_into_db(
                db_path, 2023,
                diocese_rows=diocese_rows,
                asa_rows=asa_rows,
                position_rows=position_rows,
                experience_rows=experience_rows,
                revenue_rows=revenue_rows,
            )

            conn = sqlite3.connect(db_path)
            cur = conn.cursor()

            cur.execute("SELECT COUNT(*) FROM compensation_diocesan")
            assert cur.fetchone()[0] == 7

            cur.execute("SELECT COUNT(*) FROM compensation_by_asa")
            assert cur.fetchone()[0] == 15

            cur.execute("SELECT COUNT(*) FROM compensation_by_position")
            assert cur.fetchone()[0] == 15

            cur.execute("SELECT COUNT(*) FROM compensation_by_experience")
            assert cur.fetchone()[0] == 12

            cur.execute("SELECT COUNT(*) FROM compensation_by_revenue")
            assert cur.fetchone()[0] == 21

            # Verify NR stored as NULL
            cur.execute(
                "SELECT female_median FROM compensation_diocesan WHERE diocese = 'New Hampshire'"
            )
            assert cur.fetchone()[0] is None

            conn.close()

    def test_insert_or_replace(self):
        """Running insert twice should not duplicate rows."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            diocese_rows = parse_diocese_tables(SAMPLE_DIOCESE_TEXT_PROVINCE_I, "I")
            for _ in range(2):
                insert_into_db(db_path, 2023, diocese_rows=diocese_rows)

            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM compensation_diocesan")
            assert cur.fetchone()[0] == 7
            conn.close()
