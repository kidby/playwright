import type { Task, Actor } from '../../core/Actor';
import { OperateDevice } from '../abilities/OperateDevice';

export class Login implements Task {
  constructor(private username: string, private pin: string) {}

  static withCredentials(username: string, pin: string) {
    return new Login(username, pin);
  }

  async performAs(actor: Actor): Promise<void> {
    const ability = actor.abilityTo<OperateDevice>('OperateDevice');
    const device = ability.device;

    // Navigate to Login
    await device.locator('~open menu').tap();
    await device.locator('~menu item log in').tap();

    // Enter credentials
    await device.locator('~Username input field').fill(this.username);
    await device.locator('~Password input field').fill(this.pin);

    // Submit
    await device.locator('~Login button').tap();
  }
}
