import { z } from 'zod';

export const scoreWeightsSchema = z.object({
  heat: z.number().min(0).max(100),
  vegetation: z.number().min(0).max(100),
  pedestrian: z.number().min(0).max(100),
  connectivity: z.number().min(0).max(100),
}).strict().refine((weights) => Math.abs(weights.heat + weights.vegetation + weights.pedestrian + weights.connectivity - 100) < 0.001, 'Weights must sum to 100%.');

export const interventionIdSchema = z.enum(['native_trees', 'shade_structure', 'pollinator_corridor', 'green_buffer', 'cool_surface']);

export const optimizeRequestSchema = z.object({
  studyId: z.string().min(1).default('study-bengaluru-east'),
  budget: z.number().min(0).max(1_000_000_000),
  weights: scoreWeightsSchema,
  enabledInterventions: z.array(interventionIdSchema).min(1),
  constraints: z.object({
    minFeasibility: z.number().min(0).max(1).optional(),
    maxPerCell: z.number().int().positive().optional(),
    includeCellIds: z.array(z.string()).optional(),
    excludeCellIds: z.array(z.string()).optional(),
  }).strict().optional(),
}).strict();

export const whatIfRequestSchema = z.object({
  studyId: z.string().min(1).default('study-bengaluru-east'),
  cellId: z.string().min(2),
  interventionId: interventionIdSchema,
  quantity: z.number().int().min(1).max(100),
}).strict();

export const studyCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  origin: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
  rows: z.number().int().min(1).max(50),
  columns: z.number().int().min(1).max(50),
  cellSizeLat: z.number().positive().max(0.1),
  cellSizeLng: z.number().positive().max(0.1),
  rotation: z.number().min(-180).max(180).default(0),
}).strict();

export const scenarioCreateSchema = z.object({
  studyId: z.string().min(1).default('study-bengaluru-east'),
  name: z.string().trim().min(2).max(100),
  description: z.string().max(600).optional(),
  budget: z.number().min(0),
  weights: scoreWeightsSchema,
  enabledInterventions: z.array(interventionIdSchema).min(1),
}).strict();

export const authRegisterSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
}).strict();

export const authLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export const csvImportSchema = z.object({
  studyId: z.string().min(1).default('study-bengaluru-east'),
  format: z.literal('csv'),
  content: z.string().min(1).max(2_000_000),
}).strict();

export const geoJsonImportSchema = z.object({
  studyId: z.string().min(1).default('study-bengaluru-east'),
  format: z.literal('geojson'),
  content: z.string().min(1).max(2_000_000),
}).strict();

export type OptimizeRequest = z.infer<typeof optimizeRequestSchema>;
export type WhatIfRequest = z.infer<typeof whatIfRequestSchema>;
export type StudyCreate = z.infer<typeof studyCreateSchema>;
export type ScenarioCreate = z.infer<typeof scenarioCreateSchema>;
