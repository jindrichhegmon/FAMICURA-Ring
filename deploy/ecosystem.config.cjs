// pm2 start deploy/ecosystem.config.cjs   (na VPS jako uživatel jhnapps)
module.exports = {
  apps: [{
    name: 'famicura-ring',
    script: 'server.mjs',
    cwd: __dirname + '/..',
    // Port určuje nasazení, ne .env: server.mjs dává přednost prostředí před
    // .env, takže zapomenutý PORT v pm2 by .env přebil a proces by padal na
    // EADDRINUSE cizího portu. Tady je vidět, s čím se doopravdy startuje.
    env: { NODE_ENV: 'production', TZ: 'Europe/Prague', PORT: process.env.PORT || '3111' },
    max_memory_restart: '300M',
    autorestart: true,
  }],
};
