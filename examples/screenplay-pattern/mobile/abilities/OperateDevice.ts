import type { AppiumClient } from '@playwright/mobile/appiumClient';

export class OperateDevice {
  constructor(public readonly device: AppiumClient) {}

  static using(device: AppiumClient): OperateDevice {
    return new OperateDevice(device);
  }
}
