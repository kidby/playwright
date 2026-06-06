import { Page, Locator } from '@playwright/test';
import { playAudit } from '@playwright/lighthouse';
import { playReport } from '@playwright/lighthouse/html-report';

export class TodoPage {
  private newTodoInput: Locator;

  constructor(private page: Page) {
    this.newTodoInput = page.locator('.new-todo');
  }

  async goto() {
    await this.page.goto('https://demo.playwright.dev/todomvc/');
  }

  async addTodo(text: string) {
    await this.newTodoInput.fill(text);
    await this.newTodoInput.press('Enter');
  }

  async auditPerformance(reportName: string) {
    // Audit the current state of the page
    const report = await playAudit({
      page: this.page,
      thresholds: {
        performance: 90,
        accessibility: 90,
        'best-practices': 90,
        seo: 90,
      },
      port: 9222, // Requires --remote-debugging-port=9222 in config
    });
    
    // Save report artifact
    await playReport(report, reportName);
  }
}
