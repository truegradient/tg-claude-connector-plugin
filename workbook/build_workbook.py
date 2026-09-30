#!/usr/bin/env python3
"""
Build a TrueGradient planning workbook (any of the five skills) from a JSON spec.

    python build_workbook.py spec.json out.xlsx

Produces, in this order:
  1. "Read Me"   - what this is, source, scope, tabs, caveats, colour key,
                   blank-vs-zero legend and the provenance footer
  2. "Summary"   - formula-linked roll-up blocks (COUNTIFS / SUMIFS / AVERAGEIFS)
                   over one detail tab (optional)
  3. detail and exception tabs, in spec order

The house style (navy header, Arial, grey source line, frozen panes, autofilter,
SUBTOTAL totals, fills on the action column, yellow flag cells) is fixed here so
every workbook looks the same. See WORKBOOK-SPEC.md for the spec format.

Data rules enforced here, not left to the author:
  * a DAYS column is never summed: its total is SUBTOTAL(1,...) (average) and a
    Summary block uses AVERAGEIFS, labelled "(avg)";
  * a RATE column has no total unless the spec asks for "sum" explicitly;
  * a PERCENT column (pct, pct_signed, pct100, pct100_signed) is never averaged
    and never summed by default: its total is either an explicit "sum" (shares
    of one whole) or "formula", the column's own ratio re-evaluated on the
    totals row (e.g. accuracy = 1 - total error / total actual). A Summary block
    takes the same rule: percent values need "agg": "sum", and a pooled ratio
    goes in the block's "ratios";
  * None / missing -> blank cell; 0 -> a visible 0 (a modelled zero is a finding);
  * every derived number is a live formula, never a pasted result.
"""
import json
import math
import re
import sys
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

FONT = "Arial"
NAVY = "1F3A5F"
GREY = "555555"
PALETTE = {  # named fills the spec may use
    "orange": "FCE4D6",
    "yellow": "FFF2CC",
    "green": "E2EFDA",
    "red": "F8CBAD",
    "blue": "DDEBF7",
    "grey": "EDEDED",
}
COLOUR_NAMES = {v: k.capitalize() for k, v in PALETTE.items()}

FORMATS = {
    "text": "General",
    "units": "#,##0;(#,##0);0",
    "money": '$#,##0;($#,##0);$0',
    "money2": "$#,##0.00",
    "days": "#,##0",
    "rate": "#,##0.0",
    "pct": "0.0%",
    "date": "yyyy-mm-dd",
    "int": "0",
    # forecast skills
    "delta": "+#,##0;-#,##0;0",            # a change in units (new - old)
    "pct_signed": "+0.0%;-0.0%;0.0%",      # a signed fraction: change %, computed bias
    "pct100": '0.0"%"',                    # a percentage TG stores on a 0-100 scale
    "pct100_signed": '+0.0"%";-0.0"%";0.0"%"',  # stored signed % error (<date> Bias)
}
PERCENT = {"pct", "pct_signed", "pct100", "pct100_signed"}
NUMERIC = {"units", "money", "money2", "days", "rate", "int", "delta"} | PERCENT
DEFAULT_TOTAL = {"units": "sum", "money": "sum", "days": "avg", "delta": "sum"}
BAD_TAB_CHARS = set('[]:*?/\\')
placeholder = re.compile(r"\{([^}]+)\}")  # {Header} in a formula

HEADER_ROW = 4
FIRST_DATA_ROW = 5

thin = Side(style="thin", color="D9D9D9")
BOTTOM = Border(bottom=thin)


def fill(hex_or_name):
    if not hex_or_name:
        return None
    hx = PALETTE.get(str(hex_or_name).lower(), str(hex_or_name)).lstrip("#").upper()
    return PatternFill("solid", fgColor=hx)


def die(msg):
    sys.exit(f"spec error: {msg}")


def check_tab_name(name, seen):
    if len(name) > 31:
        die(f'tab name "{name}" is {len(name)} chars; Excel allows 31')
    if BAD_TAB_CHARS & set(name):
        die(f'tab name "{name}" contains one of []:*?/\\')
    if name.lower() in seen:
        die(f'duplicate tab name "{name}"')
    seen.add(name.lower())


def qref(tab):
    return "'" + tab.replace("'", "''") + "'"


