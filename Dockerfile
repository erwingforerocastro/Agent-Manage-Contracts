# Node ≥ 22.18 obligatorio: ejecuta TypeScript nativo (type stripping), sin build.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY agent ./agent
COPY src ./src
COPY web ./web
COPY fixtures ./fixtures
COPY demo.ts ./
COPY tsconfig.json ./

ENV NODE_ENV=production \
    PORT=3000 \
    LLM_PROVIDER=mock

EXPOSE 3000

CMD ["node", "--env-file-if-exists=.env", "src/server.ts"]
