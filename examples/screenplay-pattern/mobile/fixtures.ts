import { mobileTest } from '@playwright/mobile';
import { Actor } from '../core/Actor';
import { OperateDevice } from './abilities/OperateDevice';

export const test = mobileTest.extend<{ actor: Actor }>({
  actor: async ({ device }, use) => {
    const actor = Actor.named('User').whoCan('OperateDevice', OperateDevice.using(device));
    await use(actor);
  },
});

export { expect } from '@playwright/mobile';
