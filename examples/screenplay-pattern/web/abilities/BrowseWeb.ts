import type { Page } from '@playwright/test';

export class BrowseWeb {
  constructor(public readonly page: Page) {}

  static using(page: Page): BrowseWeb {
    return new BrowseWeb(page);
  }
}
