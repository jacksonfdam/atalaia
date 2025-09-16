# Stage 1: Builder - Instala as dependências
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production

# Stage 2: Production - Cria a imagem final
FROM node:20-alpine
WORKDIR /app

# Copia as dependências instaladas do estágio 'builder'
COPY --from=builder /app/node_modules ./node_modules

# Copia o código da aplicação e a configuração
COPY src ./src
COPY config.json ./config.json

# Expõe a porta que o Express usa
EXPOSE 3000

# Define o comando para iniciar a aplicação
CMD ["node", "src/interface/index.js"]