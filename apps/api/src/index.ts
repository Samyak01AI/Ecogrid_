import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import PDFDocument from 'pdfkit';
import type { PrismaClient as GeneratedPrismaClient } from '../prisma/generated/postgres/index.js';
import { databaseUrlForPrisma } from './database-url.js';
import { ModelError, applyPredictions, callModel, modelConfig, modelHealth, type ModelRun } from './model-client.js';
import {
  DEFAULT_STUDY,
  INTERVENTIONS,
  analyzeConnectivity,
  combinedPriority,
  computeCellConfidence,
  confidenceSummary,
  createGrid,
  illustrativeInput,
  layerScore,
  optimizePlan,
  planConfidence,
  riskBand,
  simulateWhatIf,
  type Cell,
  type InterventionId,
  type OptimizerInput,
  type ScoreWeights,
  type StudyArea,
} from '@ecogrid/domain';
import {
  authLoginSchema,
  authRegisterSchema,
  csvImportSchema,
  geoJsonImportSchema,
  optimizeRequestSchema,
  scenarioCreateSchema,
  studyCreateSchema,
  whatIfRequestSchema,
} from '@ecogrid/contracts';

const cellCache = new Map<string, Cell[]>();
const modelRuns = new Map<string, ModelRun>();
const studies = new Map<string, StudyArea>([[DEFAULT_STUDY.id, DEFAULT_STUDY]]);
const scenarios = new Map<string, { id: string; studyId: string; name: string; description?: string; budget: number; weights: ScoreWeights; enabledInterventions: readonly InterventionId[]; plan: ReturnType<typeof optimizePlan>; createdAt: string }[]>();
type PlaceSearchResult = { id: string; displayName: string; lat: number; lng: number; type: string };
const placeSearchCache = new Map<string, { expiresAt: number; results: PlaceSearchResult[] }>();
let nextNominatimRequestAt = 0;

const runtimeProvider = process.env.DATABASE_PROVIDER === 'mysql' || (process.env.DATABASE_URL?.startsWith('mysql') ?? false) ? 'mysql' : 'postgres';
const runtimeDatabaseUrl = databaseUrlForPrisma(runtimeProvider, process.env.DATABASE_URL);
type DbClient = GeneratedPrismaClient;
let dbPromise: Promise<DbClient> | undefined;
async function getDb(): Promise<DbClient | undefined> {
  if (!runtimeDatabaseUrl) return undefined;
  dbPromise ??= runtimeProvider === 'mysql'
    ? import('../prisma/generated/mysql/index.js').then(({ PrismaClient }) => new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl } } }) as unknown as DbClient)
    : import('../prisma/generated/postgres/index.js').then(({ PrismaClient }) => new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl } } }));
  return dbPromise;
}

function getCells(studyId: string): Cell[] {
  const cached = cellCache.get(studyId);
  if (cached) return cached;
  const study = studies.get(studyId);
  if (!study) throw Object.assign(new Error('Study area not found.'), { statusCode: 404 });
  const cells = createGrid(study);
  cellCache.set(studyId, cells);
  return cells;
}

type ScenarioRecord = { id: string; studyAreaId: string; name: string; description: string | null; budget: number; weightsJson: string; enabledInterventionsJson: string; planJson: string | null; createdAt: Date };
function fromScenarioRecord(record: ScenarioRecord) {
  const weights = JSON.parse(record.weightsJson) as ScoreWeights;
  const enabledInterventions = JSON.parse(record.enabledInterventionsJson) as InterventionId[];
  const plan = record.planJson ? JSON.parse(record.planJson) as ReturnType<typeof optimizePlan> : computePlan(record.studyAreaId, record.budget, weights, enabledInterventions);
  return { id: record.id, studyId: record.studyAreaId, name: record.name, ...(record.description ? { description: record.description } : {}), budget: record.budget, weights, enabledInterventions, plan, createdAt: record.createdAt.toISOString() };
}

async function hydrateDatabaseCache(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const [studyRecords, scenarioRecords] = await Promise.all([
      db.studyArea.findMany({ include: { cells: true } }),
      db.scenario.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);
    for (const record of studyRecords) {
      const study: StudyArea = { id: record.id, name: record.name, origin: [record.originLat, record.originLng], rows: record.rows, columns: record.columns, cellSizeLat: record.cellSizeLat, cellSizeLng: record.cellSizeLng, rotation: record.rotation };
      studies.set(study.id, study);
      const prefix = `${study.id}:`;
      const cells: Cell[] = record.cells.map((cell) => ({
        id: cell.id.startsWith(prefix) ? cell.id.slice(prefix.length) : cell.id,
        row: cell.row,
        col: cell.col,
        center: [cell.centerLat, cell.centerLng],
        polygon: JSON.parse(cell.polygonJson) as Cell['polygon'],
        areaName: cell.areaName,
        landUse: cell.landUse as Cell['landUse'],
        surfaceType: cell.surfaceType as Cell['surfaceType'],
        scores: { heat: cell.heat, vegetation: cell.vegetation, pedestrian: cell.pedestrian, connectivity: cell.connectivity, feasibility: cell.feasibility },
        existingGreenCover: cell.existingGreenCover,
        priorityZone: cell.priorityZone,
        dataConfidence: cell.dataConfidence,
        capacity: cell.capacity,
      }));
      cellCache.set(study.id, cells);
    }
    for (const record of scenarioRecords) {
      const entry = fromScenarioRecord(record);
      const records = scenarios.get(entry.studyId) ?? [];
      records.push(entry);
      scenarios.set(entry.studyId, records);
    }
  } catch (error) {
    app.log.warn({ err: error }, 'Database cache hydration skipped; seeded demo data remains available.');
  }
}

