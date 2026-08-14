import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * pino throws on a level it does not know, which turns a typo in LOG_LEVEL into
 * a container that will not boot — and the message ("default level:verbose must
 * be included in custom levels") does not obviously point at the environment.
 * An unusable level is worth a warning and the default, not an outage.
 */
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

function resolveLevel() {
    const requested = process.env.LOG_LEVEL;
    if (!requested) return 'info';
    if (LEVELS.includes(requested)) return requested;

    // console, not the logger: it does not exist yet.
    console.warn(
        `LOG_LEVEL="${requested}" is not a pino level (${LEVELS.join(', ')}). Falling back to info.`
    );
    return 'info';
}

const logger = pino({
    level: resolveLevel(),
    ...(isProduction
        ? {}
        : {
              transport: {
                  target: 'pino-pretty',
                  options: {
                      colorize: true,
                      translateTime: 'SYS:standard',
                  },
              },
          }),
});

export default logger;
