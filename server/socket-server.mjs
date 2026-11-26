import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { Server } from "socket.io";

const porta = Number(process.env.SOCKET_PORT || 3001);
const personagens = new Map([
  ["helena", { codigo: "P-01", nome: "Helena Duarte" }],
  ["raul", { codigo: "P-02", nome: "Raul Nascimento" }],
  ["ines", { codigo: "P-03", nome: "Inês Valença" }],
  ["marcos", { codigo: "P-04", nome: "Marcos Lira" }],
  ["bia", { codigo: "P-05", nome: "Beatriz (Bia) Moura" }],
  ["davi", { codigo: "P-06", nome: "Davi Azevedo" }],
  ["lara", { codigo: "P-07", nome: "Lara Siqueira" }],
  ["joaquim", { codigo: "P-08", nome: "Joaquim Reis" }],
  ["celia", { codigo: "P-09", nome: "Célia Prado" }],
  ["tomas", { codigo: "P-10", nome: "Tomás Vilar" }],
]);
const locais = new Set([
  "sede",
  "cabana",
  "mata",
  "galpao",
  "porão",
  "capela",
  "represa",
]);
const ocupacoes = new Map();
const socketPorPersonagem = new Map();

function origensPermitidas() {
  const configuradas = process.env.SOCKET_ALLOWED_ORIGINS
    ?.split(",")
    .map((origem) => origem.trim())
    .filter(Boolean);
  if (configuradas?.length) return new Set(configuradas);

  const enderecos = new Set(["localhost", "127.0.0.1"]);
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const interfaceRede of interfaces ?? []) {
      if (!interfaceRede.internal && interfaceRede.family === "IPv4") {
        enderecos.add(interfaceRede.address);
      }
    }
  }
  return new Set([...enderecos].map((endereco) => `http://${endereco}:3000`));
}

const origens = origensPermitidas();
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin(origem, callback) {
      if (!origem || origens.has(origem)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origem não autorizada para o serviço de presença."));
    },
  },
});

function listaPresenca() {
  return [...ocupacoes.values()]
    .filter((ocupacao) => ocupacao.perfil === "jogador")
    .map(({ socketId, personagemId, localId }) => ({
      socketId,
      personagemId,
      codigo: personagens.get(personagemId).codigo,
      nome: personagens.get(personagemId).nome,
      localId,
    }));
}

function publicarPresenca() {
  io.emit("presenca:lista", listaPresenca());
}

function liberarSocket(socketId) {
  const ocupacao = ocupacoes.get(socketId);
  if (!ocupacao) return;
  ocupacoes.delete(socketId);
  if (ocupacao.personagemId) {
    socketPorPersonagem.delete(ocupacao.personagemId);
  }
  publicarPresenca();
}

io.on("connection", (socket) => {
  socket.emit("presenca:lista", listaPresenca());

  socket.on("presenca:entrar", (dados) => {
    if (dados?.perfil === "mestre") {
      ocupacoes.set(socket.id, { socketId: socket.id, perfil: "mestre" });
      socket.emit("presenca:lista", listaPresenca());
      return;
    }

    const personagemId = dados?.personagemId;
    const personagem = personagens.get(personagemId);
    if (dados?.perfil !== "jogador" || !personagem) {
      socket.emit("presenca:erro", {
        mensagem: "Não foi possível iniciar a presença deste personagem.",
      });
      return;
    }

    const socketExistente = socketPorPersonagem.get(personagemId);
    if (socketExistente && socketExistente !== socket.id) {
      socket.emit("presenca:erro", {
        mensagem: `${personagem.codigo} já está em uso por outra conexão.`,
      });
      return;
    }

    ocupacoes.set(socket.id, {
      socketId: socket.id,
      perfil: "jogador",
      personagemId,
      localId: locais.has(dados.localId) ? dados.localId : "sede",
    });
    socketPorPersonagem.set(personagemId, socket.id);
    publicarPresenca();
  });

  socket.on("presenca:mover", (dados) => {
    const ocupacao = ocupacoes.get(socket.id);
    if (ocupacao?.perfil !== "jogador" || !locais.has(dados?.localId)) {
      socket.emit("presenca:erro", {
        mensagem: "Não foi possível atualizar a posição no mapa.",
      });
      return;
    }
    ocupacao.localId = dados.localId;
    publicarPresenca();
  });

  socket.on("disconnect", () => liberarSocket(socket.id));
});

httpServer.listen(porta, "0.0.0.0", () => {
  console.log(`Serviço de presença Socket.IO ouvindo na porta ${porta}.`);
});