def to_cell_value(v, ctype):
    if v is None or v == "":
        return None
    if ctype == "date" and isinstance(v, str):
        try:
            return datetime.strptime(v[:10], "%Y-%m-%d").date()
        except ValueError:
            return v  # keep verbatim text such as "No OOS in horizon"
    if ctype in NUMERIC and isinstance(v, str):
        try:
            return float(v.replace(",", ""))
        except ValueError:
            return v
    return v


def title_block(ws, title, source):
    ws["A1"] = title
    ws["A1"].font = Font(name=FONT, size=14, bold=True)
    if source:
        ws["A2"] = source
        ws["A2"].font = Font(name=FONT, size=9, color=GREY)


def header_cell(c, text):
    c.value = text
    c.font = Font(name=FONT, size=11, bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor=NAVY)
    c.alignment = Alignment(wrap_text=True, vertical="center")


def body_font(bold=False):
    return Font(name=FONT, size=11, bold=bold)


# --------------------------------------------------------------------------- detail
def build_detail(wb, tab, layout):
    name = tab["name"]
    ws = wb.create_sheet(name)
    cols = tab["columns"]
    rows = tab.get("rows", [])
    title_block(ws, tab["title"], tab.get("source"))

    letters = {}
    for i, col in enumerate(cols, start=1):
        col.setdefault("key", col["header"])
        col.setdefault("type", "text")
        if col["type"] not in FORMATS:
            die(f'{name}: column "{col["header"]}" has unknown type "{col["type"]}"')
        if col["header"] in letters:
            die(f'{name}: duplicate column header "{col["header"]}"')
        letters[col["header"]] = get_column_letter(i)
    known_keys = {c["key"] for c in cols}
    for r in rows:
        extra = set(r) - known_keys
        if extra:
            die(f'{name}: row has keys with no column: {sorted(extra)}')

    def render_formula(f, row):
        def sub(m):
            h = m.group(1)
            if h not in letters:
                die(f'{name}: formula refers to unknown column "{{{h}}}"')
            return f"{letters[h]}{row}"
        return placeholder.sub(sub, f)

    for i, col in enumerate(cols, start=1):
        header_cell(ws.cell(HEADER_ROW, i), col["header"])
    ws.row_dimensions[HEADER_ROW].height = 45

    last = FIRST_DATA_ROW + max(len(rows), 1) - 1
    if not rows:
        c = ws.cell(FIRST_DATA_ROW, 1, tab.get("empty_note", "No rows met this condition."))
        c.font = Font(name=FONT, size=11, italic=True, color=GREY)

    for r_i, row in enumerate(rows):
        r = FIRST_DATA_ROW + r_i
        for c_i, col in enumerate(cols, start=1):
            cell = ws.cell(r, c_i)
            if "formula" in col:
                cell.value = render_formula(col["formula"], r)
            else:
                cell.value = to_cell_value(row.get(col["key"]), col["type"])
            cell.font = body_font()
            cell.number_format = FORMATS[col["type"]]
            cell.border = BOTTOM
            if col.get("fill_map") and cell.value in col["fill_map"]:
                cell.fill = fill(col["fill_map"][cell.value])
            if col.get("flag"):
                cell.alignment = Alignment(wrap_text=True, vertical="top")
                ok = tab.get("flag_ok_prefix", "OK")
                if cell.value and not str(cell.value).startswith(ok):
                    cell.fill = fill("yellow")

    # totals
    kinds = {col["header"]: col.get("total", DEFAULT_TOTAL.get(col["type"])) for col in cols}
    for col in cols:
        kind = kinds[col["header"]]
        if kind not in (None, False, "sum", "avg", "formula"):
            die(f'{name}: "{col["header"]}" has unknown total "{kind}"')
        if col["type"] == "days" and kind == "sum":
            die(f'{name}: "{col["header"]}" is a DAYS column and cannot be summed')
        if col["type"] in PERCENT and kind == "avg":
            die(f'{name}: "{col["header"]}" is a PERCENT column; an unweighted average of '
                f'percentages misweights. Use "total": "formula" (a ratio of totals) instead')
        if kind == "formula":
            if "formula" not in col:
                die(f'{name}: "{col["header"]}" has "total": "formula" but no formula')
            for ref in placeholder.findall(col["formula"]):
                if kinds.get(ref) not in ("sum", "formula"):
                    die(f'{name}: total formula of "{col["header"]}" uses "{ref}", '
                        f'which has no summed total to divide')
    wants_total = any(kinds.values())
    total_row = None
    if rows and wants_total and tab.get("totals", True):
        total_row = last + 1
        ws.cell(total_row, 1, "Total").font = body_font(True)
        for c_i, col in enumerate(cols, start=1):
            kind = kinds[col["header"]]
            if not kind:
                continue
            L = get_column_letter(c_i)
            if kind == "formula":
                value = render_formula(col["formula"], total_row)
            else:
                fn = {"sum": 9, "avg": 1}[kind]
                value = f"=SUBTOTAL({fn},{L}{FIRST_DATA_ROW}:{L}{last})"
            cell = ws.cell(total_row, c_i, value)
            cell.font = body_font(True)
            cell.number_format = FORMATS[col["type"]]
        if any(col.get("total", DEFAULT_TOTAL.get(col["type"])) == "avg" for col in cols):
            note = ws.cell(total_row + 1, 1, "Days columns show the average, not a sum.")
            note.font = Font(name=FONT, size=9, color=GREY)

    # footnotes
    fr = (total_row or last) + 3
    for note in tab.get("footnotes", []):
        c = ws.cell(fr, 1, note)
        c.font = Font(name=FONT, size=9, color=GREY)
        fr += 1

    # widths, freeze, filter
    for c_i, col in enumerate(cols, start=1):
        if "width" in col:
            w = col["width"]
        elif col.get("flag"):
            w = 60
        else:
            vals = [len(str(r.get(col["key"], "") or "")) for r in rows[:300]]
            w = min(max([len(col["header"]) * 0.55, 8] + [v + 2 for v in vals]), 40)
        ws.column_dimensions[get_column_letter(c_i)].width = w
    freeze = tab.get("freeze_cols", 0)
    ws.freeze_panes = f"{get_column_letter(freeze + 1)}{FIRST_DATA_ROW}"
    if rows:
        ws.auto_filter.ref = f"A{HEADER_ROW}:{get_column_letter(len(cols))}{last}"

    layout[name] = {"letters": letters, "cols": {c["header"]: c for c in cols},
                    "first": FIRST_DATA_ROW, "last": last, "rows": rows}


