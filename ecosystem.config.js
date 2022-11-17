module.exports = {
  apps: [
    {
      name: 'proxy-monitor-slack',
      script: 'dist/main.js',
      watch: ['./dist'],
      autorestart: true,
      cron_restart: '0 * * * *',
      interpreter: 'node@16.18.0',
    },
  ],
};
