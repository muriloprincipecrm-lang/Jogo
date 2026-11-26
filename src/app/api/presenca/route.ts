import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { upgradeWebSocket } from "@vercel/functions";
import type { RawData } from "ws";

export const maxDuration = 300;

const chavePresencas = "estancia:presenca:personagens";
const duracaoPresencaMs = 30_000;

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

interface PresencaArmazenada {
  clientId: string;
  connectionId: string;
  localId: string;
  expiresAt: number;
}

interface MensagemCliente {
  type?: string;
  perfil?: string;
  personagemId?: string;
  localId?: string;
  clientId?: string;
}

const scriptReservarPersonagem = `
  local atual = redis.call("HGET", KEYS[1], ARGV[1])
  if atual then
    local registro = cjson.decode(atual)
    if tonumber(registro.expiresAt) > tonumber(ARGV[3])
      and registro.clientId ~= ARGV[2] then
      return 0
    end
  end
  redis.call("HSET", KEYS[1], ARGV[1], ARGV[4])
  return 1
`;

const scriptAtualizarPersonagem = `
  local atual = redis.call("HGET", KEYS[1], ARGV[1])
  if not atual then return 0 end
  local registro = cjson.decode(atual)
  if registro.connectionId ~= ARGV[2] then return 0 end
  registro.expiresAt = tonumber(ARGV[3])
  if ARGV[4] ~= "" then registro.localId = ARGV[4] end
  redis.call("HSET", KEYS[1], ARGV[1], cjson.encode(registro))
  return 1
`;

const scriptLiberarPersonagem = `
  local atual = redis.call("HGET", KEYS[1], ARGV[1])
  if not atual then return 0 end
  local registro = cjson.decode(atual)
  if registro.connectionId ~= ARGV[2] then return 0 end
  redis.call("HDEL", KEYS[1], ARGV[1])
  return 1
`;

let redisCompartilhado: Redis | null = null;

function obterRedis(): Redis {
  if (redisCompartilhado) return redisCompartilhado;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN para habilitar presença na Vercel.",
    );
  }
  redisCompartilhado = new Redis({ url, token });
  return redisCompartilhado;
}

async function listarPresencas() {
  const registros = await obterRedis().hgetall<
    Record<string, PresencaArmazenada>
  >(chavePresencas);
  const agora = Date.now();

  return Object.entries(registros ?? {}).flatMap(([personagemId, registro]) => {
    const personagem = personagens.get(personagemId);
    if (
      !personagem ||
      !registro ||
      typeof registro !== "object" ||
      registro.expiresAt <= agora
    ) {
      return [];
    }
    return [{
      socketId: registro.connectionId,
      personagemId,
      codigo: personagem.codigo,
      nome: personagem.nome,
      localId: registro.localId,
    }];
  });
}

function mensagemJson(dados: unknown): string {
  return JSON.stringify(dados);
}

