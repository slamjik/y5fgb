FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_API_PREFIX=/api/v1

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_API_PREFIX=${VITE_API_PREFIX}

COPY . .

RUN npm ci
RUN npm run build --workspace apps/client-web

FROM nginx:1.29-alpine
WORKDIR /usr/share/nginx/html

COPY infra/nginx/client-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client-web/dist/ /usr/share/nginx/html/

HEALTHCHECK --interval=20s --timeout=5s --retries=5 CMD wget --spider -q http://127.0.0.1/healthz || exit 1
