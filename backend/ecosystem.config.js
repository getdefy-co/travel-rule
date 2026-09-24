module.exports = {
  apps: [
    {
      name: 'DEFY_TRAVEL_RULE_API',
      script: 'dist/index.js',
      interpreter: 'node',
      instances: 1,
      max_memory_restart: '300M',
      out_file: './logs/out_v2_api.log',
      error_file: './logs/error_v2_api.log',
      merge_logs: true,
      cron_restart: '45 */6 * * *',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
