import * as http from 'http';
import * as net from 'net';
import { EventEmitter } from 'events';
import { createGuid } from '@utils/crypto';
import { monotonicTime } from '@isomorphic/time';

export class MobileNetworkProxy extends EventEmitter {
  private _server: http.Server;
  private _port: number = 0;
  private _agent: http.Agent;

  constructor() {
    super();
    this._agent = new http.Agent({ keepAlive: true });
    this._server = http.createServer(this._handleRequest.bind(this));
    this._server.on('connect', this._handleConnect.bind(this));
  }

  async start(port: number = 0): Promise<number> {
    return new Promise((resolve) => {
      this._server.listen(port, () => {
        this._port = (this._server.address() as net.AddressInfo).port;
        resolve(this._port);
      });
    });
  }

  async stop(): Promise<void> {
    this._agent.destroy();
    return new Promise((resolve) => {
      this._server.close(() => resolve());
    });
  }

  private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestId = createGuid();
    const timestamp = monotonicTime();
    const wallTime = Date.now() / 1000;
    
    let postData = '';
    req.on('data', chunk => postData += chunk.toString());

    req.on('end', () => {
      const requestUrl = (req.url || '').startsWith('http://') || (req.url || '').startsWith('https://')
        ? req.url
        : `http://${req.headers.host}${req.url}`;

      this.emit('requestWillBeSent', {
        requestId,
        timestamp,
        wallTime,
        request: {
          url: requestUrl,
          method: req.method,
          headers: req.headers,
          postData
        }
      });

      const host = req.headers.host || '';
      let hostname = '';
      let port = 80;
      if (host.startsWith('[')) {
        const closingBracketIndex = host.indexOf(']');
        if (closingBracketIndex !== -1) {
          hostname = host.slice(1, closingBracketIndex);
          const portPart = host.slice(closingBracketIndex + 1);
          if (portPart.startsWith(':')) {
            const parsedPort = parseInt(portPart.slice(1), 10);
            if (!isNaN(parsedPort))
              port = parsedPort;
          }
        } else {
          const lastColon = host.lastIndexOf(':');
          if (lastColon !== -1) {
            hostname = host.slice(0, lastColon);
            port = parseInt(host.slice(lastColon + 1), 10) || 80;
          } else {
            hostname = host;
          }
        }
      } else {
        const lastColon = host.lastIndexOf(':');
        if (lastColon !== -1) {
          hostname = host.slice(0, lastColon);
          port = parseInt(host.slice(lastColon + 1), 10) || 80;
        } else {
          hostname = host;
        }
      }
      if (hostname.startsWith('[') && hostname.endsWith(']'))
        hostname = hostname.slice(1, -1);

      const options: http.RequestOptions = {
        hostname,
        port,
        path: req.url,
        method: req.method,
        headers: req.headers,
        agent: this._agent
      };

      const proxyReq = http.request(options, (proxyRes) => {
        this.emit('responseReceived', {
          requestId,
          timestamp: monotonicTime(),
          response: {
            url: requestUrl,
            status: proxyRes.statusCode,
            statusText: proxyRes.statusMessage,
            headers: proxyRes.headers,
            mimeType: proxyRes.headers['content-type'] || 'application/octet-stream'
          }
        });

        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);

        proxyRes.on('end', () => {
          this.emit('loadingFinished', {
            requestId,
            timestamp: monotonicTime()
          });
        });
      });

      proxyReq.on('error', (e) => {
        if (!res.headersSent)
          res.writeHead(500);
        res.end();
      });

      if (postData)
        proxyReq.write(postData);
      proxyReq.end();
    });
  }

  private _handleConnect(req: http.IncomingMessage, cltSocket: net.Socket, head: Buffer) {
    const url = new URL(`http://${req.url}`);
    let targetHost = url.hostname;
    if (targetHost.startsWith('[') && targetHost.endsWith(']'))
      targetHost = targetHost.slice(1, -1);
    const targetPort = Number(url.port) || 443;

    let srvSocket: net.Socket | undefined;

    const cleanup = () => {
      try {
        cltSocket.destroy();
      } catch (e) {}
      if (srvSocket) {
        try {
          srvSocket.destroy();
        } catch (e) {}
      }
    };

    cltSocket.on('close', cleanup);
    cltSocket.on('end', cleanup);
    cltSocket.on('error', cleanup);

    try {
      srvSocket = net.connect(targetPort, targetHost, () => {
        try {
          cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                          'Proxy-agent: Node.js-Proxy\r\n' +
                          '\r\n');
          srvSocket!.write(head);
          srvSocket!.pipe(cltSocket);
          cltSocket.pipe(srvSocket!);
        } catch (e) {
          cleanup();
        }
      });

      srvSocket.on('close', cleanup);
      srvSocket.on('end', cleanup);
      srvSocket.on('error', (err) => {
        try {
          cltSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        } catch (e) {}
        cleanup();
      });
    } catch (e) {
      try {
        cltSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      } catch (err) {}
      cleanup();
    }
  }
}
