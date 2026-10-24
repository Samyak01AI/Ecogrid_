"""
EcoGrid AI 2.0 — Executive PDF Report Generator
Generates publication-quality, validated climate intervention briefs using ReportLab.
Features dynamic two-pass page numbering, clean currency formatting (INR),
table wrapping, and ecological corridor metrics.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfgen import canvas


class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas to dynamically compute and draw accurate 'Page X of Y' footers
    and running headers across all pages.
    """
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#6B7280"))

        # Running header on continuation pages (Page 2+)
        if self._pageNumber > 1:
            self.setStrokeColor(colors.HexColor("#D1D5DB"))
            self.setLineWidth(0.5)
            self.line(36, 842 - 26, 595 - 36, 842 - 26)
            self.drawString(36, 842 - 21, "ECOGRID AI 2.0 · Urban Climate Intervention & Resilience Brief (cont.)")

        # Running footer on all pages
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.setLineWidth(0.5)
        self.line(36, 32, 595 - 36, 32)
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(595 - 36, 20, page_str)
        self.drawString(36, 20, "Confidential · City Climate Planning Intelligence · EcoGrid AI")
        self.restoreState()


def generate_climate_report_pdf(
    study_name: str,
    study_id: str,
    cell_count: int,
    priority_count: int,
    critical_count: int,
    plan: Any,
    connectivity: Any,
    budget: float = 500000.0,
    ai_briefing: Optional[dict[str, Any]] = None,
) -> bytes:
    """
    Generate an executive-ready climate intervention brief in PDF format.
    Returns raw PDF bytes.
    """
    buffer = io.BytesIO()

    # Standard A4 margins (left/right: 36pt = 0.5 in, bottom: 44pt for running footer)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=44,
    )

    styles = getSampleStyleSheet()

    # EcoGrid Brand Typography & Palette
    PRIMARY_DARK = colors.HexColor("#164940")
    PRIMARY_TEAL = colors.HexColor("#0D5C4D")
    ACCENT_MINT = colors.HexColor("#4CC38A")
    DARK_TEXT = colors.HexColor("#111827")
    MUTED_TEXT = colors.HexColor("#4B5563")
    LIGHT_BG = colors.HexColor("#F0FDF4")
    BORDER_COLOR = colors.HexColor("#E5E7EB")

    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=PRIMARY_DARK,
    )
    eyebrow_style = ParagraphStyle(
        "Eyebrow",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=ACCENT_MINT,
        textTransform="uppercase",
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=14,
        textColor=MUTED_TEXT,
    )
    section_heading = ParagraphStyle(
        "SectionHeading",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=PRIMARY_TEAL,
        spaceBefore=10,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=DARK_TEXT,
    )
    kpi_number_style = ParagraphStyle(
        "KpiNumber",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=PRIMARY_DARK,
        alignment=1,  # Center
    )
    kpi_label_style = ParagraphStyle(
        "KpiLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
        textColor=MUTED_TEXT,
        alignment=1,  # Center
    )
    footer_style = ParagraphStyle(
        "FooterText",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=7.5,
        leading=10,
        textColor=MUTED_TEXT,
        alignment=1,
    )
    exec_box_style = ParagraphStyle(
        "ExecBoxStyle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=DARK_TEXT,
    )
    tradeoff_dim_style = ParagraphStyle(
        "TradeoffDim",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10.5,
        textColor=PRIMARY_TEAL,
    )
    tradeoff_desc_style = ParagraphStyle(
        "TradeoffDesc",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.8,
        leading=10.5,
        textColor=DARK_TEXT,
    )
    rec_title_style = ParagraphStyle(
        "RecTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10.5,
        textColor=DARK_TEXT,
    )
    badge_high = ParagraphStyle(
        "BadgeHigh",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8,
        textColor=colors.HexColor("#DC2626"),
        alignment=1,
    )
    badge_med = ParagraphStyle(
        "BadgeMed",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8,
        textColor=colors.HexColor("#D97706"),
        alignment=1,
    )
    badge_low = ParagraphStyle(
        "BadgeLow",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8,
        textColor=PRIMARY_TEAL,
        alignment=1,
    )

    story = []

    # 1. Header Banner
    story.append(Paragraph("ECOGRID AI 2.0 · FIELD REPORT", eyebrow_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Urban Climate Intervention & Resilience Brief", title_style))
    story.append(Spacer(1, 3))

    generated_date = datetime.now(timezone.utc).strftime("%d %B %Y %H:%M UTC")
    story.append(
        Paragraph(
            f"Study Area: <b>{study_name}</b> ({study_id}) · Generated: {generated_date} · Multi-Objective CP-SAT Solver",
            subtitle_style,
        )
    )
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY_DARK, spaceBefore=0, spaceAfter=10))

    # Extract Plan Metrics
    total_cost = getattr(plan, "total_cost", 0.0) if hasattr(plan, "total_cost") else plan.get("total_cost", 0.0) if isinstance(plan, dict) else 0.0
    cells_improved = getattr(plan, "cells_improved", 0) if hasattr(plan, "cells_improved") else plan.get("cells_improved", 0) if isinstance(plan, dict) else 0
    utilization = getattr(plan, "utilization", 0.0) if hasattr(plan, "utilization") else plan.get("utilization", 0.0) if isinstance(plan, dict) else 0.0
    selected_candidates = getattr(plan, "selected", []) if hasattr(plan, "selected") else plan.get("selected", []) if isinstance(plan, dict) else []

    # Extract Connectivity Metrics
    before_comp = getattr(connectivity, "before_components", 0) if hasattr(connectivity, "before_components") else connectivity.get("before_components", 0) if isinstance(connectivity, dict) else 0
    after_comp = getattr(connectivity, "after_components", 0) if hasattr(connectivity, "after_components") else connectivity.get("after_components", 0) if isinstance(connectivity, dict) else 0
    new_conn = getattr(connectivity, "new_connections", 0) if hasattr(connectivity, "new_connections") else connectivity.get("new_connections", 0) if isinstance(connectivity, dict) else 0
    isolated = getattr(connectivity, "isolated_patches", []) if hasattr(connectivity, "isolated_patches") else connectivity.get("isolated_patches", []) if isinstance(connectivity, dict) else []

    # 2. Executive KPI Summary Cards
    kpi_data = [
        [
            Paragraph(f"{cell_count}", kpi_number_style),
            Paragraph(f"{critical_count}", kpi_number_style),
            Paragraph(f"INR {total_cost:,.0f}", kpi_number_style),
            Paragraph(f"{round(utilization * 100)}%", kpi_number_style),
            Paragraph(f"{cells_improved}", kpi_number_style),
            Paragraph(f"{before_comp} to {after_comp}", kpi_number_style),
        ],
        [
            Paragraph("GRID CELLS", kpi_label_style),
            Paragraph("CRITICAL RISK", kpi_label_style),
            Paragraph("TOTAL ALLOCATED", kpi_label_style),
            Paragraph("BUDGET UTILIZED", kpi_label_style),
            Paragraph("CELLS IMPROVED", kpi_label_style),
            Paragraph("GREEN PATCHES", kpi_label_style),
        ],
    ]

    col_w = (doc.width) / 6.0
    kpi_table = Table(kpi_data, colWidths=[col_w] * 6)
    kpi_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#D1FAE5")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ])
    )
    story.append(kpi_table)
    story.append(Spacer(1, 14))

    # 3. Interventions Plan Section
    story.append(Paragraph("Selected High-Impact Interventions", section_heading))
    story.append(
        Paragraph(
            f"OR-Tools CP-SAT exact knapsack optimization allocated <b>INR {total_cost:,.0f}</b> across <b>{len(selected_candidates)}</b> site-specific actions targeting urban thermal relief, pedestrian exposure, and canopy gaps.",
            body_style,
        )
    )
    story.append(Spacer(1, 6))

    # Table of selected candidates
    table_headers = ["Cell", "Zone / Area", "Intervention Type", "Units", "Cost (INR)", "Suitability"]
    candidate_rows = [
        [Paragraph(f"<b>{h}</b>", kpi_label_style) for h in table_headers]
    ]

    # Display up to 25 top prioritized actions for crisp executive brief
    display_candidates = selected_candidates[:25]
    for c in display_candidates:
        cell_id = getattr(c, "cell_id", "") if hasattr(c, "cell_id") else c.get("cell_id", "")
        area_name = getattr(c, "area_name", "") if hasattr(c, "area_name") else c.get("area_name", "")
        int_name = getattr(c, "intervention_name", "") if hasattr(c, "intervention_name") else c.get("intervention_name", "")
        qty = getattr(c, "quantity", 1) if hasattr(c, "quantity") else c.get("quantity", 1)
        unit = getattr(c, "unit", "") if hasattr(c, "unit") else c.get("unit", "")
        cost = getattr(c, "cost", 0.0) if hasattr(c, "cost") else c.get("cost", 0.0)
        suitability = getattr(c, "suitability_score", 0.0) if hasattr(c, "suitability_score") else c.get("suitability_score", 0.0)

        candidate_rows.append([
            Paragraph(f"<b>{cell_id}</b>", body_style),
            Paragraph(area_name, body_style),
            Paragraph(int_name, body_style),
            Paragraph(f"{qty:.0f} {unit}", body_style),
            Paragraph(f"{cost:,.0f}", body_style),
            Paragraph(f"{suitability:.1f}%", body_style),
        ])

    cand_table = Table(
        candidate_rows,
        colWidths=[36, 134, 160, 68, 62, 55],
        repeatRows=1,
    )
    cand_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E6F4EA")),
            ("TEXTCOLOR", (0, 0), (-1, 0), PRIMARY_DARK),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("ALIGN", (3, 0), (5, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
        ])
    )
    story.append(cand_table)

    if len(selected_candidates) > 25:
        story.append(Spacer(1, 4))
        story.append(
            Paragraph(
                f"<i>Note: Displaying top 25 high-impact actions. All {len(selected_candidates)} allocated site interventions are exported in the complete JSON planning dataset.</i>",
                footer_style,
            )
        )
    # 4. AI Decision Briefing & Strategic Trade-Offs (if provided)
    if ai_briefing and isinstance(ai_briefing, dict):
        exec_sum = ai_briefing.get("executiveSummary", "")
        trade_offs = ai_briefing.get("tradeOffs", [])
        recommendations = ai_briefing.get("recommendations", [])

        story.append(Paragraph("AI Executive Decision Briefing & Strategic Trade-Offs", section_heading))

        # Executive Summary Callout Box
        if exec_sum:
            clean_exec_sum = exec_sum.replace("**", "<b>").replace("</b><b>", "")
            if clean_exec_sum.count("<b>") > clean_exec_sum.count("</b>"):
                clean_exec_sum += "</b>"
            exec_card = [
                [
                    Paragraph(
                        f"<b>EXECUTIVE SYNTHESIS:</b> {clean_exec_sum}",
                        exec_box_style,
                    )
                ]
            ]
            exec_table = Table(exec_card, colWidths=[doc.width])
            exec_table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ECFDF5")),
                    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#A7F3D0")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ])
            )
            story.append(exec_table)
            story.append(Spacer(1, 8))

        # Strategic Trade-Offs Table
        if trade_offs:
            story.append(Paragraph("Strategic Trade-Off Analysis", ParagraphStyle(
                "SubSectionHeading", parent=section_heading, fontSize=9.5, leading=12, spaceBefore=4, spaceAfter=4,
            )))
            to_rows = [
                [
                    Paragraph("<b>STRATEGIC DIMENSION</b>", kpi_label_style),
                    Paragraph("<b>OPTIMIZER OBSERVATION & IMPLICATION</b>", kpi_label_style),
                ]
            ]
            for t in trade_offs[:3]:
                dim = str(t.get("dimension", ""))
                obs = str(t.get("observation", ""))
                imp = str(t.get("implication", ""))
                desc_text = f"<b>Observation:</b> {obs}<br/><br/><b>Implication:</b> {imp}"
                to_rows.append([
                    Paragraph(dim, tradeoff_dim_style),
                    Paragraph(desc_text, tradeoff_desc_style),
                ])
            to_table = Table(to_rows, colWidths=[140, doc.width - 140], repeatRows=1)
            to_table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E6F4EA")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), PRIMARY_DARK),
                    ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ])
            )
            story.append(to_table)
            story.append(Spacer(1, 8))

        # Prioritized Next Steps Table
        if recommendations:
            story.append(Paragraph("Prioritized Implementation Recommendations & Next Steps", ParagraphStyle(
                "SubSectionHeading2", parent=section_heading, fontSize=9.5, leading=12, spaceBefore=4, spaceAfter=4,
            )))
            rec_rows = [
                [
                    Paragraph("<b>PRIORITY</b>", kpi_label_style),
                    Paragraph("<b>ACTION ITEM</b>", kpi_label_style),
                    Paragraph("<b>TIMELINE</b>", kpi_label_style),
                    Paragraph("<b>OPERATIONAL SCOPE</b>", kpi_label_style),
                ]
            ]
            for r in recommendations[:4]:
                pri = str(r.get("priority", "MEDIUM")).upper()
                pri_style = badge_high if pri == "HIGH" else badge_low if pri == "LOW" else badge_med
                title = str(r.get("title", ""))
                tl = str(r.get("timeline", "Phase 1"))
                desc = str(r.get("description", ""))
                rec_rows.append([
                    Paragraph(f"<b>[{pri}]</b>", pri_style),
                    Paragraph(title, rec_title_style),
                    Paragraph(tl, body_style),
                    Paragraph(desc, tradeoff_desc_style),
                ])
            rec_table = Table(rec_rows, colWidths=[50, 130, 60, doc.width - 240], repeatRows=1)
            rec_table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E6F4EA")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), PRIMARY_DARK),
                    ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("ALIGN", (0, 1), (0, -1), "CENTER"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ])
            )
            story.append(rec_table)
            story.append(Spacer(1, 10))

    # 5. Connectivity & Corridors
    story.append(Paragraph("Ecological Connectivity & Corridor Analysis", section_heading))
    conn_text = (
        f"Graph percolation analysis indicates ecological fragmentation reduction from <b>{before_comp}</b> isolated components down to <b>{after_comp}</b> post-intervention. "
        f"A total of <b>{new_conn}</b> new corridor adjacencies were formed, mitigating <b>{len(isolated)}</b> previously isolated canopy patches."
    )
    story.append(Paragraph(conn_text, body_style))
    story.append(Spacer(1, 10))

    # 5. Safety Gating & Methodology Footer Box
    governance_box = [
        [
            Paragraph(
                "<b>Safety Gating & Data Provenance Notice:</b> "
                "EcoGrid AI automatically enforces physical vetoes (water cell feasibility = 0, airport obstacle clearance, underground utility buffers &gt; 3.0m). "
                "Spectral signatures calibrated against Sentinel-2 MSI NDVI and Landsat 8/9 LST. "
                "Estimates are decision-support outputs. Conduct ground geotechnical inspection before field deployment.",
                footer_style,
            )
        ]
    ]
    gov_table = Table(governance_box, colWidths=[doc.width])
    gov_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F4F6")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ])
    )
    story.append(KeepTogether(gov_table))

    # Build PDF with two-pass dynamic page numbering
    doc.build(story, canvasmaker=NumberedCanvas)
    return buffer.getvalue()
