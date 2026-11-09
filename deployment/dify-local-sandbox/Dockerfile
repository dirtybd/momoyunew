FROM langgenius/dify-agent-local-sandbox:1.18.0
USER root
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libreoffice-writer poppler-utils fontconfig fonts-noto-cjk fonts-liberation \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*
USER dify
