import { storybookTest as test } from '@playwright/storybook';
import { runPlayFunction } from '@playwright/storybook';
import { ButtonComponent } from '../pages/ButtonComponent';

test('Component POM: Verify Button rendering and play functions', async ({ page, mountStory }) => {
  const buttonComponent = new ButtonComponent(page);

  await test.step('Mount the primary button story', async () => {
    await mountStory('components-button--primary');
  });

  await test.step('Verify initial rendering', async () => {
    await buttonComponent.verifyAppearance('Primary Button');
  });

  await test.step('Interact with button', async () => {
    await buttonComponent.clickAndVerifyInteraction();
  });

  await test.step('Re-run embedded Storybook play() function', async () => {
    // We can also leverage the native Storybook play() interactions 
    // defined in the .stories.ts file alongside our POM actions!
    await runPlayFunction(page);
  });
});
