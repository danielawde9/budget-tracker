import type {
  ArchiveCategoryInput,
  CategoriesGateway,
  Category,
  CategoryCommandResult,
  CategoryKind,
  CategoryPage,
  CategorizedEventInput,
  CreateCategoryInput,
  CreateSubcategoryInput,
  EventCategory,
} from '../features/categories/types.js';

export const categoryFixtures: readonly Category[] = [
  { id: 'category-salary', spaceId: 'space-1', kind: 'income', nameEn: 'Salary', nameAr: 'راتب', parentCategoryId: null, createdAt: '2026-09-08T10:00:00Z', archivedAt: null },
  { id: 'category-groceries', spaceId: 'space-1', kind: 'expense', nameEn: 'Groceries', nameAr: 'بقالة', parentCategoryId: null, createdAt: '2026-09-08T11:00:00Z', archivedAt: null },
];

export class InMemoryCategoriesGateway implements CategoriesGateway {
  categories = [...categoryFixtures];
  associations: EventCategory[] = [];
  error: Error | null = null;
  commandResult: CategoryCommandResult | null = null;
  calls: Array<{ name: string; input: unknown }> = [];

  private failIfNeeded() {
    if (this.error) throw this.error;
  }

  async listCategories(spaceId: string, kind: CategoryKind, _cursor?: string): Promise<CategoryPage> {
    this.calls.push({ name: 'listCategories', input: { spaceId, kind } });
    this.failIfNeeded();
    return { categories: this.categories.filter((category) => category.spaceId === spaceId && category.kind === kind && category.archivedAt === null), nextCursor: null };
  }

  async createCategory(input: CreateCategoryInput) {
    this.calls.push({ name: 'createCategory', input });
    this.failIfNeeded();
    const id = `category-${this.categories.length + 1}`;
    this.categories.push({ id, spaceId: input.spaceId, kind: input.kind, nameEn: input.nameEn, nameAr: input.nameAr, parentCategoryId: null, createdAt: `2026-09-08T12:00:0${this.categories.length}Z`, archivedAt: null });
    return { id };
  }

  async createSubcategory(input: CreateSubcategoryInput) {
    this.calls.push({ name: 'createSubcategory', input });
    this.failIfNeeded();
    const parent = this.categories.find((category) => category.id === input.parentCategoryId
      && category.spaceId === input.spaceId && category.parentCategoryId === null && category.archivedAt === null);
    if (!parent) throw new Error('the parent category must be an active root in the requested space and kind');
    const id = `category-${this.categories.length + 1}`;
    this.categories.push({
      id, spaceId: input.spaceId, kind: parent.kind, nameEn: input.nameEn, nameAr: input.nameAr,
      parentCategoryId: parent.id, createdAt: `2026-09-08T12:00:0${this.categories.length}Z`, archivedAt: null,
    });
    return { id };
  }

  async archiveCategory(input: ArchiveCategoryInput) {
    this.calls.push({ name: 'archiveCategory', input });
    this.failIfNeeded();
    this.categories = this.categories.map((category) => category.id === input.categoryId && category.spaceId === input.spaceId ? { ...category, archivedAt: '2026-09-08T13:00:00Z' } : category);
    return { id: input.categoryId };
  }

  async getCommandResult(spaceId: string, requestId: string) {
    this.calls.push({ name: 'getCommandResult', input: { spaceId, requestId } });
    return this.commandResult;
  }

  async recordCategorizedEvent(input: CategorizedEventInput) {
    this.calls.push({ name: 'recordCategorizedEvent', input });
    this.failIfNeeded();
    return { eventId: 'categorized-event' };
  }

  async findCategorizedEventByRequestId(spaceId: string, requestId: string) {
    this.calls.push({ name: 'findCategorizedEventByRequestId', input: { spaceId, requestId } });
    return null;
  }

  async resolveEventCategories(spaceId: string, eventIds: readonly string[]) {
    this.calls.push({ name: 'resolveEventCategories', input: { spaceId, eventIds } });
    return this.associations.filter((association) => eventIds.includes(association.eventId));
  }
}
