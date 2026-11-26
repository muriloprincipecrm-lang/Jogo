# Estância do Fogo Frio

Aplicação de apoio a uma investigação de horror, com fichas Delta Green,
controle de revelações e presença dos personagens no mapa em tempo real.

## Executar localmente

```bash
npm install
npm run dev
```

O comando inicia o Next.js na porta `3000` e o serviço Socket.IO na porta
`3001`. Para abrir a aplicação em outros dispositivos da rede local, use o
endereço IP do computador que está executando os serviços.

Em produção, `npm run build` gera a aplicação e `npm start` inicia o Next.js e
o serviço Socket.IO juntos.

## Presença no mapa

Jogadores escolhem um convocado liberado no primeiro acesso. Cada personagem só
pode estar conectado por um jogador de cada vez. Ao clicar em um local
revelado, a posição do personagem é enviada aos demais clientes conectados.
No desenvolvimento local, o serviço Socket.IO mantém a presença em memória.

### Publicar na Vercel

A aplicação pode usar o suporte beta de WebSockets das Vercel Functions. Nesse
modo, a presença compartilhada é armazenada no Redis e renovada por heartbeat;
conexões perdidas expiram após 30 segundos. A conexão pode ser encerrada pelo
limite de duração da Function, e o cliente reconecta automaticamente.

1. Ative Fluid Compute no projeto Vercel, se ainda não estiver habilitado.
2. Crie um banco Redis (por exemplo, pelo marketplace da Vercel com o plano
   gratuito do Upstash) e adicione `UPSTASH_REDIS_REST_URL` e
   `UPSTASH_REDIS_REST_TOKEN` às variáveis de ambiente do projeto.
3. Configure `NEXT_PUBLIC_PRESENCE_TRANSPORT=vercel` para o ambiente de
   produção e faça um novo deploy.

O endpoint WebSocket fica em `/api/presenca`. Sem as credenciais do Redis, a
presença na Vercel retorna um erro explícito; ela não usa estado em memória
como substituto, pois os jogadores podem chegar a instâncias diferentes.
O suporte WebSocket está em beta e o uso das Functions/Redis continua sujeito
aos limites e às cotas dos respectivos planos.

Configuração opcional:

- `SOCKET_PORT`: porta do serviço Socket.IO (padrão `3001`).
- `SOCKET_ALLOWED_ORIGINS`: origens permitidas separadas por vírgula.
- `NEXT_PUBLIC_SOCKET_URL`: endereço do serviço Socket.IO usado pelo navegador.
- `NEXT_PUBLIC_PRESENCE_TRANSPORT=vercel`: usa WebSockets da Vercel no navegador.
- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`: necessários para a
  presença compartilhada na Vercel.

O perfil e as fichas continuam salvos no `localStorage` de cada navegador; o
serviço de presença não é um sistema de autenticação ou armazenamento de
campanha.
