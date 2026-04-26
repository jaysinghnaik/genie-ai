# Use Microsoft Playwright's official focal image for best compatibility
FROM mcr.microsoft.com/playwright:v1.44.0-focal

# Set working directory
WORKDIR /app

# Copy package data
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Hugging Face Spaces specific tweaks
# Set home directory to /app for permission reasons
ENV HOME=/app

# Expose the default HF Spaces port
EXPOSE 7860

# Start command
CMD ["node", "server.js"]