async function persistCellScores(studyId: string, cells: readonly Cell[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (let start = 0; start < cells.length; start += 50) {
    const batch = cells.slice(start, start + 50);
    await Promise.all(batch.map((cell) => db.cell.updateMany({
      where: { studyAreaId: studyId, row: cell.row, col: cell.col },
      data: { heat: cell.scores.heat, vegetation: cell.scores.vegetation, pedestrian: cell.scores.pedestrian, connectivity: cell.scores.connectivity, feasibility: cell.scores.feasibility, dataConfidence: cell.dataConfidence },
    })));
  }
}

function accessSecret(): Uint8Array {
  const value = process.env.ECOGRID_JWT_ACCESS_SECRET;
  if (!value || value.length < 32) throw new Error('ECOGRID_JWT_ACCESS_SECRET must be configured with at least 32 characters.');
  return new TextEncoder().encode(value);
}
function refreshSecret(): Uint8Array {
  const value = process.env.ECOGRID_JWT_REFRESH_SECRET;
  if (!value || value.length < 32) throw new Error('ECOGRID_JWT_REFRESH_SECRET must be configured with at least 32 characters.');
  return new TextEncoder().encode(value);
}
function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function expiresIn(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}

interface UserPayload extends JWTPayload {
  sub: string;
  role: 'admin' | 'planner' | 'viewer';
  email: string;
  type: 'access' | 'refresh';
}
const app = Fastify({ logger: true, bodyLimit: 2_100_000, trustProxy: true });

await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
await app.register(cookie);
const allowedOrigins = new Set((process.env.WEB_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean));
if (allowedOrigins.size) await app.register(cors, {
  credentials: true,
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
});
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
await app.register(swagger, { openapi: { info: { title: 'EcoGrid AI API', version: '2.0.0', description: 'Urban climate planning and intervention optimization.' }, servers: [{ url: '/api' }] } });
await app.register(swaggerUi, { routePrefix: '/api/docs', uiConfig: { docExpansion: 'list', deepLinking: true } });
const webBuildPath = resolve(process.cwd(), 'apps/web/dist');
if (existsSync(webBuildPath)) {
  await app.register(fastifyStatic, { root: webBuildPath, prefix: '/', wildcard: false });
}
app.addHook('onSend', async (_request, reply) => { reply.header('x-content-type-options', 'nosniff'); });
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Request failed');
  const validation = error.validation ? { issues: error.validation } : undefined;
  reply.status(error.statusCode ?? (error instanceof z.ZodError ? 400 : 500)).send({ error: error.message || 'Internal server error', ...(validation ? { validation } : {}) });
});

async function authenticate(request: FastifyRequest): Promise<UserPayload> {
  const authorization = request.headers.authorization;
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  const cookie = request.cookies?.webdev_app_session;
  const token = bearer || cookie;
  if (!token) throw Object.assign(new Error('Authentication required.'), { statusCode: 401 });
  try {
    const { payload } = await jwtVerify(token, accessSecret(), { algorithms: ['HS256'] });
    const user = payload as UserPayload;
    if (user.type !== 'access' || !user.sub || !user.role) throw new Error('Invalid access token.');
    return user;
  } catch {
    throw Object.assign(new Error('Session is invalid or expired.'), { statusCode: 401 });
  }
}

async function requireRole(request: FastifyRequest, roles: readonly UserPayload['role'][]): Promise<UserPayload> {
  const user = await authenticate(request);
  if (!roles.includes(user.role)) throw Object.assign(new Error('Your role cannot perform this action.'), { statusCode: 403 });
  return user;
}

