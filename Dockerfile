FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bot ./bot
COPY ui ./ui
COPY config.json config.alpha.json config.mind.json config.scalp.json config.speed.json ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "bot/dual.js"]