# --------------------------------------------------------------------------- summary
def build_summary(wb, spec, layout):
    s = spec["summary"]
    src = s["source_tab"]
    if src not in layout:
        die(f'summary.source_tab "{src}" is not a detail tab')
    L = layout[src]
    ws = wb.create_sheet(s.get("name", "Summary"), 1)
    title_block(ws, s["title"], s.get("subtitle",
                f'All figures link to the "{src}" tab. Units unless stated.'))
    rng = lambda h: f"{qref(src)}!${L['letters'][h]}${L['first']}:${L['letters'][h]}${L['last']}"

    r = 4
    ws.column_dimensions["A"].width = 40
    for block in s["blocks"]:
        g = block["group_by"]
        if g not in L["letters"]:
            die(f'summary block group_by "{g}" is not a column of "{src}"')
        vals = block["values"]
        for v in vals:
            if v not in L["letters"]:
                die(f'summary value "{v}" is not a column of "{src}"')
            if L["cols"][v]["type"] in PERCENT and block.get("agg", {}).get(v) != "sum":
                die(f'summary value "{v}" is a PERCENT column: SUMIFS or AVERAGEIFS of '
                    f'row percentages misweights. Give "agg": {{"{v}": "sum"}} only for shares '
                    f'of one whole; put a pooled percentage in the block\'s "ratios"')
        count_label = block.get("count_label", "Rows")
        share_of = block.get("share_of")  # a money/units column to express as % of total
        if share_of and block.get("total", True) is False:
            die(f'summary block "{g}": "share_of" needs the Total row that "total": false removes')
        # pooled figures from this block's own cells, e.g.
        #   {"header": "Accuracy", "type": "pct", "formula": "=1-{Abs error}/{Actual}"}
        ratios = block.get("ratios", [])
        for q in ratios:
            q.setdefault("type", "pct")
            if q["type"] not in FORMATS:
                die(f'summary ratio "{q["header"]}" has unknown type "{q["type"]}"')
            for ref in placeholder.findall(q["formula"]):
                if ref not in vals:
                    die(f'summary ratio "{q["header"]}" uses "{ref}", which is not one of this block\'s values')
                if L["cols"][ref]["type"] == "days" or block.get("agg", {}).get(ref) == "avg":
                    die(f'summary ratio "{q["header"]}" uses "{ref}", which is averaged, not summed')

        def write_ratios(row, bold):
            # a zero denominator is undefined, so the cell is blank, never 0
            for k, q in enumerate(ratios):
                body = placeholder.sub(
                    lambda m: f"{get_column_letter(3 + vals.index(m.group(1)))}{row}",
                    q["formula"].lstrip("="))
                c = ws.cell(row, ratio_col0 + k, f'=IFERROR({body},"")')
                c.font, c.number_format = body_font(bold), FORMATS[q["type"]]

        headers = [block.get("label", g), count_label]
        for v in vals:
            headers.append(v + (" (avg)" if L["cols"][v]["type"] == "days" else ""))
        if share_of:
            headers.append(f"Share of {share_of}")
        headers += [q["header"] for q in ratios]
        ratio_col0 = 3 + len(vals) + (1 if share_of else 0)
        for i, h in enumerate(headers, start=1):
            header_cell(ws.cell(r, i), h)
            ws.column_dimensions[get_column_letter(i)].width = max(
                ws.column_dimensions[get_column_letter(i)].width or 0, 14)
        r += 1

        groups = block.get("order")
        if not groups:
            key = L["cols"][g]["key"]
            # rank by a stored (non-formula) units/money column; formulas have no value yet
            rank_col = block.get("rank_by") or next(
                (v for v in vals if L["cols"][v]["type"] in ("money", "units")
                 and "formula" not in L["cols"][v]), None)
            if rank_col and "formula" in L["cols"][rank_col]:
                die(f'rank_by "{rank_col}" is a formula column; rank by a stored column')
            totals = {}
            for row in L["rows"]:
                k = row.get(key)
                if k is None:
                    continue
                add = 0 if rank_col else 1  # no stored column to rank by: rank by row count
                if rank_col:
                    x = row.get(L["cols"][rank_col]["key"])
                    add = x if isinstance(x, (int, float)) else 0
                totals[k] = totals.get(k, 0) + add
            groups = sorted(totals, key=lambda k: -totals[k])
        first = r
        gmap = L["cols"][g].get("fill_map", {})
        gtype = L["cols"][g]["type"]
        for gv in groups:
            # the label is the COUNTIFS/SUMIFS criterion, so it must be the same
            # kind of value as the grouped cells: a date for a date column
            c = ws.cell(r, 1, to_cell_value(gv, gtype) if gtype == "date" else gv)
            c.font, c.number_format = body_font(), FORMATS[gtype]
            if gv in gmap:
                ws.cell(r, 1).fill = fill(gmap[gv])
            c = ws.cell(r, 2, f"=COUNTIFS({rng(g)},$A{r})")
            c.font, c.number_format = body_font(), FORMATS["units"]
            for j, v in enumerate(vals, start=3):
                t = L["cols"][v]["type"]
                if t == "days" or block.get("agg", {}).get(v) == "avg":
                    f = f'=IFERROR(AVERAGEIFS({rng(v)},{rng(g)},$A{r}),"")'
                else:
                    # a group whose rows all lack the value is unknown (blank), not a
                    # summed 0; a group with no rows at all really does total 0
                    f = (f'=IF(AND(COUNTIFS({rng(g)},$A{r})>0,'
                         f'SUMPRODUCT(({rng(g)}=$A{r})*({rng(v)}<>""))=0),"",'
                         f'SUMIFS({rng(v)},{rng(g)},$A{r}))')
                c = ws.cell(r, j, f)
                c.font, c.number_format = body_font(), FORMATS[t]
            if share_of:
                sc = get_column_letter(3 + vals.index(share_of))
                j = 3 + len(vals)
                c = ws.cell(r, j, f"=IFERROR({sc}{r}/{sc}{first + len(groups)},0)")
                c.font, c.number_format = body_font(), FORMATS["pct"]
            write_ratios(r, bold=False)
            r += 1
        last = r - 1
        if block.get("total", True) is False:
            # e.g. per-period forecast totals: a sum across periods is not an answer
            r += 1
            if block.get("note"):
                ws.cell(r - 1, 1, block["note"]).font = Font(name=FONT, size=9, color=GREY)
                r += 1
            continue
        ws.cell(r, 1, "Total").font = body_font(True)
        c = ws.cell(r, 2, f"=SUM(B{first}:B{last})")
        c.font, c.number_format = body_font(True), FORMATS["units"]
        for j, v in enumerate(vals, start=3):
            t = L["cols"][v]["type"]
            col = get_column_letter(j)
            if t == "days" or block.get("agg", {}).get(v) == "avg":
                f = f'=IFERROR(AVERAGE({rng(v)}),"")'  # true overall mean, not a mean of means
            else:
                f = f'=IF(COUNT({col}{first}:{col}{last})=0,"",SUM({col}{first}:{col}{last}))'
            c = ws.cell(r, j, f)
            c.font, c.number_format = body_font(True), FORMATS[t]
        if share_of:
            j = 3 + len(vals)
            sc = get_column_letter(3 + vals.index(share_of))
            c = ws.cell(r, j, f"=IFERROR({sc}{r}/{sc}{r},0)")
            c.font, c.number_format = body_font(True), FORMATS["pct"]
        write_ratios(r, bold=True)  # pooled over the whole block: a ratio of the totals
        r += 2
        if block.get("note"):
            ws.cell(r - 1, 1, block["note"]).font = Font(name=FONT, size=9, color=GREY)
            r += 1


