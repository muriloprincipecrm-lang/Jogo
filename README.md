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

O mapa ilustrado usado como fundo fica em `public/mapa-estancia-v2.jpg`. Os locais,
os códigos impressos na arte e as coordenadas dos pontos clicáveis são definidos
em `src/data/cenario.ts`; preserve a proporção original de 1360 × 768 ao trocar a
imagem. A arte completa fica visível para mestres e jogadores; os controles de
revelação continuam valendo para a seleção dos pontos e seus detalhes.

### Publicar na Vercel

A aplicação pode usar o suporte beta de WebSockets das Vercel Functions. Nesse
modo, a presença compartilhada é armazenada no Redis e renovada por heartbeat;
conexões perdidas expiram após 30 segundos. A conexão pode ser encerrada pelo
limite de duração da Function, e o cliente reconecta automaticamente.

1. Ative Fluid Compute no projeto Vercel, se ainda não estiver habilitado.
2. Crie um banco Redis (por exemplo, pelo marketplace da Vercel com o plano
   gratuito do Upstash) e adicione `UPSTASH_REDIS_REST_URL` e
   `UPSTASH_REDIS_REST_TOKEN` às variáveis de ambiente do projeto.
3. Faça um novo deploy. O domínio padrão `*.vercel.app` seleciona o transporte
   WebSocket automaticamente; para um domínio próprio, configure
   `NEXT_PUBLIC_PRESENCE_TRANSPORT=vercel` no ambiente de produção.

O endpoint WebSocket fica em `/api/presenca`. Sem as credenciais do Redis, a
presença na Vercel retorna um erro explícito; ela não usa estado em memória
como substituto, pois os jogadores podem chegar a instâncias diferentes.
O suporte WebSocket está em beta e o uso das Functions/Redis continua sujeito
aos limites e às cotas dos respectivos planos.

Configuração opcional:

- `SOCKET_PORT`: porta do serviço Socket.IO (padrão `3001`).
- `SOCKET_ALLOWED_ORIGINS`: origens permitidas separadas por vírgula.
- `NEXT_PUBLIC_SOCKET_URL`: endereço do serviço Socket.IO usado pelo navegador.
- `NEXT_PUBLIC_PRESENCE_TRANSPORT=vercel`: força WebSockets da Vercel; o valor
  `socketio` força Socket.IO. Sem valor, domínios `*.vercel.app` usam WebSocket.
- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`: necessários para a
  presença compartilhada na Vercel.

O perfil e as fichas continuam salvos no `localStorage` de cada navegador; o
serviço de presença não é um sistema de autenticação ou armazenamento de
campanha.

## Trama & dossiê

O Mestre pode criar e editar linhas de trama e importar arquivos JSON no formato
`{ "tramas": [{ "titulo": "Nome", "descricao": "Detalhes", "revelado": false }] }`.
As importações são adicionadas às tramas existentes; itens começam ocultos quando
`revelado` não é informado. O botão de olho bloqueia a trama tanto para os
jogadores quanto na tela do Mestre, substituindo título e descrição por um aviso
neutro durante transmissões. As alterações ficam no `localStorage` do navegador.

## Acervo do mestre

O Mestre pode adicionar e editar fotos, documentos e pistas, abrir uma
pré-visualização e importar itens em JSON. O arquivo aceita uma lista na raiz ou
o formato `{ "acervo": [{ "titulo": "Nome", "categoria": "Pista", "descricao": "Detalhes", "imagem": "https://...", "revelado": false }] }`.
O título é obrigatório; categoria, descrição, imagem e visibilidade são
opcionais (a categoria padrão é `Pista`). A imagem pode ser uma URL HTTP(S) ou
uma imagem JPG, PNG, WEBP ou GIF em data URI. Importações são adicionadas ao
acervo e itens começam bloqueados quando `revelado` não é informado.

O botão de olho bloqueia o item para os jogadores e também oculta seus detalhes
na tela do Mestre, substituindo-os por um cartão neutro. As alterações ficam no
`localStorage` do navegador.

O botão **Importar save point** recebe um JSON completo do estado do dossiê:
`tramas`, `locais`, `pessoas`, `acervo`, `anotacoes`, `dia`, `tensao` e `pistas`.
Após confirmação, substitui o estado local inteiro. O importador de itens JSON
continua separado e adiciona somente novos itens ao Acervo.
