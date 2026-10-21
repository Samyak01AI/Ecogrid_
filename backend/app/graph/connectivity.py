"""
EcoGrid AI — NetworkX Green Connectivity Analysis

Models existing green spaces as nodes and spatial connections as edges.
Uses NetworkX to calculate connectivity indicators and identify
candidate corridor opportunities.

This is a PROTOTYPE connectivity model, not a validated ecological assessment.
"""
from __future__ import annotations

import networkx as nx

from app.schemas.schemas import (
    CellResponse,
    ConnectivityResponse,
    GreenComponent,
    GreenLink,
)

# Threshold for considering a cell as a green patch
GREEN_THRESHOLD = 0.3
COMPONENT_COLORS = [
    "#4CC38A", "#77DDB1", "#2FAD88", "#A7F1CD",
    "#63C7A2", "#1F8A70", "#9BE2C1", "#37B988",
]


def analyze_connectivity(
    cells: list[CellResponse],
    planned_cell_ids: list[str] | None = None,
) -> ConnectivityResponse:
    """
    Build a graph of green spaces and analyze connectivity.

    Nodes: existing green patches (cells with green cover >= threshold)
    Edges: spatial adjacency connections

    Returns connected components, isolated patches, potential links,
    and candidate connectivity-gap cells.

    PROTOTYPE CONNECTIVITY MODEL — not a validated ecological corridor assessment.
    """
    planned = set(planned_cell_ids or [])

    # Index cells by (row, col)
    cell_by_pos = {(c.row, c.col): c for c in cells}
    cell_by_id = {c.cell_id: c for c in cells}

    # Identify existing green patches
    existing_green = [
        c for c in cells
        if c.existing_green_cover >= GREEN_THRESHOLD
    ]
    existing_ids = set(c.cell_id for c in existing_green)

    # Build the "before" graph (existing green patches only)
    before_graph = nx.Graph()
    for c in existing_green:
        before_graph.add_node(c.cell_id, row=c.row, col=c.col, area_name=c.area_name)

    # Add edges between adjacent green patches
    before_links: list[GreenLink] = []
    for c in existing_green:
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            neighbor_pos = (c.row + dr, c.col + dc)
            neighbor = cell_by_pos.get(neighbor_pos)
            if neighbor and neighbor.cell_id in existing_ids:
                if not before_graph.has_edge(c.cell_id, neighbor.cell_id):
                    before_graph.add_edge(c.cell_id, neighbor.cell_id)
                    # Only add link once
                    from_id = min(c.cell_id, neighbor.cell_id)
                    to_id = max(c.cell_id, neighbor.cell_id)
                    if not any(l.from_cell == from_id and l.to_cell == to_id for l in before_links):
                        before_links.append(GreenLink(from_cell=from_id, to_cell=to_id, kind="existing"))

    # Build the "after" graph (existing + planned)
    after_graph = before_graph.copy()
    proposed_links: list[GreenLink] = []

    for cell_id in planned:
        cell = cell_by_id.get(cell_id)
        if not cell:
            continue
        if cell_id not in after_graph:
            after_graph.add_node(cell_id, row=cell.row, col=cell.col, area_name=cell.area_name)

        # Connect to adjacent green/planned nodes
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            neighbor_pos = (cell.row + dr, cell.col + dc)
            neighbor = cell_by_pos.get(neighbor_pos)
            if not neighbor:
                continue
            if neighbor.cell_id in after_graph:
                if not after_graph.has_edge(cell_id, neighbor.cell_id):
                    after_graph.add_edge(cell_id, neighbor.cell_id)
                    from_id = min(cell_id, neighbor.cell_id)
                    to_id = max(cell_id, neighbor.cell_id)
                    proposed_links.append(GreenLink(from_cell=from_id, to_cell=to_id, kind="potential"))

    # Analyze connected components
    before_components = list(nx.connected_components(before_graph))
    after_components = list(nx.connected_components(after_graph))

    # Build component response objects
    components: list[GreenComponent] = []
    for i, comp in enumerate(after_components):
        comp_ids = sorted(comp)
        components.append(GreenComponent(
            id=f"COMP-{i + 1:02d}",
            cell_ids=comp_ids,
            color=COMPONENT_COLORS[i % len(COMPONENT_COLORS)],
            isolated=len(comp_ids) == 1,
        ))

    # Isolated patches (single-cell components in the before graph)
    isolated_patches = [
        list(comp)[0]
        for comp in before_components
        if len(comp) == 1
    ]

    # Connectivity scores
    before_score = (
        len(before_links) / max(1, len(existing_green))
        if existing_green else 0
    )
    after_n_nodes = after_graph.number_of_nodes()
    after_n_edges = after_graph.number_of_edges()
    after_score = after_n_edges / max(1, after_n_nodes) if after_n_nodes > 0 else 0

    new_connections = max(0, len(before_components) - len(after_components))

    all_links = before_links + proposed_links

    return ConnectivityResponse(
        components=components,
        links=all_links,
        isolated_patches=isolated_patches,
        before_components=len(before_components),
        after_components=len(after_components),
        before_score=round(min(1, before_score), 3),
        after_score=round(min(1, after_score), 3),
        new_connections=new_connections,
    )
