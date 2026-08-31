FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org \
    && npm install --no-save --omit=dev @huggingface/transformers@3.8.1 --registry=https://registry.npmjs.org \
    && npm run verify:deps \
    && npm cache clean --force
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
