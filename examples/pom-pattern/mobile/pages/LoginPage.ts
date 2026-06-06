import { expect } from '@playwright/mobile';
import type { AppiumClient } from '@playwright/mobile/appiumClient';
import type { AppLocator } from '@playwright/mobile/locator';

export class LoginPage {
  private menuButton: AppLocator;
  private logInMenu: AppLocator;
  private usernameField: AppLocator;
  private passwordField: AppLocator;
  private loginBtn: AppLocator;
  private productsHeader: AppLocator;

  constructor(private device: AppiumClient) {
    this.menuButton = device.locator('~open menu'); // Accessibility ID shortcut
    this.logInMenu = device.locator('~menu item log in');
    this.usernameField = device.locator('~Username input field');
    this.passwordField = device.locator('~Password input field');
    this.loginBtn = device.locator('~Login button');
    this.productsHeader = device.locator('~Products'); // Assuming the header has an accessibility ID of "Products"
  }

  async navigateToLogin() {
    await this.menuButton.tap();
    await this.logInMenu.tap();
  }

  async login(username: string, password: string) {
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
    await this.loginBtn.tap();
  }

  async verifyLoginSuccess() {
    // Uses the custom Playwright Expect matchers for AppLocator
    await expect(this.productsHeader).toBeVisible();
  }
}

