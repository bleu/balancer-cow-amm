// Keep the HTTP/Next shutdown boundary independently testable.
export function createServerShutdown(server, closeWeb) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let closing;
  return () => {
    if (closing) return closing;
    // HTTP close waits for upgraded sockets, while Next owns their cleanup.
    // Start both cleanups together and explicitly close upgraded connections.
    closing = Promise.all([
      new Promise((resolve) => server.close(resolve)),
      Promise.resolve().then(closeWeb),
    ]).then(() => {});
    server.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    return closing;
  };
}
