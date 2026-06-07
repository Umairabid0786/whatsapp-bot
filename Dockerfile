FROM node:18-slim

# Step 1: Chromium aur uski zaroori Linux libraries install karein
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Step 2: Environment variables set karein taakay puppeteer naya chrome download na kare
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

COPY package*.json ./

# Step 3: npm install use karein (yeh bina lock-file ke bhi chal jata hai)
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
