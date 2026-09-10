export type CategoryKind = 'income' | 'expense';
export type CategoryCommandKind = 'create_category' | 'create_subcategory' | 'archive_category';

export interface Category {
  id: string;
  spaceId: string;
  kind: CategoryKind;
  nameEn: string | null;
  nameAr: string | null;
  parentCategoryId: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface CategoryPage {
  categories: readonly Category[];
  nextCursor: string | null;
}

export interface CategoryCommandResult {
  commandKind: CategoryCommandKind;
  categoryId: string;
  createdAt: string;
}

export interface EventCategory {
  eventId: string;
  categoryId: string;
  categoryKind: CategoryKind;
  nameEn: string | null;
  nameAr: string | null;
  archivedAt: string | null;
}

export interface CreateCategoryInput {
  spaceId: string;
  requestId: string;
  kind: CategoryKind;
  nameEn: string | null;
  nameAr: string | null;
}

export interface ArchiveCategoryInput {
  spaceId: string;
  requestId: string;
  categoryId: string;
}

export interface CreateSubcategoryInput {
  spaceId: string;
  requestId: string;
  parentCategoryId: string;
  nameEn: string | null;
  nameAr: string | null;
}

export interface CategorizedEventInput {
  spaceId: string;
  requestId: string;
  kind: CategoryKind;
  effectiveDate: string;
  movements: readonly CategorizedMovementInput[];
  categoryId: string;
}

export interface CategorizedMovementInput {
  walletId: string;
  amountMinor: string;
}

export interface CategorizedEventResult {
  eventId: string;
  categoryId: string;
}

export interface CategoriesGateway {
  listCategories(spaceId: string, kind: CategoryKind, cursor?: string, limit?: number): Promise<CategoryPage>;
  createCategory(input: CreateCategoryInput): Promise<{ id?: string }>;
  createSubcategory(input: CreateSubcategoryInput): Promise<{ id?: string }>;
  archiveCategory(input: ArchiveCategoryInput): Promise<{ id?: string }>;
  getCommandResult(spaceId: string, requestId: string): Promise<CategoryCommandResult | null>;
  recordCategorizedEvent(input: CategorizedEventInput): Promise<{ eventId?: string }>;
  findCategorizedEventByRequestId(spaceId: string, requestId: string): Promise<CategorizedEventResult | null>;
  resolveEventCategories(spaceId: string, eventIds: readonly string[]): Promise<readonly EventCategory[]>;
}
