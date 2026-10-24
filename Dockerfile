FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org \
    && npm install --no-save --omit=dev @huggingface/transformers@3.8.1 argon2@0.41.1 --registry=https://registry.npmjs.org \
    && node -e "const a=require('argon2');if(typeof a.hash!=='function'||typeof a.verify!=='function'||!a.argon2id)process.exit(1);console.log('GPAY_ARGON2_READY')" \
    && npm run verify:deps \
    && npm cache clean --force
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
