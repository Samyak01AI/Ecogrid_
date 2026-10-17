import type { Cell, ConnectivityResult, GreenComponent, GreenLink } from './types.js';

const COMPONENT_COLORS = ['#4CC38A', '#77DDB1', '#2FAD88', '#A7F1CD', '#63C7A2', '#1F8A70', '#9BE2C1', '#37B988'];
const GREEN_THRESHOLD = 0.34;

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function adjacentPairs(cells: readonly Cell[]): readonly GreenLink[] {
  const byPosition = new Map(cells.map((cell) => [cellKey(cell.row, cell.col), cell]));
  const links: GreenLink[] = [];
  for (const cell of cells) {
    const right = byPosition.get(cellKey(cell.row, cell.col + 1));
    const below = byPosition.get(cellKey(cell.row + 1, cell.col));
    if (right) links.push({ from: cell.id, to: right.id, kind: 'existing' });
    if (below) links.push({ from: cell.id, to: below.id, kind: 'existing' });
  }
  return links;
}

function connectedComponents(nodes: readonly Cell[], links: readonly GreenLink[], planned: ReadonlySet<string>): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const link of links) {
    adjacency.get(link.from)?.add(link.to);
    adjacency.get(link.to)?.add(link.from);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const queue = [node.id];
    const component: string[] = [];
    seen.add(node.id);
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) continue;
      component.push(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  for (const id of planned) {
    if (adjacency.has(id) || !nodes.some((node) => node.id === id)) continue;
    components.push([id]);
  }
  return components;
}

export function analyzeConnectivity(cells: readonly Cell[], plannedCellIds: readonly string[] = []): ConnectivityResult {
  const planned = new Set(plannedCellIds);
  const existing = cells.filter((cell) => cell.existingGreenCover >= GREEN_THRESHOLD);
  const plannedCells = cells.filter((cell) => planned.has(cell.id));
  const expanded = new Map<string, Cell>();
  for (const cell of [...existing, ...plannedCells]) expanded.set(cell.id, cell);
  const networkNodes = [...expanded.values()].sort((left, right) => left.row - right.row || left.col - right.col);
  const existingLinks = adjacentPairs(existing);
  const proposedLinks: GreenLink[] = [];
  for (const plannedCell of plannedCells) {
    for (const neighbor of networkNodes) {
      if (neighbor.id === plannedCell.id) continue;
      const isAdjacent = Math.abs(neighbor.row - plannedCell.row) <= 1 && Math.abs(neighbor.col - plannedCell.col) <= 1;
      if (!isAdjacent) continue;
      const from = plannedCell.id.localeCompare(neighbor.id) < 0 ? plannedCell.id : neighbor.id;
      const to = from === plannedCell.id ? neighbor.id : plannedCell.id;
      const duplicate = existingLinks.some((link) => link.from === from && link.to === to) || proposedLinks.some((link) => link.from === from && link.to === to);
      if (!duplicate) proposedLinks.push({ from, to, kind: 'new' });
    }
  }
  const beforeComponentsRaw = connectedComponents(existing, existingLinks, new Set());
  const afterLinks = [...existingLinks, ...proposedLinks];
  const afterComponentsRaw = connectedComponents(networkNodes, afterLinks, planned);
  const components: GreenComponent[] = afterComponentsRaw.map((ids, index) => ({
    id: `COMP-${String(index + 1).padStart(2, '0')}`,
    color: COMPONENT_COLORS[index % COMPONENT_COLORS.length] as string,
    cellIds: ids,
    isolated: ids.length === 1,
  }));
  const isolatedPatches = beforeComponentsRaw.filter((component) => component.length === 1).flatMap((component) => component);
  const beforeScore = existing.length === 0 ? 0 : Math.min(1, existingLinks.length / Math.max(1, existing.length));
  const afterScore = networkNodes.length === 0 ? 0 : Math.min(1, afterLinks.length / Math.max(1, networkNodes.length));
  const newConnections = Math.max(0, beforeComponentsRaw.length - afterComponentsRaw.length);
  const links: GreenLink[] = [...existingLinks, ...proposedLinks];
  return { components, isolatedPatches, links, beforeComponents: beforeComponentsRaw.length, afterComponents: afterComponentsRaw.length, beforeScore, afterScore, newConnections };
}
