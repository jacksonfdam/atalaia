/**
 * One listening server per suite, instead of one per request.
 *
 * supertest starts a server for every single call: `serverAddress` does
 * `app.listen(0)` when the thing it is handed is not already listening, and
 * closes it when the request ends. Across 1190 tests in eleven workers that is
 * thousands of bind-and-close cycles a run, and it is what made the suite
 * intermittent — a port that has just been released still has the previous
 * connection in TIME_WAIT, Node binds with SO_REUSEADDR anyway, and a stray
 * packet from the old connection reaches the new server. The client then reads
 * something that is not a response to it:
 *
 *     Parse Error: Expected HTTP/, RTSP/ or ICE/
 *     socket hang up
 *
 * Which test it lands on is whichever one drew the recycled port, which is why
 * the failure moved around every run and never reproduced on one suite alone.
 *
 * Handing supertest a server that is already listening makes it skip that
 * entirely — it reads the address and reuses it — so a suite binds one port and
 * keeps it. `request(app)` in the tests needs no change, because the variable
 * holds the server rather than the bare Express app.
 */

/**
 * Start an app listening on an arbitrary port.
 *
 * @param {import('express').Express} app
 * @returns {Promise<import('http').Server>}
 */
export function listening(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, () => resolve(server));
        server.once('error', reject);
    });
}

/**
 * Close a server started by `listening`, waiting for it to stop.
 *
 * Idle keep-alive connections are closed too: `close` alone waits for them, and
 * a suite that has finished should not hold the worker open.
 *
 * @param {import('http').Server|null|undefined} server
 * @returns {Promise<void>}
 */
export function closeServer(server) {
    if (!server?.listening) return Promise.resolve();

    server.closeIdleConnections?.();

    return new Promise(resolve => {
        server.close(() => resolve());
    });
}
