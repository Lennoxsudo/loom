/**
 * Image generation size constants (shared — no UI dependency).
 *
 * Used by agent-engine schema validation and settings/image-gen config.
 */

export const IMAGE_GENERATION_SIZES = [
  '256x256',
  '512x512',
  '1024x1024',
  '1792x1024',
  '1024x1792',
] as const;

export const SENSENOVA_IMAGE_SIZES = [
  '1664x2496',
  '2496x1664',
  '1760x2368',
  '2368x1760',
  '1824x2272',
  '2272x1824',
  '2048x2048',
  '2752x1536',
  '1536x2752',
  '3072x1376',
  '1344x3136',
] as const;

export type ImageGenerationSize = (typeof IMAGE_GENERATION_SIZES)[number];
export type SenseNovaImageSize = (typeof SENSENOVA_IMAGE_SIZES)[number];
