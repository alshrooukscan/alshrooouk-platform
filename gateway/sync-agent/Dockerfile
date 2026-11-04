FROM node:20-slim
# python3 + pydicom for romexis/romexis_bundle.py (Romexis export layout, 4 Nov 2026)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages pydicom==3.0.1 \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
CMD ["node", "index.js"]
