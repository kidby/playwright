import type { NativeDevice } from '@playwright/mobile';

export class OperateDevice {
  constructor(public readonly device: NativeDevice) {}

  static using(device: NativeDevice): OperateDevice {
    return new OperateDevice(device);
  }
}
