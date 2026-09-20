FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node chatgraph/ ./chatgraph/
COPY --chown=node:node archify/renderers/shared/ ./archify/renderers/shared/
COPY --chown=node:node archify/assets/template.html archify/assets/JetBrainsMono-OFL.txt ./archify/assets/
COPY --chown=node:node archify/LICENSE archify/THIRD_PARTY_NOTICES.md ./archify/
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV CHATGRAPH_PORT=4317
EXPOSE 4317
CMD ["node", "chatgraph/server.mjs"]
