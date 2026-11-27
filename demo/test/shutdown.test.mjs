import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { createServerShutdown } from "../lib/shutdown.mjs";

test("Shutdown closes upgraded connections and releases the HTTP listener", async () => {
  const server = http.createServer();
  let upgraded;
  server.on("upgrade", (_req, socket) => {
    upgraded = socket;
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
    );
  });
  let cleanups = 0;
  const close = createServerShutdown(server, async () => {
    cleanups++;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = net.connect(server.address().port, "127.0.0.1");
  let timer;
  try {
    await once(client, "connect");
    client.write(
      "GET /_next/webpack-hmr HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
    );
    await once(client, "data");
    await Promise.race([
      close(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Shutdown hung with an upgraded connection")),
          500
        );
      }),
    ]);
    assert.equal(server.listening, false);
    assert.equal(upgraded.destroyed, true);
    assert.equal(cleanups, 1);
    // Repeated signals should share the same completed shutdown.
    await close();
    assert.equal(cleanups, 1);
  } finally {
    clearTimeout(timer);
    client.destroy();
    upgraded?.destroy();
    server.close();
  }
});
