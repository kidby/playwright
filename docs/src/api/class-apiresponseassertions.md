# class: APIResponseAssertions
* since: v1.18

The [APIResponseAssertions] class provides assertion methods that can be used to make assertions about the [APIResponse] in the tests.

```js
import { test, expect } from '@playwright/test';

test('navigates to login', async ({ page }) => {
  // ...
  const response = await page.request.get('https://playwright.dev');
  await expect(response).toBeOK();
});
```

```java
// ...
import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

public class TestPage {
  // ...
  @Test
  void navigatesToLoginPage() {
    // ...
    APIResponse response = page.request().get("https://playwright.dev");
    assertThat(response).isOK();
  }
}
```

```python async
from playwright.async_api import Page, expect

async def test_navigates_to_login_page(page: Page) -> None:
    # ..
    response = await page.request.get('https://playwright.dev')
    await expect(response).to_be_ok()
```

```python sync
from playwright.sync_api import Page, expect

def test_navigates_to_login_page(page: Page) -> None:
    # ..
    response = page.request.get('https://playwright.dev')
    expect(response).to_be_ok()
```

```csharp
using Microsoft.Playwright;
using Microsoft.Playwright.MSTest;

namespace PlaywrightTests;

[TestClass]
public class ExampleTests : PageTest
{
    [TestMethod]
    public async Task NavigatesToLoginPage()
    {
        var response = await Page.APIRequest.GetAsync("https://playwright.dev");
        await Expect(response).ToBeOKAsync();
    }
}
```

## property: APIResponseAssertions.not
* since: v1.20
* langs: java, js, csharp
- returns: <[APIResponseAssertions]>

Makes the assertion check for the opposite condition.

**Usage**

For example, this code tests that the response status is not successful:

```js
await expect(response).not.toBeOK();
```

```java
assertThat(response).not().isOK();
```

```csharp
await Expect(response).Not.ToBeOKAsync();
```

## async method: APIResponseAssertions.NotToBeOK
* since: v1.19
* langs: python

The opposite of [`method: APIResponseAssertions.toBeOK`].

## async method: APIResponseAssertions.toHaveResponseProperty
* since: v1.61

Reads the response body as JSON and asserts that a value exists at the given dotted path. When called with an `expected` argument, also asserts deep equality.

**Usage**

```js
const response = await page.request.get('/api/users/1');
await expect(response).toHaveResponseProperty('data.user.id');
await expect(response).toHaveResponseProperty('data.user.id', 42);
await expect(response).toHaveResponseProperty('items[0].name', 'first');
```

### param: APIResponseAssertions.toHaveResponseProperty.propertyPath
* since: v1.61
- `propertyPath` <[string]>

Dotted path into the JSON body. Use `[N]` for array indices.

### param: APIResponseAssertions.toHaveResponseProperty.expected
* since: v1.61
- `expected` ?<[any]>

Optional value to deep-equal against the resolved property. Omit to only assert presence.

## async method: APIResponseAssertions.toBeOK
* since: v1.18
* langs:
  - alias-java: isOK

Ensures the response status code is within `200..299` range.

**Usage**

```js
await expect(response).toBeOK();
```

```java
assertThat(response).isOK();
```

```python async
from playwright.async_api import expect

# ...
await expect(response).to_be_ok()
```

```python sync
import re
from playwright.sync_api import expect

# ...
expect(response).to_be_ok()
```

```csharp
await Expect(response).ToBeOKAsync();
```
