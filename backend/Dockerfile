FROM node:20-alpine
WORKDIR /app

# better-sqlite3 compiles a native addon; ffmpeg powers the "audio fix" (re-encodes AC3/DTS audio to AAC)
RUN apk add --no-cache python3 make g++ ffmpeg

COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 4000
CMD ["node", "server.js"]