# --------------------------------------------------------------------------- read me
def build_readme(wb, spec, tab_list):
    rm = spec["readme"]
    ws = wb.active
    ws.title = "Read Me"
    ws["A1"] = rm["title"]
    ws["A1"].font = Font(name=FONT, size=14, bold=True)
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 120

    items = list(rm.get("rows", []))
    labels = {k.lower() for k, _ in items}
    if "tabs" not in labels:
        items.append(["Tabs", " ".join(f'{n}: {d}' for n, d in tab_list if d)])
    for i, cav in enumerate(rm.get("caveats", []), start=1):
        items.append([f"Caveat {i}: {cav[0]}", cav[1]])
    for ex in rm.get("excluded", []):
        items.append(["Also excluded", ex])
    if "colour key" not in labels and rm.get("colour_key"):
        items.append(["Colour key", " ".join(f"{COLOUR_NAMES.get(PALETTE.get(k.lower(), k), k)} = {v}."
                                            for k, v in rm["colour_key"].items())])
    items.append(["Blank vs 0", rm.get(
        "blank_vs_zero",
        "A blank cell means the value is not in the TrueGradient data (unknown), or a figure "
        "that cannot be computed (such as a percentage of a zero base). A 0 is a zero the data "
        "records or models and is a real finding (e.g. no stock, no inbound, no sales).")])
    prov = spec.get("provenance", {})
    if prov:
        items.append(["Provenance", "; ".join(f"{k}: {v}" for k, v in prov.items())])

    r = 3
    for label, text in items:
        a = ws.cell(r, 1, label)
        a.font = body_font(True)
        a.alignment = Alignment(vertical="top")
        b = ws.cell(r, 2, text)
        b.font = body_font()
        b.alignment = Alignment(wrap_text=True, vertical="top")
        lines = max(1, math.ceil(len(str(text)) / 115))
        ws.row_dimensions[r].height = 15 * lines + 2
        r += 1


# --------------------------------------------------------------------------- main
def main(spec_path, out_path):
    with open(spec_path) as f:
        spec = json.load(f)
    seen = {"read me"}
    if spec.get("summary"):
        check_tab_name(spec["summary"].get("name", "Summary"), seen)
    for t in spec["tabs"]:
        check_tab_name(t["name"], seen)

    wb = Workbook()
    layout = {}
    for t in spec["tabs"]:
        build_detail(wb, t, layout)
    tab_list = []
    if spec.get("summary"):
        build_summary(wb, spec, layout)
        tab_list.append((spec["summary"].get("name", "Summary"), spec["summary"].get("description", "")))
    tab_list += [(t["name"], t.get("description", "")) for t in spec["tabs"]]
    build_readme(wb, spec, tab_list)
    wb.save(out_path)
    print(f"wrote {out_path}: " + ", ".join(ws.title for ws in wb))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
