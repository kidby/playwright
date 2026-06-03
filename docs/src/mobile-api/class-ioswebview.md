# class: IosWebView
* since: v1.61
* langs: js

[IosWebView] represents an in-app WebView descriptor returned from [`method: IosDevice.webViews`]. **Descriptor-only on day 1** — attaching a full Playwright [Page] to drive the WebView is a future PR. For now, switch into the WebView context via `device.executeScript('mobile: setContext', [...])` and use Appium's native selectors.

## method: IosWebView.bundleId
* since: v1.61
- returns: <[string]>

The hosting app's bundle identifier (e.g. `com.example.app`).

## method: IosWebView.title
* since: v1.61
- returns: <[string]>

The current document title, if available.

## method: IosWebView.url
* since: v1.61
- returns: <[string]>

The current URL, if available.

## method: IosWebView.contextName
* since: v1.61
- returns: <[string]>

The Appium context name (e.g. `WEBVIEW_12345.1`). Pass this to `device.executeScript('mobile: setContext', [{ name }])` to switch into the WebView.