async function issueSession(user: { id: string; email: string; role: UserPayload['role'] }): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = await new SignJWT({ email: user.email, role: user.role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime(expiresIn(process.env.ACCESS_TOKEN_TTL_SECONDS ? `${process.env.ACCESS_TOKEN_TTL_SECONDS}s` : undefined, '15m')).sign(accessSecret());
  const refreshJti = randomBytes(24).toString('base64url');
  const refreshToken = await new SignJWT({ email: user.email, role: user.role, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setJti(refreshJti).setIssuedAt().setExpirationTime(expiresIn(process.env.REFRESH_TOKEN_TTL_DAYS ? `${process.env.REFRESH_TOKEN_TTL_DAYS}d` : undefined, '30d')).sign(refreshSecret());
  const db = await getDb();
  if (db) await db.refreshSession.create({ data: { userId: user.id, tokenHash: hashToken(refreshJti), expiresAt: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400_000) } });
  return { accessToken, refreshToken };
}

function isPublicHttps(request: FastifyRequest): boolean {
  return process.env.PUBLIC_HTTPS === 'true' || request.headers.origin?.startsWith('https://') === true;
}
function setSessionCookies(reply: FastifyReply, request: FastifyRequest, tokens: { accessToken: string; refreshToken: string }): void {
  const secure = isPublicHttps(request);
  const sameSite = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  const accessMaxAge = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);
  const refreshMaxAge = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400;
  reply.header('set-cookie', [
    `webdev_app_session=${encodeURIComponent(tokens.accessToken)}; Path=/; HttpOnly; ${sameSite}; Max-Age=${accessMaxAge}`,
    `ecogrid_refresh=${encodeURIComponent(tokens.refreshToken)}; Path=/api/auth; HttpOnly; ${sameSite}; Max-Age=${refreshMaxAge}`,
  ]);
}

function csvValue(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { field += '"'; index += 1; }
      else if (quoted) quoted = false;
      else if (field.length === 0) quoted = true;
      else field += character;
    } else if (character === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw Object.assign(new Error('CSV contains an unterminated quoted field.'), { statusCode: 400 });
  if (field.length || row.length) { row.push(field); if (row.some((value) => value.length > 0)) rows.push(row); }
  return rows;
}

function computePlan(studyId: string, budget: number, weights: ScoreWeights, enabledInterventions: readonly InterventionId[], constraints?: OptimizerInput['constraints']) {
  const cells = getCells(studyId);
  const result = optimizePlan(cells, { budget, weights, enabledInterventions, ...(constraints ? { constraints } : {}) });
  return { ...result, planConfidence: planConfidence(cells, result.selected) };
}

app.get('/_app/health', async (_request, reply) => reply.send({ ok: true, service: 'ecogrid-api', provider: runtimeProvider }));
app.get('/api/health', async (_request, reply) => reply.send({ ok: true, service: 'ecogrid-api', provider: runtimeProvider }));
app.get('/api/meta', async () => ({ name: 'EcoGrid AI 2.0', version: '2.0.0', provider: runtimeProvider, layers: ['heat', 'vegetation', 'pedestrian', 'connectivity', 'feasibility', 'priority', 'recommended'], defaultGrid: { rows: DEFAULT_STUDY.rows, columns: DEFAULT_STUDY.columns, polygonCount: DEFAULT_STUDY.rows * DEFAULT_STUDY.columns } }));
app.get('/api/interventions', async () => ({ interventions: INTERVENTIONS }));
app.get('/api/auth/me', async (request) => {
  const user = await authenticate(request);
  return { id: user.sub, email: user.email, role: user.role };
});

app.post('/api/auth/register', async (request, reply) => {
  const input = authRegisterSchema.parse(request.body);
  const db = await getDb();
  if (!db) return reply.status(503).send({ error: 'User registration requires a configured database.' });
  const email = input.email.toLowerCase();
  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return reply.status(409).send({ error: 'An account with that email already exists.' });
  const user = await db.user.create({ data: { email, passwordHash: await bcrypt.hash(input.password, 12), role: 'viewer' } });
  const tokens = await issueSession({ id: user.id, email: user.email, role: 'viewer' });
  setSessionCookies(reply, request, tokens);
  return reply.status(201).send({ user: { id: user.id, email: user.email, role: 'viewer' } });
});

app.post('/api/auth/login', async (request, reply) => {
  const input = authLoginSchema.parse(request.body);
  const db = await getDb();
  if (!db) return reply.status(503).send({ error: 'Sign-in requires a configured database.' });
  const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !await bcrypt.compare(input.password, user.passwordHash)) return reply.status(401).send({ error: 'Email or password is incorrect.' });
  const role = user.role === 'admin' || user.role === 'planner' ? user.role : 'viewer';
  const tokens = await issueSession({ id: user.id, email: user.email, role });
  setSessionCookies(reply, request, tokens);
  return reply.send({ user: { id: user.id, email: user.email, role } });
});

