import type { MobileNetworkProxy } from '../../mobileNetworkProxy';
import type { Tracing } from './tracing';
import type * as har from '@trace/har';

export class MobileTracer {
  constructor(private proxy: MobileNetworkProxy, private tracing: Tracing) {
    const activeEntries = new Map<string, har.Entry>();

    this.proxy.on('requestWillBeSent', (event) => {
      const entry: har.Entry = {
        pageref: undefined,
        startedDateTime: new Date(event.wallTime * 1000).toISOString(),
        time: -1,
        request: {
          method: event.request.method || 'GET',
          url: event.request.url,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: Object.entries(event.request.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
          queryString: [],
          headersSize: -1,
          bodySize: -1,
          postData: event.request.postData ? { mimeType: '', text: event.request.postData, params: [] } : undefined,
        },
        response: {
          status: -1,
          statusText: '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [],
          content: {
            size: -1,
            mimeType: 'x-unknown',
          },
          headersSize: -1,
          bodySize: -1,
          redirectURL: '',
          _transferSize: -1
        },
        cache: {},
        timings: {
          send: -1,
          wait: -1,
          receive: -1
        },
        _monotonicTime: event.timestamp
      };
      activeEntries.set(event.requestId, entry);
      this.tracing.onEntryStarted(entry);
    });

    this.proxy.on('responseReceived', (event) => {
      const entry = activeEntries.get(event.requestId);
      if (entry) {
        entry.response.status = event.response.status;
        entry.response.statusText = event.response.statusText;
        entry.response.headers = Object.entries(event.response.headers || {}).map(([name, value]) => ({ name, value: String(value) }));
        entry.response.content.mimeType = event.response.mimeType;
      }
    });

    this.proxy.on('loadingFinished', (event) => {
      const entry = activeEntries.get(event.requestId);
      if (entry) {
        entry.time = event.timestamp - entry._monotonicTime!;
        this.tracing.onEntryFinished(entry);
        activeEntries.delete(event.requestId);
      }
    });
  }
}
