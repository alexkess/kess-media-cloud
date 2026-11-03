FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DB_FILE=/data/kess-cloud.db DATA_DIR=/data
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
