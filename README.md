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
O estado de presença fica em memória no servidor e é removido quando o cliente
desconecta ou o serviço reinicia.

Configuração opcional:

- `SOCKET_PORT`: porta do serviço Socket.IO (padrão `3001`).
- `SOCKET_ALLOWED_ORIGINS`: origens permitidas separadas por vírgula.
- `NEXT_PUBLIC_SOCKET_URL`: endereço do serviço Socket.IO usado pelo navegador.

O perfil e as fichas continuam salvos no `localStorage` de cada navegador; o
serviço de presença não é um sistema de autenticação ou armazenamento de
campanha.
