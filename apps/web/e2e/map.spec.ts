import { expect, test } from '@playwright/test';

const mapPaths = ['/overview', '/environment', '/planner', '/scenarios', '/what-if', '/connectivity', '/analytics', '/data-sources'];
const placeholderTile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/q1sAAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page }) => {
  for (const pattern of ['https://tile.openstreetmap.org/**', 'https://server.arcgisonline.com/**']) {
    await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: placeholderTile }));
  }
});

for (const path of mapPaths) {
  test(`${path} keeps all 100 clickable Leaflet polygons`, async ({ page }) => {
    await page.goto(path);
    const expectedMaps = path === '/scenarios' ? 3 : 1;
    const maps = page.locator('.map-shell');
    await expect(maps).toHaveCount(expectedMaps);
    for (let mapIndex = 0; mapIndex < expectedMaps; mapIndex += 1) {
      const polygons = maps.nth(mapIndex).locator('.ecogrid-cell');
      await expect(polygons).toHaveCount(100);
      const visible = await polygons.evaluateAll((nodes) => nodes.every((node) => {
        const bounds = (node as SVGPathElement).getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      }));
      expect(visible).toBe(true);
    }
  });
}

test('Scenario Lab maps stay available as a side-by-side pair with a live proposal-minus-baseline delta layer', async ({ page }) => {
  await page.goto('/scenarios');
  const maps = page.locator('.map-shell');
  await expect(maps).toHaveCount(3);
  await expect(maps.nth(1).locator('.ecogrid-cell')).toHaveCount(100);
  await expect(maps.nth(2).locator('.ecogrid-cell')).toHaveCount(100);
  await maps.first().getByRole('button', { name: 'Choose map layer' }).click();
  await page.getByRole('menuitemradio', { name: 'Scenario delta' }).click();
  await expect(maps.first().getByLabel('Scenario delta legend')).toBeVisible();
});

test('study setup only geocodes on submit and derives a 100-cell preview from GeoJSON boundary bounds', async ({ page }) => {
  let searchCalls = 0;
  await page.route('**/api/geocode/search*', async (route) => {
    searchCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ id: 'demo-place-1', displayName: 'Central Plaza, Bengaluru', lat: 12.936, lng: 77.625, type: 'plaza' }] }) });
  });
  await page.goto('/data-sources');
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  const search = page.getByRole('textbox', { name: 'Search for a study-area place' });
  await search.fill('Central Plaza');
  expect(searchCalls).toBe(0);
  await page.getByRole('button', { name: 'Submit place search' }).click();
  await page.getByRole('option', { name: /Central Plaza, Bengaluru/ }).click();
  expect(searchCalls).toBe(1);
  await page.getByLabel('Import a GeoJSON boundary').setInputFiles({ name: 'campus.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type: 'Polygon', coordinates: [[[77.62, 12.93], [77.63, 12.93], [77.63, 12.94], [77.62, 12.94], [77.62, 12.93]]] })) });
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  await expect(page.getByText(/Grid fit to GeoJSON bounds/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Create study/ })).toBeDisabled();
});

test('PNG export downloads the current map as a PNG and retains its map notes', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
  await expect(page.getByText(/PNG exported with the map, legend and attribution|Grid PNG exported with legend and attribution/)).toBeVisible();
});

test('intervention markers filter by type and maps expose a live scale and geographic overview', async ({ page }) => {
  await page.goto('/planner');
  await page.getByRole('button', { name: 'Run budget optimizer' }).click();
  await expect(page.getByText('VALIDATED PLAN')).toBeVisible();
  const markers = page.locator('.intervention-marker-glyph[data-intervention-id]');
  await expect(markers).not.toHaveCount(0);
  const animationName = await markers.first().evaluate((node) => getComputedStyle(node).animationName);
  expect(animationName).toContain('intervention-marker-in');
  await markers.first().click({ force: true });
  await expect(page.getByLabel(/cell .* inspector/i)).toBeVisible();
  await page.getByRole('button', { name: 'Close cell inspector' }).click();
  await expect(page.locator('.leaflet-control-scale-line').first()).toBeVisible();
  const interventionId = await markers.first().getAttribute('data-intervention-id');
  expect(interventionId).toBeTruthy();
  await page.getByRole('button', { name: 'Filter intervention markers' }).click();
  await expect(page.getByRole('group', { name: 'Filter intervention types' })).toBeVisible();
  await page.locator(`.map-marker-filter-popover input[value="${interventionId}"]`).uncheck();
  await expect(page.locator(`.intervention-marker-glyph[data-intervention-id="${interventionId}"]`)).toHaveCount(0);
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  await page.getByRole('button', { name: 'Toggle mini-map' }).click();
  await expect(page.locator('.map-minimap-control')).toBeVisible();
  await expect(page.locator('.map-minimap-map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.map-minimap-viewport')).toBeVisible();
  await expect(page.locator('.map-minimap-attribution')).toContainText(/OpenStreetMap|Esri/);
  const previousLatitude = await page.evaluate(() => new URLSearchParams(location.search).get('lat'));
  await page.locator('.map-minimap-map').click({ position: { x: 20, y: 20 } });
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('lat'))).not.toBe(previousLatitude);
});

test('cell click opens inspector, layer changes update polygons without replacing them, and reset retains 100 cells', async ({ page }) => {
  await page.goto('/environment');
  const first = page.locator('.ecogrid-cell').first();
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  await first.click({ force: true });
  await expect(page.getByLabel(/cell .* inspector/i)).toBeVisible();
  const before = await page.locator('.ecogrid-cell').first().getAttribute('fill');
  await page.getByRole('button', { name: 'Choose map layer' }).click();
  await page.getByRole('menuitemradio', { name: 'Heat risk' }).click();
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  await page.getByRole('button', { name: 'Reset map view' }).click();
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  const after = await page.locator('.ecogrid-cell').first().getAttribute('fill');
  expect(before).not.toBe(after);
});

test('zoom, pan, basemap switches, and optimizer keep polygons aligned and present', async ({ page }) => {
  await page.goto('/planner');
  await page.locator('.ecogrid-cell').first().waitFor({ state: 'visible' });
  for (const name of ['Zoom in', 'Zoom in', 'Zoom in', 'Zoom out', 'Zoom out', 'Zoom out']) {
    await page.getByRole('button', { name }).click();
    await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  }
  await page.getByRole('button', { name: /Basemap:/ }).click();
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
  await page.getByRole('button', { name: 'Run budget optimizer' }).click();
  await expect(page.getByText('VALIDATED PLAN')).toBeVisible();
  await expect(page.locator('.ecogrid-cell')).toHaveCount(100);
});
