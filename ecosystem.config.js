module.exports = {
  apps: [{
    name: 'nextjs',
    script: 'npm',
    args: 'run dev',
    autorestart: true,
    max_restarts: 5,
    exp_backoff_restart_delay: 100,
    watch: false,
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    restart_delay: 4000,
    // Execute cleanup script on restart failure
    post_update: ['./cleanup-and-reinstall.sh'],
  }]
};
