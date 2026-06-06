import { test } from '@playwright/test';
import { TodoPage } from '../pages/TodoPage';

test('Web POM: Measure performance of TodoMVC after interactions', async ({ page }) => {
  const todoPage = new TodoPage(page);

  await test.step('Navigate to TodoMVC', async () => {
    await todoPage.goto();
  });

  await test.step('Interact with application', async () => {
    await todoPage.addTodo('Buy groceries');
    await todoPage.addTodo('Finish Playwright integrations');
  });

  await test.step('Run Lighthouse audit on populated state', async () => {
    // Fails the test if any threshold drops below 90
    await todoPage.auditPerformance('todomvc-populated-report.html');
  });
});
