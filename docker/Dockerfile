# HanaAgent Docker 镜像 — 多阶段构建
# 阶段 1: 构建 Web 前端静态文件
FROM node:22-bookworm-slim AS web-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖清单（利用层缓存）
COPY package.json ./
COPY packages/plugin-protocol/package.json packages/plugin-protocol/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugin-runtime/package.json packages/plugin-runtime/
COPY packages/plugin-components/package.json packages/plugin-components/
# postinstall 脚本需要此文件
COPY scripts/patch-pi-sdk.cjs scripts/patch-pi-sdk.cjs

# 不使用 package-lock.json（避免跨平台 lockfile 冲突）
RUN npm install --no-audit --no-fund --package-lock=false

# 复制前端源码和构建配置
COPY desktop/src/ ./desktop/src/
COPY desktop/src/react/ ./desktop/src/react/
COPY desktop/src/modules/ ./desktop/src/modules/
COPY desktop/src/lib/ ./desktop/src/lib/
COPY desktop/src/themes/ ./desktop/src/themes/
COPY desktop/src/assets/ ./desktop/src/assets/
COPY desktop/src/locales/ ./desktop/src/locales/
COPY desktop/src/styles.css ./desktop/src/
COPY desktop/src/animations.css ./desktop/src/
COPY desktop/src/icon.png ./desktop/src/
COPY packages/ ./packages/
COPY vite.config.web.ts ./
COPY tsconfig.json ./

# 构建 Web 前端
RUN npx vite build --config vite.config.web.ts

# ── 阶段 2: 生产运行镜像 ──
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖清单
COPY package.json ./
COPY packages/plugin-protocol/package.json packages/plugin-protocol/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugin-runtime/package.json packages/plugin-runtime/
COPY packages/plugin-components/package.json packages/plugin-components/
# postinstall 脚本需要此文件
COPY scripts/patch-pi-sdk.cjs scripts/patch-pi-sdk.cjs

# 不使用 package-lock.json（避免跨平台 lockfile 冲突）
RUN npm install --no-audit --no-fund --package-lock=false && npm prune --omit=dev

# 复制 server 源码和运行时依赖
COPY core/ ./core/
COPY server/ ./server/
COPY lib/ ./lib/
COPY shared/ ./shared/
COPY hub/ ./hub/
COPY plugins/ ./plugins/
COPY skills2set/ ./skills2set/
COPY cli/ ./cli/
COPY packages/ ./packages/

# 从构建阶段复制 Web 前端产物
COPY --from=web-builder /app/dist-web/ ./dist-web/

# 复制启动脚本
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 数据持久化目录
VOLUME ["/data"]

# 环境变量
ENV HANA_HOME=/data
ENV HANA_PORT=14500
ENV HANA_HOST=0.0.0.0
ENV HANA_CORS_ORIGIN=""
ENV HANA_CREATE_STARTUP_SESSION=0
ENV NODE_ENV=production

EXPOSE 14500

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.HANA_PORT||'14500')+'/api/health').then(r=>{if(!r.ok)throw new Error(r.status);process.exit(0)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
