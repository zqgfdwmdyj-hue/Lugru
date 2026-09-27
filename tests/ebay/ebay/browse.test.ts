import { describe, it, expect } from 'vitest';
import { leafCategoryId } from '@/lib/ebay/ebay/browse';

describe('leafCategoryId', () => {
  it('nimmt die Blattkategorie aus leafCategoryIds', () => {
    expect(leafCategoryId({ leafCategoryIds: ['15032'] })).toBe('15032');
  });

  it('fällt auf categories[0] zurück', () => {
    expect(leafCategoryId({ categories: [{ categoryId: '9394', categoryName: 'Handy-Zubehör' }] })).toBe('9394');
  });

  it('bevorzugt leafCategoryIds vor categories', () => {
    expect(
      leafCategoryId({ leafCategoryIds: ['15032'], categories: [{ categoryId: '9394' }] })
    ).toBe('15032');
  });

  it('ist undefined, wenn eBay nichts liefert', () => {
    expect(leafCategoryId({})).toBeUndefined();
    expect(leafCategoryId({ leafCategoryIds: [] })).toBeUndefined();
    expect(leafCategoryId({ categories: [] })).toBeUndefined();
    expect(leafCategoryId({ leafCategoryIds: [''] })).toBeUndefined();
    expect(leafCategoryId({ categories: [{ categoryId: 123 }] })).toBeUndefined();
  });
});
