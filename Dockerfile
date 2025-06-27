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
LABEL version="2.1.0"

# Install global dependencies
RUN npm install -g pm2 vercel
RUN apk add --no-cache tmux git

# Copy template files from builder stage
COPY --from=builder /template-files /template-files

# Set up environment
EXPOSE 3000
WORKDIR /app

# Add initialization script
COPY init-workspace.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init-workspace.sh

# Use initialization script as entrypoint
ENTRYPOINT ["/bin/sh", "-c", "/usr/local/bin/init-workspace.sh && cd /app && [ -f ecosystem.config.js ] && pm2 start || echo 'ecosystem.config.js not found, skipping pm2 start' && sleep infinity"]
