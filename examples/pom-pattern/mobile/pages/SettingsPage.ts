import { expect } from '@playwright/mobile';
import type { NativeDevice, AppLocator } from '@playwright/mobile';

export class SettingsPage {
  constructor(private device: NativeDevice) {}

  get rows(): AppLocator {
    return this.device.isIos
      ? this.device.app.byIosClassChain('**/XCUIElementTypeCell')
      : this.device.app.byClassName('android.widget.TextView');
  }

  row(label: string): AppLocator {
    return this.device.app.getByText(label);
  }

  async open(label: string): Promise<void> {
    await this.row(label).tap();
  }

  async expectVisible(): Promise<void> {
    await expect(this.rows.first()).toBeVisible();
  }
}
