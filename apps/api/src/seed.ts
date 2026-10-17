import { DEFAULT_STUDY, createGrid } from '@ecogrid/domain';
import bcrypt from 'bcryptjs';
import type { PrismaClient as GeneratedPrismaClient } from '../prisma/generated/postgres/index.js';
import { databaseUrlForPrisma } from './database-url.js';

const provider = process.env.DATABASE_PROVIDER === 'mysql' || (process.env.DATABASE_URL?.startsWith('mysql') ?? false) ? 'mysql' : 'postgres';
const databaseUrl = databaseUrlForPrisma(provider, process.env.DATABASE_URL);
if (!databaseUrl) throw new Error('DATABASE_URL is required for database seeding.');
type SeedClient = GeneratedPrismaClient;
const database: SeedClient = provider === 'mysql'
  ? await import('../prisma/generated/mysql/index.js').then(({ PrismaClient }) => new PrismaClient({ datasources: { db: { url: databaseUrl } } }) as unknown as SeedClient)
  : await import('../prisma/generated/postgres/index.js').then(({ PrismaClient }) => new PrismaClient({ datasources: { db: { url: databaseUrl } } }));

async function main(): Promise<void> {
  await database.studyArea.upsert({
    where: { id: DEFAULT_STUDY.id },
    update: { name: DEFAULT_STUDY.name },
    create: {
      id: DEFAULT_STUDY.id,
      name: DEFAULT_STUDY.name,
      originLat: DEFAULT_STUDY.origin[0],
      originLng: DEFAULT_STUDY.origin[1],
      rows: DEFAULT_STUDY.rows,
      columns: DEFAULT_STUDY.columns,
      cellSizeLat: DEFAULT_STUDY.cellSizeLat,
      cellSizeLng: DEFAULT_STUDY.cellSizeLng,
      rotation: DEFAULT_STUDY.rotation,
    },
  });
  const cells = createGrid(DEFAULT_STUDY);
  for (const cell of cells) {
    await database.cell.upsert({
      where: { id: `${DEFAULT_STUDY.id}:${cell.id}` },
      update: {},
      create: {
        id: `${DEFAULT_STUDY.id}:${cell.id}`,
        studyAreaId: DEFAULT_STUDY.id,
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
      },
    });
  }
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password && password.length >= 12) {
    const existing = await database.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!existing) await database.user.create({ data: { email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role: 'admin' } });
  }
  console.log(`Seeded ${cells.length} deterministic cells for ${DEFAULT_STUDY.name} (${provider}).`);
}

try {
  await main();
} finally {
  await database.$disconnect();
}
