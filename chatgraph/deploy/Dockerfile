FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node chatgraph/server.mjs chatgraph/package.json chatgraph/LICENSE ./chatgraph/
COPY --chown=node:node chatgraph/lib/ ./chatgraph/lib/
COPY --chown=node:node chatgraph/public/ ./chatgraph/public/
COPY --chown=node:node chatgraph/mobile/README.md chatgraph/mobile/safari-shortcut.js ./chatgraph/mobile/
COPY --chown=node:node chatgraph/scripts/data-snapshot.mjs ./chatgraph/scripts/
COPY --chown=node:node chatgraph/deploy/healthcheck.mjs ./chatgraph/deploy/
COPY --chown=node:node archify/renderers/shared/ ./archify/renderers/shared/
COPY --chown=node:node archify/assets/template.html archify/assets/JetBrainsMono-OFL.txt ./archify/assets/
COPY --chown=node:node archify/LICENSE archify/THIRD_PARTY_NOTICES.md ./archify/
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV CHATGRAPH_PORT=4317
ENV CHATGRAPH_DATA_DIR=/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "chatgraph/deploy/healthcheck.mjs"]
EXPOSE 4317
CMD ["node", "chatgraph/server.mjs"]
