FROM node:20-alpine
WORKDIR /app

# better-sqlite3 compiles a native addon at install time
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 4000
CMD ["node", "server.js"]
