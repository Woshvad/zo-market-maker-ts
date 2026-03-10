module.exports = {
  apps: [
    {
      name: "zo-mm",
      script: "node",
      args: "--import tsx src/cli/bot.ts BTC",
      restart_delay: 5000,
      exp_backoff_restart_delay: 5000,
      max_restarts: 50,
      min_uptime: 10000,
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
