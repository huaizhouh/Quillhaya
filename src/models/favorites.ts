import { z } from 'zod';
import { ResultSchema } from './schema';

export const FavoriteInputSchema = z.object({ scope: z.enum(['sentence', 'document']), result: ResultSchema }).strict();
export const FavoriteSchema = FavoriteInputSchema.extend({ id: z.string().uuid(), createdAt: z.string().datetime() });
export const FavoriteOrderSchema = z.object({ ids: z.array(z.string().uuid()), sort: z.enum(['newest', 'manual']) }).strict();
export const FavoriteLibrarySchema = z.object({ sort: FavoriteOrderSchema.shape.sort, items: z.array(FavoriteSchema) }).strict()
  .refine(value => new Set(value.items.map(item => item.id)).size === value.items.length, '收藏 ID 重复');
export type FavoriteInput = z.infer<typeof FavoriteInputSchema>;
export type Favorite = z.infer<typeof FavoriteSchema>;
export type FavoriteOrder = z.infer<typeof FavoriteOrderSchema>;
export type FavoriteLibrary = z.infer<typeof FavoriteLibrarySchema>;

// Sentence IDs belong to a writing session, not to the saved feedback's identity.
export function favoriteKey({ scope, result: r }: FavoriteInput) {
  return JSON.stringify([scope, r.original_text, r.status, r.overall_explanation_zh, r.suggested_revision,
    r.issues.map(i => [i.type, i.severity, i.original_span, i.suggested_text, i.explanation_zh]), r.confidence]);
}
export function orderedFavorites(library: FavoriteLibrary) {
  return library.sort === 'manual' ? library.items : [...library.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
