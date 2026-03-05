FROM node:22-alpine

WORKDIR /app

COPY . .

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003

CMD ["node", "web/server.js"]

