import type { Page } from '@playwright/test';

import { installLoansApiFixture, type ApplicationFixtureOptions } from './loans.js';

export type CategoriesFixtureOptions = ApplicationFixtureOptions;

export function installCategoriesApiFixture(page: Page, options: CategoriesFixtureOptions = {}) {
  return installLoansApiFixture(page, options);
}
