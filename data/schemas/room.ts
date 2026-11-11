import { z } from "zod";

/** Subset of the Tiled JSON map format (`.tmj`) that rooms use. */
const propertySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const objectSchema = z.object({
  name: z.string().default(""),
  /** Tiled >= 1.9 writes `class`; older versions write `type`. */
  class: z.string().optional(),
  type: z.string().optional(),
  x: z.number(),
  y: z.number(),
  properties: z.array(propertySchema).default([]),
});

const tileLayerSchema = z.object({
  type: z.literal("tilelayer"),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: z.array(z.number().int().nonnegative()),
});

const objectLayerSchema = z.object({
  type: z.literal("objectgroup"),
  name: z.string(),
  objects: z.array(objectSchema),
});

export const roomMapSchema = z.object({
  type: z.literal("map"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  /** Custom map property `margin` (tiles): the outer ring of wall tiles lies outside the room. */
  properties: z.array(propertySchema).default([]),
  layers: z.array(z.discriminatedUnion("type", [tileLayerSchema, objectLayerSchema])),
});

export type RoomMap = z.infer<typeof roomMapSchema>;
export type RoomMapObject = z.infer<typeof objectSchema>;
export type RoomMapProperty = z.infer<typeof propertySchema>;
