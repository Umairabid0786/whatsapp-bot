# 1. Node 20 LTS use karein (Ismein Crypto globally built-in hota hai)
FROM node:20-slim

# 2. Git install karein (jo npm install ke liye zaroori hai)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# 3. Working directory set karein
WORKDIR /usr/src/app

# 4. Package files copy karein
COPY package*.json ./

# 5. Clean install karein
RUN npm install

# 6. Baqi saara code copy karein
COPY . .

# 7. Render ke liye port expose karein
EXPOSE 10000

# 8. App ko start karein
CMD ["npm", "start"]