export async function GET(request: Request) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Esta rota requer uma conexão WebSocket.", {
      status: 426,
      headers: { Upgrade: "websocket" },
    });
  }

  return upgradeWebSocket((webSocket) => {
    const connectionId = randomUUID();
    let perfilConectado: "mestre" | "jogador" | null = null;
    let personagemIdConectado: string | null = null;

    function enviar(dados: unknown) {
      if (webSocket.readyState === 1) {
        webSocket.send(mensagemJson(dados));
      }
    }

    function enviarErro(mensagem: string, fatal = false) {
      enviar({ type: "presenca:erro", mensagem, fatal });
      if (fatal && webSocket.readyState === 1) {
        webSocket.close(1008, "Presença não autorizada");
      }
    }

    async function enviarLista() {
      enviar({ type: "presenca:lista", lista: await listarPresencas() });
    }

    async function tratarMensagem(dadosBrutos: RawData) {
      let mensagem: MensagemCliente;
      try {
        mensagem = JSON.parse(dadosBrutos.toString()) as MensagemCliente;
      } catch {
        enviarErro("A mensagem de presença não está em um formato válido.", true);
        return;
      }

      try {
        if (mensagem.type === "presenca:entrar") {
          if (mensagem.perfil === "mestre") {
            perfilConectado = "mestre";
            await enviarLista();
            return;
          }

          const personagemId = mensagem.personagemId;
          const personagem = personagemId
            ? personagens.get(personagemId)
            : undefined;
          if (
            mensagem.perfil !== "jogador" ||
            !personagemId ||
            !personagem ||
            !mensagem.clientId ||
            !/^[a-zA-Z0-9_-]{1,80}$/.test(mensagem.clientId) ||
            !mensagem.localId ||
            !locais.has(mensagem.localId)
          ) {
            enviarErro("Não foi possível iniciar a presença deste personagem.", true);
            return;
          }

          const agora = Date.now();
          const registro: PresencaArmazenada = {
            clientId: mensagem.clientId,
            connectionId,
            localId: mensagem.localId,
            expiresAt: agora + duracaoPresencaMs,
          };
          const reservado = await obterRedis().eval<
            [string, string, string, string],
            number
          >(
            scriptReservarPersonagem,
            [chavePresencas],
            [
              personagemId,
              mensagem.clientId,
              String(agora),
              JSON.stringify(registro),
            ],
          );
          if (reservado !== 1) {
            enviarErro(`${personagem.codigo} já está em uso por outra conexão.`, true);
            return;
          }
          perfilConectado = "jogador";
          personagemIdConectado = personagemId;
          await enviarLista();
          return;
        }

        if (mensagem.type === "presenca:heartbeat") {
          if (perfilConectado === "jogador" && personagemIdConectado) {
            const atualizado = await obterRedis().eval<
              [string, string, string, string],
              number
            >(
              scriptAtualizarPersonagem,
              [chavePresencas],
              [
                personagemIdConectado,
                connectionId,
                String(Date.now() + duracaoPresencaMs),
                "",
              ],
            );
            if (atualizado !== 1) {
              enviarErro("A conexão de presença expirou. Reconecte ao dossiê.", true);
              return;
            }
          } else if (perfilConectado !== "mestre") {
            enviarErro("Entre no dossiê antes de atualizar a presença.", true);
            return;
          }
          await enviarLista();
          return;
        }

        if (mensagem.type === "presenca:mover") {
          if (
            perfilConectado !== "jogador" ||
            !personagemIdConectado ||
            !mensagem.localId ||
            !locais.has(mensagem.localId)
          ) {
            enviarErro("Não foi possível atualizar a posição no mapa.");
            return;
          }
          const atualizado = await obterRedis().eval<
            [string, string, string, string],
            number
          >(
            scriptAtualizarPersonagem,
            [chavePresencas],
            [
              personagemIdConectado,
              connectionId,
              String(Date.now() + duracaoPresencaMs),
              mensagem.localId,
            ],
          );
          if (atualizado !== 1) {
            enviarErro("A conexão de presença expirou. Reconecte ao dossiê.", true);
            return;
          }
          await enviarLista();
          return;
        }

        enviarErro("Tipo de mensagem de presença desconhecido.");
      } catch (erro) {
        console.error("Falha ao processar presença na Vercel:", erro);
        const configuracaoAusente =
          erro instanceof Error &&
          erro.message.startsWith("Configure UPSTASH_REDIS_REST_URL");
        enviarErro(
          configuracaoAusente
            ? "Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no projeto Vercel."
            : "Não foi possível acessar o Redis de presença. Confira a integração e tente novamente.",
          configuracaoAusente,
        );
        if (!configuracaoAusente && webSocket.readyState === 1) {
          webSocket.close(1011, "Falha temporária no serviço de presença");
        }
      }
    }

    webSocket.on("message", (dados) => {
      void tratarMensagem(dados);
    });

    webSocket.on("close", () => {
      if (perfilConectado !== "jogador" || !personagemIdConectado) return;
      void obterRedis()
        .eval<[string, string], number>(
          scriptLiberarPersonagem,
          [chavePresencas],
          [personagemIdConectado, connectionId],
        )
        .catch((erro: unknown) => {
          console.error("Falha ao liberar personagem após desconexão:", erro);
        });
    });

    webSocket.on("error", (erro) => {
      console.error("Erro na conexão WebSocket de presença:", erro);
    });
  });
}
