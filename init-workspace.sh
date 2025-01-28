#!/bin/sh

if [ ! -f "/app/package.json" ]; then
    echo "First time setup: Copying template files..."
    # Copy all files except init-workspace.sh and Dockerfile
    cd /template-files && find . -type f ! -name 'init-workspace.sh' ! -name 'Dockerfile' -exec cp --parents {} /app/ \;
    cd /template-files && find . -type f -name '.*' ! -name 'init-workspace.sh' ! -name 'Dockerfile' -exec cp --parents {} /app/ \; 2>/dev/null || true
    
else
    echo "Workspace already initialized, skipping setup..."
fi

# Create .env.local if it doesn't exist
if [ ! -f "/app/.env.local" ]; then
    echo "Creating .env.local file..."
    touch /app/.env.local
fi

exec "$@"
