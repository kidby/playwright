import { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class ButtonComponent {
  private root: Locator;

  constructor(private page: Page) {
    this.root = page.locator('button');
  }

  async verifyAppearance(expectedText: string) {
    await expect(this.root).toBeVisible();
    await expect(this.root).toHaveText(expectedText);
  }

  async clickAndVerifyInteraction() {
    await this.root.click();
    // E.g. verify visual state change or emitted events if mocked
  }
}