app.post('/api/auth/refresh', async (request, reply) => {
  const header = request.headers.authorization;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : request.cookies?.ecogrid_refresh;
  if (!raw) return reply.status(401).send({ error: 'Refresh token is required.' });
  try {
    const { payload } = await jwtVerify(raw, refreshSecret(), { algorithms: ['HS256'] });
    const userPayload = payload as UserPayload;
    if (userPayload.type !== 'refresh' || !payload.jti || !payload.sub) throw new Error('Invalid token.');
    const db = await getDb();
    if (!db) return reply.status(503).send({ error: 'Session refresh requires a configured database.' });
    const session = await db.refreshSession.findUnique({ where: { tokenHash: hashToken(payload.jti) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return reply.status(401).send({ error: 'Refresh session expired or revoked.' });
    await db.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const role = session.user.role === 'admin' || session.user.role === 'planner' ? session.user.role : 'viewer';
    const tokens = await issueSession({ id: session.user.id, email: session.user.email, role });
    setSessionCookies(reply, request, tokens);
    return reply.send({ user: { id: session.user.id, email: session.user.email, role } });
  } catch {
    return reply.status(401).send({ error: 'Refresh token is invalid or expired.' });
  }
});

app.post('/api/auth/logout', async (request, reply) => {
  const header = request.headers.authorization;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : request.cookies?.ecogrid_refresh;
  if (raw) {
    try {
      const { payload } = await jwtVerify(raw, refreshSecret(), { algorithms: ['HS256'] });
      if (payload.jti) {
        const db = await getDb();
        if (db) await db.refreshSession.updateMany({ where: { tokenHash: hashToken(payload.jti), revokedAt: null }, data: { revokedAt: new Date() } });
      }
    } catch { /* Expired sessions are already unusable. */ }
  }
  const sameSite = isPublicHttps(request) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  reply.header('set-cookie', [
    `webdev_app_session=; Path=/; HttpOnly; ${sameSite}; Max-Age=0`,
    `ecogrid_refresh=; Path=/api/auth; HttpOnly; ${sameSite}; Max-Age=0`,
  ]);
  return reply.send({ ok: true });
});

app.get('/api/studies', async () => {
  const db = await getDb();
  if (db) {
    const records = await db.studyArea.findMany({ orderBy: { name: 'asc' } });
    return { studies: records.map((record) => ({ id: record.id, name: record.name, origin: [record.originLat, record.originLng] as const, rows: record.rows, columns: record.columns, cellSizeLat: record.cellSizeLat, cellSizeLng: record.cellSizeLng, rotation: record.rotation, cellCount: record.rows * record.columns })) };
  }
  return { studies: [...studies.values()].map((study) => ({ ...study, cellCount: study.rows * study.columns })) };
});
app.get('/api/geocode/search', async (request, reply) => {
  const { q } = z.object({ q: z.string().trim().min(3).max(160) }).parse(request.query);
  const key = q.toLocaleLowerCase('en');
  const cached = placeSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { results: cached.results };
  const now = Date.now();
  const wait = Math.max(0, nextNominatimRequestAt - now);
  nextNominatimRequestAt = Math.max(now, nextNominatimRequestAt) + 1_000;
  if (wait > 0) await new Promise((resolveTimer) => setTimeout(resolveTimer, wait));
  const cachedAfterWait = placeSearchCache.get(key);
  if (cachedAfterWait && cachedAfterWait.expiresAt > Date.now()) return { results: cachedAfterWait.results };
  const endpoint = new URL('https://nominatim.openstreetmap.org/search');
  endpoint.searchParams.set('q', q);
  endpoint.searchParams.set('format', 'jsonv2');
  endpoint.searchParams.set('addressdetails', '1');
  endpoint.searchParams.set('limit', '5');
  const response = await fetch(endpoint, { headers: { 'user-agent': 'EcoGrid AI 2.0 (interactive study-area place search)', 'accept-language': 'en' }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return reply.code(502).send({ error: 'Place search is temporarily unavailable.' });
  const resultSchema = z.array(z.object({ place_id: z.union([z.string(), z.number()]), display_name: z.string(), lat: z.string(), lon: z.string(), type: z.string().optional() }));
  const payload: unknown = await response.json();
  const results = resultSchema.parse(payload).flatMap((place) => {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [{ id: String(place.place_id), displayName: place.display_name, lat, lng, type: place.type ?? 'place' }] : [];
  });
  placeSearchCache.set(key, { expiresAt: Date.now() + 24 * 60 * 60 * 1_000, results });
  if (placeSearchCache.size > 500) {
    const oldest = placeSearchCache.keys().next().value;
    if (oldest) placeSearchCache.delete(oldest);
  }
  return { results };
});
app.post('/api/studies', async (request, reply) => {
  await requireRole(request, ['planner', 'admin']);
  const input = studyCreateSchema.parse(request.body);
  const study: StudyArea = { id: `study-${randomBytes(8).toString('hex')}`, ...input };
  studies.set(study.id, study);
  const cells = createGrid(study);
  cellCache.set(study.id, cells);
  const db = await getDb();
  if (db) {
    const rows = cells.map((cell) => ({
      id: `${study.id}:${cell.id}`,
      row: cell.row,
      col: cell.col,
      centerLat: cell.center[0],
      centerLng: cell.center[1],
      polygonJson: JSON.stringify(cell.polygon),
      areaName: cell.areaName,
      landUse: cell.landUse,
      surfaceType: cell.surfaceType,
      heat: cell.scores.heat,
      vegetation: cell.scores.vegetation,
      pedestrian: cell.scores.pedestrian,
      connectivity: cell.scores.connectivity,
      feasibility: cell.scores.feasibility,
      existingGreenCover: cell.existingGreenCover,
      priorityZone: cell.priorityZone,
      dataConfidence: cell.dataConfidence,
      capacity: cell.capacity,
    }));
    await db.studyArea.create({
      data: {
        id: study.id,
        name: study.name,
        originLat: study.origin[0],
        originLng: study.origin[1],
        rows: study.rows,
        columns: study.columns,
        cellSizeLat: study.cellSizeLat,
        cellSizeLng: study.cellSizeLng,
        rotation: study.rotation,
        cells: { create: rows },
      },
    });
  }
  return reply.status(201).send({ study, cells });
});

app.get('/api/studies/:id/cells', async (request) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const query = z.object({ layer: z.enum(['heat', 'vegetation', 'pedestrian', 'connectivity', 'feasibility', 'priority', 'recommended']).default('priority') }).parse(request.query);
  const cells = getCells(params.id);
  return { study: studies.get(params.id), count: cells.length, polygons: cells.length, layer: query.layer, cells };
});

app.get('/api/studies/:id', async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const study = studies.get(id);
  if (!study) throw Object.assign(new Error('Study area not found.'), { statusCode: 404 });
  const cells = getCells(id);
  const average = (key: keyof Cell['scores']) => cells.reduce((sum, cell) => sum + cell.scores[key], 0) / cells.length;
  return { study, cellCount: cells.length, polygons: cells.length, metrics: { avgHeat: average('heat'), avgVegetationDeficit: average('vegetation'), avgPedestrianExposure: average('pedestrian'), avgConnectivityNeed: average('connectivity'), criticalCells: cells.filter((cell) => riskBand(combinedPriority(cell.scores)) === 'CRITICAL').length } };
});

app.post('/api/optimize', async (request) => {
  await requireRole(request, ['planner', 'admin']);
  const input = optimizeRequestSchema.parse(request.body);
  const constraints: OptimizerInput['constraints'] = input.constraints ? {
    ...(input.constraints.minFeasibility !== undefined ? { minFeasibility: input.constraints.minFeasibility } : {}),
    ...(input.constraints.maxPerCell !== undefined ? { maxPerCell: input.constraints.maxPerCell } : {}),
    ...(input.constraints.includeCellIds !== undefined ? { includeCellIds: input.constraints.includeCellIds } : {}),
    ...(input.constraints.excludeCellIds !== undefined ? { excludeCellIds: input.constraints.excludeCellIds } : {}),
  } : undefined;
  return computePlan(input.studyId, input.budget, input.weights, input.enabledInterventions, constraints);
});
app.post('/api/whatif', async (request) => {
  await requireRole(request, ['planner', 'admin']);
  const input = whatIfRequestSchema.parse(request.body);
  const cell = getCells(input.studyId).find((candidate) => candidate.id === input.cellId);
  if (!cell) throw Object.assign(new Error('Cell not found.'), { statusCode: 404 });
  return simulateWhatIf(cell, input.interventionId, input.quantity);
});
app.get('/api/connectivity', async (request) => {
  const query = z.object({ studyId: z.string().default(DEFAULT_STUDY.id), planId: z.string().optional() }).parse(request.query);
  const plan = query.planId ? scenarios.get(query.studyId)?.find((item) => item.id === query.planId)?.plan : undefined;
  return analyzeConnectivity(getCells(query.studyId), plan?.selected.map((candidate) => candidate.cellId) ?? []);
});

app.post('/api/scenarios', async (request, reply) => {
  await requireRole(request, ['planner', 'admin']);
  const input = scenarioCreateSchema.parse(request.body);
  const plan = computePlan(input.studyId, input.budget, input.weights, input.enabledInterventions);
  const id = `scenario-${randomBytes(7).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const entry = { id, studyId: input.studyId, name: input.name, ...(input.description ? { description: input.description } : {}), budget: input.budget, weights: input.weights, enabledInterventions: input.enabledInterventions, plan, createdAt };
  const records = scenarios.get(input.studyId) ?? [];
  records.push(entry);
  scenarios.set(input.studyId, records);
  const db = await getDb();
  if (db) await db.scenario.create({ data: { id, studyAreaId: input.studyId, name: input.name, ...(input.description ? { description: input.description } : {}), budget: input.budget, weightsJson: JSON.stringify(input.weights), enabledInterventionsJson: JSON.stringify(input.enabledInterventions), planJson: JSON.stringify(plan) } });
  return reply.status(201).send(entry);
});
app.get('/api/scenarios', async (request) => {
  const query = z.object({ studyId: z.string().default(DEFAULT_STUDY.id) }).parse(request.query);
  const db = await getDb();
  if (db) {
    const records = (await db.scenario.findMany({ where: { studyAreaId: query.studyId }, orderBy: { createdAt: 'asc' } })).map(fromScenarioRecord);
    scenarios.set(query.studyId, records);
    return { scenarios: records };
  }
  return { scenarios: scenarios.get(query.studyId) ?? [] };
});
app.get('/api/scenarios/:id', async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const db = await getDb();
  if (db) {
    const record = await db.scenario.findUnique({ where: { id } });
    if (record) return fromScenarioRecord(record);
  }
  const found = [...scenarios.values()].flat().find((scenario) => scenario.id === id);
  if (!found) throw Object.assign(new Error('Scenario not found.'), { statusCode: 404 });
  return found;
});
app.patch('/api/scenarios/:id', async (request) => {
  await requireRole(request, ['planner', 'admin']);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const patch = z.object({ name: z.string().min(2).max(100).optional(), description: z.string().max(600).optional() }).strict().parse(request.body);
  const records = [...scenarios.values()].flat();
  const found = records.find((scenario) => scenario.id === id);
  if (!found) throw Object.assign(new Error('Scenario not found.'), { statusCode: 404 });
  if (patch.name) found.name = patch.name;
  if (patch.description !== undefined) found.description = patch.description;
  const db = await getDb();
  if (db) {
    const data: { name?: string; description?: string } = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    await db.scenario.update({ where: { id }, data });
  }
  return found;
});
app.delete('/api/scenarios/:id', async (request, reply) => {
  await requireRole(request, ['planner', 'admin']);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  for (const [studyId, records] of scenarios) scenarios.set(studyId, records.filter((scenario) => scenario.id !== id));
  const db = await getDb();
  if (db) await db.scenario.deleteMany({ where: { id } });
  return reply.status(204).send();
});
app.post('/api/scenarios/compare', async (request) => {
  const input = z.object({ studyId: z.string().default(DEFAULT_STUDY.id), scenarioIds: z.array(z.string()).min(2).max(4).optional(), budget: z.number().min(0).optional(), weights: z.object({ heat: z.number(), vegetation: z.number(), pedestrian: z.number(), connectivity: z.number() }).optional() }).parse(request.body);
  const db = await getDb();
  const current = db
    ? (await db.scenario.findMany({ where: { studyAreaId: input.studyId }, orderBy: { createdAt: 'asc' } })).map(fromScenarioRecord)
    : scenarios.get(input.studyId) ?? [];
  scenarios.set(input.studyId, current);
  const ids = input.scenarioIds ?? current.slice(-2).map((scenario) => scenario.id);
  const compared = ids.map((id) => current.find((scenario) => scenario.id === id)).filter((scenario): scenario is NonNullable<typeof scenario> => scenario !== undefined);
  if (compared.length >= 2) return { scenarios: compared, delta: { cost: compared[1]!.plan.totalCost - compared[0]!.plan.totalCost, benefit: compared[1]!.plan.combinedBenefit - compared[0]!.plan.combinedBenefit, cells: compared[1]!.plan.cellsImproved - compared[0]!.plan.cellsImproved } };
  const weights = input.weights ?? { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 };
  const plans = [0, 1].map((index) => ({ index, budget: input.budget ?? 10000 * (index + 1), plan: computePlan(input.studyId, (input.budget ?? 10000) * (index + 1), weights, INTERVENTIONS.map((item) => item.id)) }));
  return { scenarios: plans, delta: { cost: plans[1]!.plan.totalCost - plans[0]!.plan.totalCost, benefit: plans[1]!.plan.combinedBenefit - plans[0]!.plan.combinedBenefit, cells: plans[1]!.plan.cellsImproved - plans[0]!.plan.cellsImproved } };
});

app.get('/api/studies/:id/confidence', async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return confidenceSummary(getCells(id));
});

app.post('/api/studies/:id/confidence/recompute', async (request) => {
  await requireRole(request, ['planner', 'admin']);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const updated = getCells(id).map((cell) => ({ ...cell, dataConfidence: computeCellConfidence(illustrativeInput(cell)) }));
  await persistCellScores(id, updated);
  cellCache.set(id, updated);
  return { recomputed: updated.length, ...confidenceSummary(updated) };
});

app.get('/api/model/health', async (request) => {
  const { studyId } = z.object({ studyId: z.string().default(DEFAULT_STUDY.id) }).parse(request.query);
  const health = await modelHealth();
  const lastRun = modelRuns.get(studyId);
  return { ...health, ...(lastRun ? { lastRun } : {}) };
});

app.post('/api/studies/:id/model/refresh', async (request) => {
  await requireRole(request, ['planner', 'admin']);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const cells = getCells(id);
  const at = new Date().toISOString();
  const fallback = (reason: string) => {
    const run: ModelRun = { source: 'fallback', reason, at };
    modelRuns.set(id, run);
    return { ...run, updated: 0, missing: cells.length, ...confidenceSummary(cells) };
  };
  const config = modelConfig();
  if (!config) return fallback('MODEL_URL is not configured; existing scores kept.');
  try {
    const result = await callModel(id, cells, config);
    const applied = applyPredictions(cells, result.predictions);
    await persistCellScores(id, applied.cells);
    cellCache.set(id, applied.cells);
    const run: ModelRun = { source: 'model', modelVersion: result.modelVersion, at };
    modelRuns.set(id, run);
    return { ...run, updated: applied.updated, missing: applied.missing, ...confidenceSummary(applied.cells) };
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    request.log.warn({ err: error }, 'Model refresh failed; existing scores kept.');
    return fallback(`${error.message} Existing scores kept.`);
  }
});

app.post('/api/import', async (request, reply) => {
  await requireRole(request, ['planner', 'admin']);
  const contentType = request.headers['content-type'] ?? '';
  const rawBody = typeof request.body === 'string' ? JSON.parse(request.body) as unknown : request.body;
  const bodyFormat = typeof rawBody === 'object' && rawBody !== null && 'format' in rawBody ? rawBody.format : undefined;
  const importSchema = contentType.includes('geo+json') || bodyFormat === 'geojson' ? geoJsonImportSchema : csvImportSchema;
  const input = importSchema.parse(rawBody);
  if (input.format === 'csv') {
    let lines: string[][];
    try { lines = parseCsv(input.content); } catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : 'CSV is malformed.' }); }
    const headers = lines[0]?.map((header) => header.trim().toLowerCase()) ?? [];
    const idColumn = headers.indexOf('id');
    if (idColumn < 0) return reply.status(400).send({ error: 'CSV requires an id column.' });
    const originals = getCells(input.studyId);
    const values = new Map(originals.map((cell) => [cell.id, { ...cell.scores }]));
    const confidenceColumn = headers.findIndex((header) => header === 'dataconfidence' || header === 'confidence');
    const confidenceById = new Map(originals.map((cell) => [cell.id, cell.dataConfidence]));
    let imported = 0;
    for (const columns of lines.slice(1)) {
      const id = columns[idColumn];
      const existing = id ? values.get(id) : undefined;
      if (!existing) continue;
      let changed = false;
      for (const key of ['heat', 'vegetation', 'pedestrian', 'connectivity', 'feasibility'] as const) {
        const index = headers.indexOf(key);
        if (index >= 0 && columns[index]?.trim()) {
          const score = Number(columns[index]);
          if (Number.isFinite(score)) { existing[key] = Math.max(0, Math.min(1, score)); changed = true; }
        }
      }
      if (id && confidenceColumn >= 0 && columns[confidenceColumn]?.trim()) {
        const confidence = Number(columns[confidenceColumn]);
        if (Number.isFinite(confidence)) { confidenceById.set(id, Math.max(0, Math.min(1, confidence))); changed = true; }
      }
      if (changed) imported += 1;
    }
    const updated = originals.map((cell) => ({ ...cell, scores: values.get(cell.id) ?? cell.scores, dataConfidence: confidenceById.get(cell.id) ?? cell.dataConfidence }));
    await persistCellScores(input.studyId, updated);
    cellCache.set(input.studyId, updated);
    return reply.send({ imported, format: 'csv', cells: updated.length, persistence: process.env.DATABASE_URL ? 'database' : 'process-memory' });
  }
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(input.content) as unknown; } catch { return reply.status(400).send({ error: 'GeoJSON content is not valid JSON.' }); }
  const scoreValue = z.number().min(0).max(1);
  const featureSchema = z.object({ type: z.literal('Feature'), properties: z.object({ id: z.string().min(1), scores: z.object({ heat: scoreValue, vegetation: scoreValue, pedestrian: scoreValue, connectivity: scoreValue, feasibility: scoreValue }).partial(), dataConfidence: scoreValue.optional() }), geometry: z.unknown().optional() });
  const parsedGeojson = z.object({ type: z.literal('FeatureCollection'), features: z.array(featureSchema) }).safeParse(parsedJson);
  if (!parsedGeojson.success) return reply.status(400).send({ error: 'GeoJSON must be a FeatureCollection with cell IDs and normalized scores.' });
  const scoreById = new Map(parsedGeojson.data.features.map((feature) => [feature.properties.id, feature.properties.scores]));
  const confidenceById = new Map(parsedGeojson.data.features.flatMap((feature) => feature.properties.dataConfidence === undefined ? [] : [[feature.properties.id, feature.properties.dataConfidence] as const]));
  const originals = getCells(input.studyId);
  const updated = originals.map((cell) => {
    const scores = scoreById.get(cell.id);
    const dataConfidence = confidenceById.get(cell.id) ?? cell.dataConfidence;
    if (!scores) return dataConfidence === cell.dataConfidence ? cell : { ...cell, dataConfidence };
    return { ...cell, dataConfidence, scores: {
      heat: scores.heat ?? cell.scores.heat,
      vegetation: scores.vegetation ?? cell.scores.vegetation,
      pedestrian: scores.pedestrian ?? cell.scores.pedestrian,
      connectivity: scores.connectivity ?? cell.scores.connectivity,
      feasibility: scores.feasibility ?? cell.scores.feasibility,
    } };
  });
  await persistCellScores(input.studyId, updated);
  cellCache.set(input.studyId, updated);
  return reply.send({ imported: scoreById.size, format: 'geojson', cells: updated.length, persistence: process.env.DATABASE_URL ? 'database' : 'process-memory' });
});

app.get('/api/export', async (request, reply) => {
  const query = z.object({ studyId: z.string().default(DEFAULT_STUDY.id), format: z.enum(['csv', 'geojson']).default('geojson'), layer: z.enum(['heat', 'vegetation', 'pedestrian', 'connectivity', 'feasibility', 'priority', 'recommended']).default('priority') }).parse(request.query);
  const cells = getCells(query.studyId);
  if (query.format === 'csv') {
    const fields = ['id', 'row', 'col', 'areaName', 'landUse', 'surfaceType', 'heat', 'vegetation', 'pedestrian', 'connectivity', 'feasibility', 'priority', 'latitude', 'longitude', 'dataConfidence'];
    const rows = cells.map((cell) => [cell.id, cell.row, cell.col, cell.areaName, cell.landUse, cell.surfaceType, cell.scores.heat, cell.scores.vegetation, cell.scores.pedestrian, cell.scores.connectivity, cell.scores.feasibility, combinedPriority(cell.scores), cell.center[0], cell.center[1], cell.dataConfidence].map(csvValue).join(','));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${query.studyId}-cells.csv"`);
    return reply.send([fields.join(','), ...rows].join('\n'));
  }
  const collection = { type: 'FeatureCollection', name: studies.get(query.studyId)?.name, layer: query.layer, features: cells.map((cell) => ({ type: 'Feature', id: cell.id, properties: { ...cell, center: cell.center, polygon: undefined, activeScore: layerScore(cell, query.layer), priority: combinedPriority(cell.scores), risk: riskBand(combinedPriority(cell.scores)) }, geometry: { type: 'Polygon', coordinates: [cell.polygon.map(([latitude, longitude]) => [longitude, latitude])] } })) };
  reply.header('content-type', 'application/geo+json').header('content-disposition', `attachment; filename="${query.studyId}-cells.geojson"`);
  return reply.send(collection);
});

app.get('/api/studies/:id/report', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const query = z.object({ format: z.enum(['json', 'pdf']).default('json'), budget: z.coerce.number().min(0).default(25_000) }).parse(request.query);
  const study = studies.get(params.id);
  if (!study) throw Object.assign(new Error('Study area not found.'), { statusCode: 404 });
  const cells = getCells(params.id);
  const plan = optimizePlan(cells, { budget: query.budget, weights: { heat: 30, vegetation: 25, pedestrian: 25, connectivity: 20 }, enabledInterventions: INTERVENTIONS.map((item) => item.id) });
  const connectivity = analyzeConnectivity(cells, plan.selected.map((candidate) => candidate.cellId));
  const report = { generatedAt: new Date().toISOString(), study, cellCount: cells.length, polygonCount: cells.length, priorityCells: cells.filter((cell) => cell.priorityZone).length, criticalCells: cells.filter((cell) => riskBand(combinedPriority(cell.scores)) === 'CRITICAL').length, plan, connectivity };
  if (query.format === 'json') return report;
  const pdf = new PDFDocument({ margin: 46, size: 'A4' });
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  pdf.fontSize(22).fillColor('#164940').text('EcoGrid AI 2.0', { continued: false });
  pdf.moveDown(0.3).fontSize(15).fillColor('#111827').text(`Climate intervention report · ${study.name}`);
  pdf.moveDown().fontSize(10).fillColor('#4B5563').text(`Generated ${new Date(report.generatedAt).toLocaleString()} · ${cells.length} analysis cells · ${cells.length} polygon features`);
  pdf.moveDown().fontSize(13).fillColor('#111827').text('Intervention plan');
  pdf.fontSize(10).fillColor('#374151').text(`Budget $${query.budget.toLocaleString()} · selected cost $${plan.totalCost.toLocaleString()} · ${Math.round(plan.utilization * 100)}% utilized · ${plan.cellsImproved} cells improved`);
  pdf.moveDown(0.4);
  for (const candidate of plan.selected.slice(0, 24)) pdf.fontSize(9).text(`${candidate.cellId}  ${candidate.interventionName} × ${candidate.quantity} · $${candidate.cost.toLocaleString()} · ${candidate.areaName}`);
  pdf.moveDown().fontSize(13).fillColor('#111827').text('Connectivity');
  pdf.fontSize(10).fillColor('#374151').text(`${connectivity.beforeComponents} existing components · ${connectivity.afterComponents} after proposed plan · ${connectivity.newConnections} connections gained · ${connectivity.isolatedPatches.length} isolated green patches`);
  pdf.moveDown().fontSize(8).fillColor('#6B7280').text('Scores are deterministic planning estimates for the selected study data. Validate site conditions before installation.');
  pdf.end();
  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  return reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `attachment; filename="${params.id}-climate-plan.pdf"`)
    .header('content-length', pdfBuffer.length)
    .send(pdfBuffer);
});

app.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/') || request.url === '/api') {
    return reply.status(404).send({ error: 'API route not found.' });
  }
  if (existsSync(webBuildPath)) return reply.type('text/html').sendFile('index.html');
  return reply.status(404).send({ error: 'Route not found.' });
});

await hydrateDatabaseCache();

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.NODE_ENV === 'production' ? Number(process.env.PORT ?? 3000) : Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

export { app };
