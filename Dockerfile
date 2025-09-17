# Build stage to clone template
FROM node:18-alpine AS builder

# Install git for cloning
RUN apk add --no-cache git

# Clone the template repository during image build - force pull latest
RUN git clone https://github.com/Softgen-Labs/softgen-ts-firebase-starter /template-files && \
    cd /template-files && \
    git pull origin main && \
    rm -rf /template-files/.git /template-files/.github # Remove to avoid conflicts

# Final stage
FROM node:18-alpine

# Metadata
LABEL maintainer="Softgen AI"
LABEL description="Softgen AI Starter"
LABEL version="2.2.4"

# Install global dependencies and security updates
RUN npm install -g pm2 vercel && \
    apk add --no-cache tmux git && \
    apk upgrade --no-cache

# Create non-root user with explicit UID/GID for consistency
RUN addgroup -g 1001 -S softgen && \
    adduser -u 1001 -S softgen -G softgen -h /home/softgen -s /bin/sh && \
    mkdir -p /app /home/softgen/bin && \
    chown -R softgen:softgen /app /home/softgen

# Copy and set up initialization script BEFORE switching user
COPY --chown=softgen:softgen init-workspace.sh /home/softgen/bin/init-workspace.sh
RUN chmod +x /home/softgen/bin/init-workspace.sh

# Copy template files from builder stage
COPY --from=builder --chown=softgen:softgen /template-files /template-files

# Switch to non-root user
USER softgen

# Set up environment
EXPOSE 3000
WORKDIR /app

# Use initialization script as entrypoint
ENTRYPOINT ["/bin/sh", "-c", "/home/softgen/bin/init-workspace.sh && cd /app && [ -f ecosystem.config.js ] && pm2 start || echo 'ecosystem.config.js not found, skipping pm2 start' && sleep infinity"]
