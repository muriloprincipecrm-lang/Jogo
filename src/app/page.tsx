"use client";

import {
  ChangeEvent,
  FormEvent,
  useMemo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import { io, type Socket } from "socket.io-client";
import { estadoInicial } from "@/data/cenario";
import { cartasDeServico } from "@/data/cartas-de-servico";
import { normalizarEstadoPessoa } from "@/data/characters";
import type {
  EstadoCenario,
  EstadoLocal,
  EstadoPessoa,
  ItemAcervo,
  LocalCenario,
  PessoaCenario,
  TramaCenario,
} from "@/types/cenario";

type Guia = "trama" | "mapa" | "personagens" | "acervo";
const chaveArmazenamento = "estancia-do-fogo-v1";
const chavePerfil = "estancia-do-fogo-perfil-v1";
const chavePersonagem = "estancia-do-fogo-personagem-v1";

type Perfil = "mestre" | "jogador";
type StatusSocket = "conectando" | "conectado" | "desconectado" | "erro";

function usarWebSocketVercel() {
  const transporte = process.env.NEXT_PUBLIC_PRESENCE_TRANSPORT;
  if (transporte === "vercel") return true;
  if (transporte === "socketio") return false;
  return window.location.hostname.endsWith(".vercel.app");
}

interface PresencaJogador {
  socketId: string;
  personagemId: string;
  codigo: string;
  nome: string;
  localId: string | null;
}

function observarArmazenamento(notificar: () => void) {
  window.addEventListener("storage", notificar);
  window.addEventListener("estancia:estado", notificar);
  return () => {
    window.removeEventListener("storage", notificar);
    window.removeEventListener("estancia:estado", notificar);
  };
}

function lerArmazenamento() {
  try {
    return window.localStorage.getItem(chaveArmazenamento);
  } catch {
    return "__ERRO_DE_ARMAZENAMENTO__";
  }
}

function lerArmazenamentoNoServidor() {
  return null;
}

function observarPerfil(notificar: () => void) {
  window.addEventListener("storage", notificar);
  window.addEventListener("estancia:perfil", notificar);
  return () => {
    window.removeEventListener("storage", notificar);
    window.removeEventListener("estancia:perfil", notificar);
  };
}

function lerPerfil() {
  try {
    return window.localStorage.getItem(chavePerfil);
  } catch {
    return "__ERRO_DE_PERFIL__";
  }
}

function lerPerfilNoServidor() {
  return null;
}

function lerPersonagemSelecionado() {
  try {
    return window.localStorage.getItem(chavePersonagem);
  } catch {
    return null;
  }
}

function lerPersonagemNoServidor() {
  return null;
}

type PessoaSalvaParcial = Partial<PessoaCenario> & {
  notas?: string;
  atributos?: Partial<PessoaCenario["atributos"]>;
  derivados?: Partial<PessoaCenario["derivados"]>;
};

interface EntradaTramaJson {
  titulo: string;
  descricao?: string;
  revelado?: boolean;
}

interface EntradaAcervoJson {
  titulo: string;
  categoria?: ItemAcervo["categoria"];
  descricao?: string;
  imagem?: string;
  revelado?: boolean;
}

interface RascunhoAcervo {
  id: string | null;
  titulo: string;
  categoria: ItemAcervo["categoria"];
  descricao: string;
  imagem: string;
}

function validarEntradaTrama(valor: unknown): valor is Record<string, unknown> & EntradaTramaJson {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const entrada = valor as Record<string, unknown>;
  return (
    typeof entrada.titulo === "string" &&
    entrada.titulo.trim().length > 0 &&
    (entrada.descricao === undefined || typeof entrada.descricao === "string") &&
    (entrada.revelado === undefined || typeof entrada.revelado === "boolean")
  );
}

function extrairTramasJson(valor: unknown): EntradaTramaJson[] | null {
  let entradas: unknown[] | null = Array.isArray(valor) ? valor : null;
  if (!entradas && valor && typeof valor === "object" && !Array.isArray(valor)) {
    const lista = (valor as Record<string, unknown>).tramas;
    if (Array.isArray(lista)) entradas = lista;
  }
  if (!entradas) return null;
  const entradasValidadas: EntradaTramaJson[] = [];
  for (const entrada of entradas) {
    if (!validarEntradaTrama(entrada)) return null;
    entradasValidadas.push(entrada);
  }
  return entradasValidadas;
}

function ehCategoriaAcervo(valor: unknown): valor is ItemAcervo["categoria"] {
  return valor === "Fotografia" || valor === "Documento" || valor === "Pista";
}

function ehImagemAcervo(valor: string) {
  if (!valor) return true;
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(valor)) return true;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validarEntradaAcervoJson(
  valor: unknown,
): valor is Record<string, unknown> & EntradaAcervoJson {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const entrada = valor as Record<string, unknown>;
  return (
    typeof entrada.titulo === "string" &&
    entrada.titulo.trim().length > 0 &&
    (entrada.categoria === undefined || ehCategoriaAcervo(entrada.categoria)) &&
    (entrada.descricao === undefined || typeof entrada.descricao === "string") &&
    (entrada.imagem === undefined ||
      (typeof entrada.imagem === "string" && ehImagemAcervo(entrada.imagem))) &&
    (entrada.revelado === undefined || typeof entrada.revelado === "boolean")
  );
}

function extrairAcervoJson(valor: unknown): EntradaAcervoJson[] | null {
  let entradas: unknown[] | null = Array.isArray(valor) ? valor : null;
  if (!entradas && valor && typeof valor === "object" && !Array.isArray(valor)) {
    const lista = (valor as Record<string, unknown>).acervo;
    if (Array.isArray(lista)) entradas = lista;
  }
  if (!entradas) return null;
  const entradasValidadas: EntradaAcervoJson[] = [];
  for (const entrada of entradas) {
    if (!validarEntradaAcervoJson(entrada)) return null;
    entradasValidadas.push(entrada);
  }
  return entradasValidadas;
}

function ehRegistroJson(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor && typeof valor === "object" && !Array.isArray(valor));
}

function ehNumeroFinito(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

function idsUnicos(registros: unknown[]) {
  const ids = new Set<string>();
  for (const registro of registros) {
    if (!ehRegistroJson(registro) || typeof registro.id !== "string" || !registro.id) {
      return false;
    }
    if (ids.has(registro.id)) return false;
    ids.add(registro.id);
  }
  return true;
}

function validarTramaSavePoint(valor: unknown): valor is TramaCenario {
  return (
    ehRegistroJson(valor) &&
    typeof valor.id === "string" &&
    typeof valor.titulo === "string" &&
    valor.titulo.trim().length > 0 &&
    typeof valor.descricao === "string" &&
    typeof valor.revelado === "boolean"
  );
}

function validarLocalSavePoint(valor: unknown): valor is LocalCenario {
  return (
    ehRegistroJson(valor) &&
    typeof valor.id === "string" &&
    typeof valor.nome === "string" &&
    valor.nome.trim().length > 0 &&
    typeof valor.categoria === "string" &&
    typeof valor.descricao === "string" &&
    (valor.estado === "Livre" ||
      valor.estado === "Investigado" ||
      valor.estado === "Perigoso" ||
      valor.estado === "Bloqueado") &&
    typeof valor.revelado === "boolean" &&
    ehNumeroFinito(valor.x) &&
    valor.x >= 0 &&
    valor.x <= 100 &&
    ehNumeroFinito(valor.y) &&
    valor.y >= 0 &&
    valor.y <= 100 &&
    (valor.numeroMapa === undefined || typeof valor.numeroMapa === "string")
  );
}

function validarPessoaSavePoint(valor: unknown): valor is PessoaCenario {
  if (!ehRegistroJson(valor)) return false;
  const atributos = valor.atributos;
  const derivados = valor.derivados;
  if (!ehRegistroJson(atributos) || !ehRegistroJson(derivados)) return false;
  const atributosDg = ["STR", "CON", "DEX", "INT", "POW", "CHA"];
  const camposDerivados = [
    "hpAtual",
    "hpMaximo",
    "wpAtual",
    "wpMaximo",
    "sanAtual",
    "sanInicial",
    "breakingPoint",
  ];
  const estadosValidos = [
    "VIVO",
    "SUSPEITO",
    "DESAPARECIDO",
    "FERIDO",
    "POSSUÍDO",
  ];
  return (
    typeof valor.id === "string" &&
    valor.id.length > 0 &&
    typeof valor.codigo === "string" &&
    valor.codigo.length > 0 &&
    typeof valor.nome === "string" &&
    valor.nome.trim().length > 0 &&
    typeof valor.funcao === "string" &&
    typeof valor.estado === "string" &&
    estadosValidos.includes(valor.estado) &&
    typeof valor.notaPublica === "string" &&
    typeof valor.segredoMestre === "string" &&
    typeof valor.foto === "string" &&
    ehImagemAcervo(valor.foto) &&
    typeof valor.revelado === "boolean" &&
    typeof valor.statusRevelado === "boolean" &&
    typeof valor.fichaRevelada === "boolean" &&
    atributosDg.every(
      (campo) =>
        ehNumeroFinito(atributos[campo]) &&
        atributos[campo] >= 0 &&
        atributos[campo] <= 20,
    ) &&
    camposDerivados.every(
      (campo) => ehNumeroFinito(derivados[campo]) && derivados[campo] >= 0,
    ) &&
    Array.isArray(valor.pericias) &&
    valor.pericias.every(
      (pericia) =>
        ehRegistroJson(pericia) &&
        typeof pericia.nome === "string" &&
        ehNumeroFinito(pericia.valor) &&
        pericia.valor >= 0 &&
        pericia.valor <= 100,
    ) &&
    Array.isArray(valor.vinculos) &&
    valor.vinculos.every(
      (vinculo) =>
        ehRegistroJson(vinculo) &&
        typeof vinculo.nome === "string" &&
        ehNumeroFinito(vinculo.pontuacao) &&
        vinculo.pontuacao >= 0 &&
        vinculo.pontuacao <= 15 &&
        typeof vinculo.danificado === "boolean",
    ) &&
    Array.isArray(valor.motivacoes) &&
    valor.motivacoes.every((motivacao) => typeof motivacao === "string") &&
    typeof valor.traumas === "string"
  );
}

function validarItemSavePoint(valor: unknown): valor is ItemAcervo {
  return (
    ehRegistroJson(valor) &&
    typeof valor.id === "string" &&
    typeof valor.titulo === "string" &&
    valor.titulo.trim().length > 0 &&
    ehCategoriaAcervo(valor.categoria) &&
    typeof valor.descricao === "string" &&
    typeof valor.imagem === "string" &&
    ehImagemAcervo(valor.imagem) &&
    typeof valor.revelado === "boolean"
  );
}

function validarSavePoint(valor: unknown): valor is EstadoCenario {
  if (!ehRegistroJson(valor)) return false;
  const { tramas, locais, pessoas, acervo } = valor;
  if (
    !Array.isArray(tramas) ||
    !Array.isArray(locais) ||
    !Array.isArray(pessoas) ||
    !Array.isArray(acervo) ||
    typeof valor.anotacoes !== "string" ||
    !ehNumeroFinito(valor.dia) ||
    !Number.isInteger(valor.dia) ||
    valor.dia < 1 ||
    valor.dia > 30 ||
    !ehNumeroFinito(valor.tensao) ||
    valor.tensao < 0 ||
    valor.tensao > 10 ||
    !ehNumeroFinito(valor.pistas) ||
    !Number.isInteger(valor.pistas) ||
    valor.pistas < 0 ||
    !idsUnicos(tramas) ||
    !idsUnicos(locais) ||
    !idsUnicos(pessoas) ||
    !idsUnicos(acervo) ||
    !tramas.every(validarTramaSavePoint) ||
    !locais.every(validarLocalSavePoint) ||
    !pessoas.every(validarPessoaSavePoint) ||
    !acervo.every(validarItemSavePoint)
  ) {
    return false;
  }
  const idsPessoas = new Set(
    pessoas.filter(validarPessoaSavePoint).map((pessoa) => pessoa.id),
  );
  const idsPessoasIniciais = new Set(estadoInicial.pessoas.map((pessoa) => pessoa.id));
  const idsLocais = new Set(
    locais.filter(validarLocalSavePoint).map((local) => local.id),
  );
  return (
    idsPessoas.size === idsPessoasIniciais.size &&
    [...idsPessoasIniciais].every((id) => idsPessoas.has(id)) &&
    estadoInicial.locais.every((local) => idsLocais.has(local.id))
  );
}

function mesclarPessoaSalva(base: PessoaCenario, pessoaSalva: unknown): PessoaCenario {
  if (!pessoaSalva || typeof pessoaSalva !== "object") return base;
  const salva = pessoaSalva as PessoaSalvaParcial;
  return {
    id: base.id,
    codigo: base.codigo,
    nome: salva.nome ?? base.nome,
    funcao: salva.funcao ?? base.funcao,
    estado: normalizarEstadoPessoa(salva.estado),
    notaPublica: salva.notaPublica ?? salva.notas ?? base.notaPublica,
    segredoMestre: salva.segredoMestre ?? base.segredoMestre,
    foto: salva.foto ?? base.foto,
    revelado: salva.revelado ?? base.revelado,
    statusRevelado: salva.statusRevelado ?? base.statusRevelado,
    fichaRevelada: salva.fichaRevelada ?? base.fichaRevelada,
    atributos: { ...base.atributos, ...salva.atributos },
    derivados: { ...base.derivados, ...salva.derivados },
    pericias: Array.isArray(salva.pericias) ? salva.pericias : base.pericias,
    vinculos: Array.isArray(salva.vinculos) ? salva.vinculos : base.vinculos,
    motivacoes: Array.isArray(salva.motivacoes) ? salva.motivacoes : base.motivacoes,
    traumas: salva.traumas ?? base.traumas,
  };
}

function migrarEstadoSalvo(dados: Partial<EstadoCenario>): EstadoCenario {
  const locaisSalvos = Array.isArray(dados.locais) ? dados.locais : [];
  const pessoasSalvas = Array.isArray(dados.pessoas) ? dados.pessoas : [];
  return {
    ...estadoInicial,
    ...dados,
    tramas: Array.isArray(dados.tramas) ? dados.tramas : estadoInicial.tramas,
    locais: [
      ...estadoInicial.locais.map((base) => {
        const salvo = locaisSalvos.find((local) => local.id === base.id);
        return salvo
          ? { ...base, ...salvo, x: base.x, y: base.y, numeroMapa: base.numeroMapa }
          : base;
      }),
      ...locaisSalvos.filter(
        (salvo) => !estadoInicial.locais.some((base) => base.id === salvo.id),
      ),
    ],
    acervo: Array.isArray(dados.acervo) ? dados.acervo : estadoInicial.acervo,
    pessoas: estadoInicial.pessoas.map((base, indice) => {
      const salva = pessoasSalvas.find((pessoa) => {
        if (!pessoa || typeof pessoa !== "object") return false;
        const dado = pessoa as Partial<PessoaCenario>;
        return dado.id === base.id || dado.codigo === base.codigo;
      }) ?? pessoasSalvas[indice];
      return mesclarPessoaSalva(base, salva);
    }),
  };
}

const guias: { id: Guia; numero: string; nome: string; icone: string }[] = [
  { id: "trama", numero: "01", nome: "Trama & dossiê", icone: "▤" },
  { id: "mapa", numero: "02", nome: "Mapa", icone: "⌖" },
  { id: "personagens", numero: "03", nome: "Personagens", icone: "♙" },
  { id: "acervo", numero: "04", nome: "Acervo do mestre", icone: "▧" },
];

const chavesPessoa: { valor: EstadoPessoa; classe: string }[] = [
  { valor: "VIVO", classe: "vivo" },
  { valor: "FERIDO", classe: "ferido" },
  { valor: "DESAPARECIDO", classe: "desaparecido" },
  { valor: "SUSPEITO", classe: "suspeito" },
  { valor: "POSSUÍDO", classe: "possuido" },
];

const chavesLocal: EstadoLocal[] = [
  "Livre",
  "Investigado",
  "Perigoso",
  "Bloqueado",
];

function iniciais(nome: string) {
  return nome
    .split(" ")
    .slice(0, 2)
    .map((parte) => parte[0])
    .join("")
    .toUpperCase();
}

function AppIcon({ nome }: { nome: string }) {
  const comuns = {
    trama: <><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v5h5M8 13h8M8 16h6" /></>,
    mapa: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>,
    personagens: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3 3 0 0 1 0 5.7M17 14c2.3.6 4 2.6 4 5" /></>,
    acervo: <><rect x="4" y="5" width="15" height="15" rx="1" /><path d="M7 3h13v14M7 16l4-4 3 3 2-2 3 3M9 9h.01" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {comuns[nome as keyof typeof comuns] ?? comuns.trama}
    </svg>
  );
}

export default function Home() {
  const perfilSalvo = useSyncExternalStore(
    observarPerfil,
    lerPerfil,
    lerPerfilNoServidor,
  );
  const personagemSalvo = useSyncExternalStore(
    observarPerfil,
    lerPersonagemSelecionado,
    lerPersonagemNoServidor,
  );
  const estadoSalvo = useSyncExternalStore(
    observarArmazenamento,
    lerArmazenamento,
    lerArmazenamentoNoServidor,
  );
  const [estadoLido, setEstadoLido] = useState<EstadoCenario>(estadoInicial);
  const [guia, setGuia] = useState<Guia>("trama");
  const [localSelecionado, setLocalSelecionado] = useState("sede");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunhoPessoa, setRascunhoPessoa] = useState<PessoaCenario | null>(null);
  const [edicaoFicha, setEdicaoFicha] = useState(false);
  const [rascunhoTrama, setRascunhoTrama] = useState<{
    id: string | null;
    titulo: string;
    descricao: string;
  } | null>(null);
  const [rascunhoItem, setRascunhoItem] = useState<RascunhoAcervo | null>(null);
  const [itemVisualizadoId, setItemVisualizadoId] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [erroPerfil, setErroPerfil] = useState("");
  const [escolhendoPersonagem, setEscolhendoPersonagem] = useState(false);
  const [cartaPersonagemId, setCartaPersonagemId] = useState<string | null>(null);
  const [presencas, setPresencas] = useState<PresencaJogador[]>([]);
  const [statusSocket, setStatusSocket] = useState<StatusSocket>("desconectado");
  const [erroSocket, setErroSocket] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const perfil: Perfil | null =
    perfilSalvo === "mestre" || perfilSalvo === "jogador" ? perfilSalvo : null;
  const modoMestre = perfil === "mestre";

  const estadoDecodificado = useMemo(() => {
    if (!estadoSalvo) return { valor: estadoInicial, erro: "" };
    if (estadoSalvo === "__ERRO_DE_ARMAZENAMENTO__") {
      return {
        valor: estadoInicial,
        erro: "Não foi possível ler o estado salvo neste navegador.",
      };
    }
    try {
      const dados = JSON.parse(estadoSalvo) as EstadoCenario;
      if (
        dados &&
        Array.isArray(dados.locais) &&
        Array.isArray(dados.pessoas) &&
        Array.isArray(dados.acervo)
      ) {
        return { valor: migrarEstadoSalvo(dados), erro: "" };
      }
      return {
        valor: estadoInicial,
        erro: "O estado salvo não está no formato esperado. Os dados iniciais foram carregados.",
      };
    } catch {
      return {
        valor: estadoInicial,
        erro: "O estado salvo está corrompido e não pôde ser carregado.",
      };
    }
  }, [estadoSalvo]);
  const estado = estadoLido === estadoInicial ? estadoDecodificado.valor : estadoLido;
  const avisoExibido = aviso || estadoDecodificado.erro;

  const locaisVisiveis = useMemo(
    () => estado.locais.filter((local) => modoMestre || local.revelado),
    [estado.locais, modoMestre],
  );
  const tramasVisiveis = useMemo(
    () => estado.tramas.filter((trama) => modoMestre || trama.revelado),
    [estado.tramas, modoMestre],
  );
  const personagemAtivo =
    perfil === "jogador"
      ? estado.pessoas.find(
          (pessoa) => pessoa.id === personagemSalvo && pessoa.revelado,
        )
      : undefined;
  const personagemIdAtivo = personagemAtivo?.id;
  const localAtual =
    locaisVisiveis.find((local) => local.id === localSelecionado) ?? locaisVisiveis[0];
  const pessoasVisiveis = estado.pessoas.filter((pessoa) => modoMestre || pessoa.revelado);
  const itensVisiveis = estado.acervo.filter((item) => modoMestre || item.revelado);
  const itemVisualizado = estado.acervo.find(
    (item) => item.id === itemVisualizadoId && (modoMestre || item.revelado),
  );
  const pessoasReveladas = estado.pessoas.filter((pessoa) => pessoa.revelado).length;
  const pistasReveladas = estado.acervo.filter((item) => item.revelado).length;

  useEffect(() => {
    if (!perfil || (perfil === "jogador" && !personagemIdAtivo)) return;
    if (usarWebSocketVercel()) {
      let interrompido = false;
      let reconectar = true;
      let tentativas = 0;
      let temporizadorReconexao: number | undefined;
      let temporizadorHeartbeat: number | undefined;
      let conexao: WebSocket | null = null;
      const chaveCliente = "estancia-do-fogo-presenca-cliente-v1";
      let clientId: string;
      try {
        clientId =
          window.sessionStorage.getItem(chaveCliente) ??
          window.crypto.randomUUID();
        window.sessionStorage.setItem(chaveCliente, clientId);
      } catch {
        clientId = window.crypto.randomUUID();
      }

      function conectar() {
        if (interrompido || !reconectar) return;
        const protocolo = window.location.protocol === "https:" ? "wss:" : "ws:";
        const novaConexao = new WebSocket(
          `${protocolo}//${window.location.host}/api/presenca`,
        );
        conexao = novaConexao;
        webSocketRef.current = novaConexao;

        novaConexao.addEventListener("open", () => {
          if (interrompido) {
            novaConexao.close();
            return;
          }
          setStatusSocket("conectado");
          setErroSocket("");
          tentativas = 0;
          novaConexao.send(
            JSON.stringify({
              type: "presenca:entrar",
              perfil,
              personagemId: perfil === "jogador" ? personagemIdAtivo : undefined,
              localId: "sede",
              clientId,
            }),
          );
          temporizadorHeartbeat = window.setInterval(() => {
            if (novaConexao.readyState === WebSocket.OPEN) {
              novaConexao.send(JSON.stringify({ type: "presenca:heartbeat" }));
            }
          }, 8_000);
        });

        novaConexao.addEventListener("message", (evento) => {
          let resposta: {
            type?: string;
            lista?: PresencaJogador[];
            mensagem?: string;
            fatal?: boolean;
          };
          try {
            resposta = JSON.parse(String(evento.data));
          } catch {
            setStatusSocket("erro");
            setErroSocket("O servidor retornou uma mensagem de presença inválida.");
            return;
          }
          if (resposta.type === "presenca:lista" && Array.isArray(resposta.lista)) {
            setPresencas(resposta.lista);
          } else if (resposta.type === "presenca:erro") {
            setStatusSocket("erro");
            setErroSocket(resposta.mensagem || "Falha ao atualizar presença.");
            if (resposta.fatal) {
              reconectar = false;
              if (temporizadorHeartbeat !== undefined) {
                window.clearInterval(temporizadorHeartbeat);
              }
              novaConexao.close();
            }
          }
        });

        novaConexao.addEventListener("error", () => {
          setStatusSocket("erro");
          setErroSocket("Não foi possível conectar ao WebSocket de presença da Vercel.");
        });

        novaConexao.addEventListener("close", () => {
          if (temporizadorHeartbeat !== undefined) {
            window.clearInterval(temporizadorHeartbeat);
            temporizadorHeartbeat = undefined;
          }
          if (webSocketRef.current === novaConexao) webSocketRef.current = null;
          if (interrompido || !reconectar) return;
          setStatusSocket("desconectado");
          const atraso = Math.min(1_000 * 2 ** tentativas, 30_000);
          tentativas += 1;
          temporizadorReconexao = window.setTimeout(
            conectar,
            atraso + Math.floor(Math.random() * 500),
          );
        });
      }

      conectar();
      return () => {
        interrompido = true;
        if (temporizadorReconexao !== undefined) {
          window.clearTimeout(temporizadorReconexao);
        }
        if (temporizadorHeartbeat !== undefined) {
          window.clearInterval(temporizadorHeartbeat);
        }
        conexao?.close();
        if (webSocketRef.current === conexao) webSocketRef.current = null;
      };
    }

    const urlSocket =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      `${window.location.protocol}//${window.location.hostname}:3001`;
    const socket = io(urlSocket);
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatusSocket("conectado");
      setErroSocket("");
      socket.emit("presenca:entrar", {
        perfil,
        personagemId: perfil === "jogador" ? personagemIdAtivo : undefined,
        localId: "sede",
      });
    });
    socket.on("disconnect", () => setStatusSocket("desconectado"));
    socket.on("connect_error", (erro: Error) => {
      setStatusSocket("erro");
      setErroSocket(erro.message);
    });
    socket.on("presenca:lista", (lista: PresencaJogador[]) => setPresencas(lista));
    socket.on("presenca:erro", (resposta: { mensagem?: string }) => {
      setStatusSocket("erro");
      setErroSocket(resposta.mensagem || "Falha ao atualizar presença.");
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [perfil, personagemIdAtivo]);

  useEffect(() => {
    if (!cartaPersonagemId) return;
    function fecharComEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") setCartaPersonagemId(null);
    }
    window.addEventListener("keydown", fecharComEscape);
    return () => window.removeEventListener("keydown", fecharComEscape);
  }, [cartaPersonagemId]);

  useEffect(() => {
    if (!itemVisualizadoId) return;
    function fecharComEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") setItemVisualizadoId(null);
    }
    window.addEventListener("keydown", fecharComEscape);
    return () => window.removeEventListener("keydown", fecharComEscape);
  }, [itemVisualizadoId]);

  function atualizarEstado(atualizador: (atual: EstadoCenario) => EstadoCenario) {
    const atualizado = atualizador(estado);
    try {
      window.localStorage.setItem(chaveArmazenamento, JSON.stringify(atualizado));
      setEstadoLido(atualizado);
      window.dispatchEvent(new Event("estancia:estado"));
      return true;
    } catch {
      setAviso("Não foi possível salvar. O armazenamento do navegador pode estar cheio.");
      return false;
    }
  }

  function salvarPerfil(novoPerfil: Perfil) {
    try {
      window.localStorage.setItem(chavePerfil, novoPerfil);
      window.dispatchEvent(new Event("estancia:perfil"));
      if (novoPerfil === "jogador") {
        setRascunhoTrama(null);
        setRascunhoItem(null);
        setItemVisualizadoId(null);
      }
      setErroPerfil("");
    } catch {
      setErroPerfil("Não foi possível salvar o perfil neste navegador.");
    }
  }

  function entrarComoJogador(personagemId: string) {
    const personagem = estado.pessoas.find(
      (pessoa) => pessoa.id === personagemId && pessoa.revelado,
    );
    if (!personagem || !cartasDeServico[personagemId]) {
      setErroPerfil("Esse convocado não está disponível para os jogadores.");
      return;
    }
    try {
      window.localStorage.setItem(chavePersonagem, personagem.id);
      window.localStorage.setItem(chavePerfil, "jogador");
      window.dispatchEvent(new Event("estancia:perfil"));
      setEscolhendoPersonagem(false);
      setCartaPersonagemId(null);
      setErroPerfil("");
    } catch {
      setErroPerfil("Não foi possível salvar o perfil e o personagem neste navegador.");
    }
  }

  function voltarParaPerfis() {
    try {
      window.localStorage.removeItem(chavePerfil);
      window.localStorage.removeItem(chavePersonagem);
      window.dispatchEvent(new Event("estancia:perfil"));
      setEscolhendoPersonagem(false);
      setErroPerfil("");
    } catch {
      setErroPerfil("Não foi possível limpar o perfil salvo neste navegador.");
    }
  }

  function selecionarLocalNoMapa(localId: string) {
    setLocalSelecionado(localId);
    if (perfil === "jogador") {
      if (usarWebSocketVercel()) {
        if (webSocketRef.current?.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(
            JSON.stringify({ type: "presenca:mover", localId }),
          );
        }
      } else if (socketRef.current?.connected) {
        socketRef.current.emit("presenca:mover", { localId });
      }
    }
  }

  function atualizarLocal(id: string, mudancas: Partial<LocalCenario>) {
    atualizarEstado((atual) => ({
      ...atual,
      locais: atual.locais.map((local) =>
        local.id === id ? { ...local, ...mudancas } : local,
      ),
    }));
  }

  function alternarRevelacaoPessoa(id: string) {
    atualizarEstado((atual) => ({
      ...atual,
      pessoas: atual.pessoas.map((pessoa) =>
        pessoa.id === id ? { ...pessoa, revelado: !pessoa.revelado } : pessoa,
      ),
    }));
  }

  function alternarRevelacaoItem(id: string) {
    if (!modoMestre) return;
    const item = estado.acervo.find((entrada) => entrada.id === id);
    if (!item) return;
    if (item.revelado) {
      if (rascunhoItem?.id === id) setRascunhoItem(null);
      if (itemVisualizadoId === id) setItemVisualizadoId(null);
    }
    atualizarEstado((atual) => ({
      ...atual,
      acervo: atual.acervo.map((item) =>
        item.id === id ? { ...item, revelado: !item.revelado } : item,
      ),
    }));
  }

  function removerItemAcervo(id: string) {
    if (!modoMestre || !estado.acervo.some((item) => item.id === id)) return;
    if (!window.confirm("Excluir este item do acervo? Esta ação não pode ser desfeita.")) {
      return;
    }
    const salvo = atualizarEstado((atual) => ({
      ...atual,
      acervo: atual.acervo.filter((item) => item.id !== id),
    }));
    if (!salvo) return;
    if (rascunhoItem?.id === id) setRascunhoItem(null);
    if (itemVisualizadoId === id) setItemVisualizadoId(null);
    setAviso("Item removido do acervo.");
  }

  function iniciarNovaTrama() {
    if (!modoMestre) return;
    setRascunhoTrama({ id: null, titulo: "", descricao: "" });
  }

  function editarTrama(trama: TramaCenario) {
    if (!modoMestre) return;
    setRascunhoTrama({
      id: trama.id,
      titulo: trama.titulo,
      descricao: trama.descricao,
    });
  }

  function salvarTrama(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!modoMestre || !rascunhoTrama) return;
    const titulo = rascunhoTrama.titulo.trim();
    if (!titulo) {
      setAviso("Informe um título para a trama.");
      return;
    }

    const tramaSalva: TramaCenario = {
      id: rascunhoTrama.id ?? `trama-${window.crypto.randomUUID()}`,
      titulo,
      descricao: rascunhoTrama.descricao.trim(),
      revelado: rascunhoTrama.id
        ? estado.tramas.find((trama) => trama.id === rascunhoTrama.id)?.revelado ?? false
        : false,
    };
    atualizarEstado((atual) => ({
      ...atual,
      tramas: rascunhoTrama.id
        ? atual.tramas.map((trama) =>
            trama.id === tramaSalva.id ? tramaSalva : trama,
          )
        : [...atual.tramas, tramaSalva],
    }));
    setRascunhoTrama(null);
    setAviso(rascunhoTrama.id ? "Trama atualizada." : "Trama criada e mantida oculta.");
  }

  function alternarRevelacaoTrama(id: string) {
    if (!modoMestre) return;
    const trama = estado.tramas.find((item) => item.id === id);
    if (!trama) return;
    if (trama.revelado && rascunhoTrama?.id === id) setRascunhoTrama(null);
    atualizarEstado((atual) => ({
      ...atual,
      tramas: atual.tramas.map((trama) =>
        trama.id === id ? { ...trama, revelado: !trama.revelado } : trama,
      ),
    }));
  }

  function removerTrama(trama: TramaCenario) {
    if (!modoMestre || !window.confirm(`Excluir a trama “${trama.titulo}”?`)) return;
    atualizarEstado((atual) => ({
      ...atual,
      tramas: atual.tramas.filter((item) => item.id !== trama.id),
    }));
    if (rascunhoTrama?.id === trama.id) setRascunhoTrama(null);
    setAviso("Trama excluída.");
  }

  async function importarTramas(evento: ChangeEvent<HTMLInputElement>) {
    const campoArquivo = evento.currentTarget;
    const arquivo = campoArquivo.files?.[0];
    campoArquivo.value = "";
    if (!arquivo || !modoMestre) return;

    let conteudo: string;
    try {
      conteudo = await arquivo.text();
    } catch (erro) {
      setAviso(
        `Não foi possível ler o arquivo: ${erro instanceof Error ? erro.message : "erro desconhecido."}`,
      );
      return;
    }

    let dadosJson: unknown;
    try {
      dadosJson = JSON.parse(conteudo) as unknown;
    } catch {
      setAviso("O arquivo selecionado não contém um JSON válido.");
      return;
    }

    const entradas = extrairTramasJson(dadosJson);
    if (!entradas) {
      setAviso(
        'Formato inválido. Use {"tramas":[{"titulo":"...", "descricao":"...", "revelado":false}]}; "titulo" é obrigatório e os outros campos são opcionais.',
      );
      return;
    }
    if (entradas.length === 0) {
      setAviso("O arquivo não contém tramas para importar.");
      return;
    }

    const novasTramas: TramaCenario[] = entradas.map((entrada) => ({
      id: `trama-${window.crypto.randomUUID()}`,
      titulo: entrada.titulo.trim(),
      descricao: entrada.descricao?.trim() ?? "",
      revelado: entrada.revelado ?? false,
    }));
    atualizarEstado((atual) => ({
      ...atual,
      tramas: [...atual.tramas, ...novasTramas],
    }));
    const quantidade = novasTramas.length;
    setAviso(
      `${quantidade} ${quantidade === 1 ? "trama importada" : "tramas importadas"}. As novas entradas foram adicionadas ao final.`,
    );
  }

  function abrirFicha(pessoa: PessoaCenario, editar = modoMestre) {
    setEditando(pessoa.id);
    setRascunhoPessoa({ ...pessoa });
    setEdicaoFicha(editar);
  }

  function salvarPessoa(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!rascunhoPessoa || !modoMestre || !edicaoFicha) return;
    atualizarEstado((atual) => ({
      ...atual,
      pessoas: atual.pessoas.map((pessoa) =>
        pessoa.id === rascunhoPessoa.id ? rascunhoPessoa : pessoa,
      ),
    }));
    setEditando(null);
    setRascunhoPessoa(null);
    setEdicaoFicha(false);
  }

  function iniciarNovoItem() {
    if (!modoMestre) return;
    setRascunhoItem({
      id: null,
      titulo: "",
      categoria: "Pista",
      descricao: "",
      imagem: "",
    });
  }

  function editarItem(item: ItemAcervo) {
    if (!modoMestre || !item.revelado) return;
    setRascunhoItem({
      id: item.id,
      titulo: item.titulo,
      categoria: item.categoria,
      descricao: item.descricao,
      imagem: item.imagem,
    });
  }

  function salvarItem(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!modoMestre || !rascunhoItem) return;
    const titulo = rascunhoItem.titulo.trim();
    if (!titulo) {
      setAviso("Informe um título para o item do acervo.");
      return;
    }
    const itemSalvo: ItemAcervo = {
      ...rascunhoItem,
      id: rascunhoItem.id ?? `item-${window.crypto.randomUUID()}`,
      titulo,
      descricao: rascunhoItem.descricao.trim(),
      revelado: rascunhoItem.id
        ? estado.acervo.find((item) => item.id === rascunhoItem.id)?.revelado ?? false
        : false,
    };
    const salvo = atualizarEstado((atual) => ({
      ...atual,
      acervo: rascunhoItem.id
        ? atual.acervo.map((item) => (item.id === itemSalvo.id ? itemSalvo : item))
        : [itemSalvo, ...atual.acervo],
    }));
    if (!salvo) return;
    setRascunhoItem(null);
    setAviso(
      rascunhoItem.id
        ? "Item do acervo atualizado."
        : "Item adicionado e bloqueado nesta tela e para os jogadores.",
    );
  }

  async function importarAcervo(evento: ChangeEvent<HTMLInputElement>) {
    const campoArquivo = evento.currentTarget;
    const arquivo = campoArquivo.files?.[0];
    campoArquivo.value = "";
    if (!arquivo || !modoMestre) return;

    let conteudo: string;
    try {
      conteudo = await arquivo.text();
    } catch (erro) {
      setAviso(
        `Não foi possível ler o arquivo: ${erro instanceof Error ? erro.message : "erro desconhecido."}`,
      );
      return;
    }

    let dadosJson: unknown;
    try {
      dadosJson = JSON.parse(conteudo) as unknown;
    } catch {
      setAviso("O arquivo selecionado não contém um JSON válido.");
      return;
    }

    const entradas = extrairAcervoJson(dadosJson);
    if (!entradas) {
      setAviso(
        'Formato inválido. Use {"acervo":[{"titulo":"...", "categoria":"Pista", "descricao":"...", "imagem":"https://...", "revelado":false}]}; título é obrigatório e os outros campos são opcionais.',
      );
      return;
    }
    if (entradas.length === 0) {
      setAviso("O arquivo não contém itens para importar.");
      return;
    }

    const novosItens: ItemAcervo[] = entradas.map((entrada) => ({
      id: `item-${window.crypto.randomUUID()}`,
      titulo: entrada.titulo.trim(),
      categoria: entrada.categoria ?? "Pista",
      descricao: entrada.descricao?.trim() ?? "",
      imagem: entrada.imagem ?? "",
      revelado: entrada.revelado ?? false,
    }));
    const salvo = atualizarEstado((atual) => ({
      ...atual,
      acervo: [...novosItens, ...atual.acervo],
    }));
    if (!salvo) return;
    const quantidade = novosItens.length;
    setAviso(
      `${quantidade} ${quantidade === 1 ? "item importado" : "itens importados"} para o acervo.`,
    );
  }

  async function importarSavePoint(evento: ChangeEvent<HTMLInputElement>) {
    const campoArquivo = evento.currentTarget;
    const arquivo = campoArquivo.files?.[0];
    campoArquivo.value = "";
    if (!arquivo || !modoMestre) return;

    let conteudo: string;
    try {
      conteudo = await arquivo.text();
    } catch (erro) {
      setAviso(
        `Não foi possível ler o arquivo: ${erro instanceof Error ? erro.message : "erro desconhecido."}`,
      );
      return;
    }

    let dadosJson: unknown;
    try {
      dadosJson = JSON.parse(conteudo) as unknown;
    } catch {
      setAviso("O arquivo selecionado não contém um JSON válido.");
      return;
    }

    if (!validarSavePoint(dadosJson)) {
      setAviso(
        "Save point inválido ou incompleto. O JSON precisa conter tramas, locais, pessoas, acervo, anotações, dia, tensão e pistas válidos.",
      );
      return;
    }
    if (lerPerfil() !== "mestre") {
      setAviso("Importação cancelada: o perfil Mestre não está ativo.");
      return;
    }
    if (
      !window.confirm(
        "Importar este save point substituirá todos os dados locais do dossiê. Deseja continuar?",
      )
    ) {
      return;
    }

    const estadoImportado = migrarEstadoSalvo(dadosJson);
    const salvo = atualizarEstado(() => estadoImportado);
    if (!salvo) return;
    setLocalSelecionado(estadoImportado.locais[0]?.id ?? "sede");
    setRascunhoTrama(null);
    setRascunhoItem(null);
    setItemVisualizadoId(null);
    setAviso("Save point importado. O estado local anterior foi substituído.");
  }

  function carregarImagem(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    if (arquivo.size > 1_200_000) {
      setAviso("A imagem precisa ter menos de 1,2 MB para caber no armazenamento local.");
      evento.target.value = "";
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => {
      const imagem = leitor.result;
      if (typeof imagem === "string") {
        setRascunhoItem((atual) => (atual ? { ...atual, imagem } : atual));
        setAviso("Imagem carregada localmente.");
      }
    };
    leitor.onerror = () => setAviso("Não foi possível carregar essa imagem.");
    leitor.readAsDataURL(arquivo);
  }

  function resetarEstado() {
    if (!window.confirm("Resetar anotações, edições e revelações para o estado inicial?")) {
      return;
    }
    setEstadoLido(estadoInicial);
    try {
      window.localStorage.setItem(chaveArmazenamento, JSON.stringify(estadoInicial));
      window.dispatchEvent(new Event("estancia:estado"));
    } catch {
      setAviso("Não foi possível salvar o estado inicial neste navegador.");
    }
    setLocalSelecionado("sede");
    setGuia("trama");
    setRascunhoItem(null);
    setItemVisualizadoId(null);
    setRascunhoTrama(null);
    setAviso("Estado inicial restaurado.");
  }

  if (!perfil && !escolhendoPersonagem) {
    return (
      <main className="login-shell">
        <div className="login-grain" />
        <section className="login-card">
          <div className="login-seal"><span>✳</span></div>
          <p className="eyebrow">DOSSIÊ DE INVESTIGAÇÃO · BR-042</p>
          <h1>Como você deseja<br /><em>acessar o dossiê?</em></h1>
          <p className="login-intro">Estância do Fogo Frio · Serra da Mantiqueira, 2026</p>
          <div className="login-rule"><span>ESCOLHA SEU NÍVEL DE ACESSO</span><i /></div>
          <button className="profile-choice" onClick={() => salvarPerfil("mestre")}>
            <span className="choice-icon">◉</span>
            <span className="choice-copy"><strong>Acesso como Mestre</strong><small>Handler · visão total, segredos e controles de revelação</small></span>
            <span className="choice-arrow">↗</span>
          </button>
          <button className="profile-choice" onClick={() => { setErroPerfil(""); setEscolhendoPersonagem(true); }}>
            <span className="choice-icon agent">◌</span>
            <span className="choice-copy"><strong>Acesso como personagem</strong><small>Agente · escolha um dos convocados já revelados</small></span>
            <span className="choice-arrow">↗</span>
          </button>
          {(erroPerfil || perfilSalvo === "__ERRO_DE_PERFIL__") && (
            <p className="login-error">{erroPerfil || "Não foi possível acessar o armazenamento deste navegador."}</p>
          )}
          <div className="login-footer"><span>CASA VILAR</span><span>ACESSO RESTRITO · 07.11</span></div>
        </section>
      </main>
    );
  }

  if (
    escolhendoPersonagem ||
    (perfil === "jogador" && !personagemAtivo)
  ) {
    const disponiveis = estado.pessoas.filter((pessoa) => pessoa.revelado);
    const personagemDaCarta = disponiveis.find(
      (pessoa) => pessoa.id === cartaPersonagemId,
    );
    const cartaDeServico = personagemDaCarta
      ? cartasDeServico[personagemDaCarta.id]
      : undefined;
    return (
      <main className="login-shell">
        <div className="login-grain" />
        <section className="login-card character-select-card">
          <div className="login-seal"><span>✳</span></div>
          <p className="eyebrow">ACESSO DE AGENTE · DOSSIÊ BR-042</p>
          <h1>Quem é o seu<br /><em>convocado?</em></h1>
          <p className="login-intro">Escolha uma pessoa revelada para representar nesta sessão.</p>
          <div className="character-choice-list">
            {disponiveis.map((pessoa, indice) => (
              <button
                className="character-choice"
                key={pessoa.id}
                onClick={() => {
                  setErroPerfil("");
                  setCartaPersonagemId(pessoa.id);
                }}
              >
                <span className={`character-choice-avatar photo-tone-${indice % 5}`}>{iniciais(pessoa.nome)}</span>
                <span className="character-choice-copy"><strong>{pessoa.nome}</strong><small>{pessoa.codigo} · {pessoa.funcao}</small></span>
                {pessoa.statusRevelado && <span className={`character-choice-status ${chavesPessoa.find((item) => item.valor === pessoa.estado)?.classe ?? ""}`}>{pessoa.estado}</span>}
                <span className="choice-arrow">↗</span>
              </button>
            ))}
          </div>
          {erroPerfil && <p className="login-error">{erroPerfil}</p>}
          <button className="back-to-profiles" onClick={voltarParaPerfis}>← Voltar à escolha de perfil</button>
        </section>
        {personagemDaCarta && cartaDeServico && (
          <div
            className="service-letter-backdrop"
            onMouseDown={(evento) => {
              if (evento.target === evento.currentTarget) setCartaPersonagemId(null);
            }}
          >
            <section
              className="service-letter"
              role="dialog"
              aria-modal="true"
              aria-labelledby="service-letter-title"
              aria-describedby="service-letter-description"
            >
              <div className="service-letter-topline">
                <span>ESTÂNCIA VILAR · PESSOAL</span>
                <span>ORDEM DE SERVIÇO</span>
              </div>
              <p className="eyebrow">COMUNICADO DE ALOJAMENTO E SERVIÇO</p>
              <h2 id="service-letter-title">{personagemDaCarta.nome}</h2>
              <p className="service-letter-role">
                {personagemDaCarta.codigo} <span>·</span> {personagemDaCarta.funcao}
              </p>
              <p className="service-letter-intro" id="service-letter-description">
                Você foi convocado para trabalhar na preparação da estância antes da próxima temporada.
                A coordenação conta com sua colaboração e com o cumprimento da escala.
              </p>
              <div className="service-letter-field">
                <span>ATRIBUIÇÕES</span>
                <p>{cartaDeServico.atribuicoes}</p>
              </div>
              <div className="service-letter-field">
                <span>DIAS E HORÁRIOS</span>
                <p>{cartaDeServico.escala}</p>
              </div>
              <div className="service-letter-field">
                <span>TRABALHO EM EQUIPE</span>
                <p>{cartaDeServico.colaboracao}</p>
              </div>
              <div className="service-letter-field restricted">
                <span>ACESSO RESTRITO</span>
                <p>{cartaDeServico.areasRestritas}</p>
              </div>
              <div className="service-letter-signature">
                <span>Atenciosamente,</span>
                <strong>Coordenação da Estância</strong>
              </div>
              {erroPerfil && <p className="login-error">{erroPerfil}</p>}
              <div className="service-letter-actions">
                <button
                  className="secondary-button"
                  onClick={() => setCartaPersonagemId(null)}
                >
                  Voltar à seleção
                </button>
                <button
                  className="primary-button"
                  onClick={() => entrarComoJogador(personagemDaCarta.id)}
                >
                  Entrar como {personagemDaCarta.nome.split(" ")[0]}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>✳</span></div>
          <div>
            <p className="eyebrow">Arquivo de investigação</p>
            <p className="brand-name">CASA <span>VILAR</span></p>
          </div>
        </div>

        <div className="case-label">
          <span className="case-dot" />
          <span>DOSSIÊ 07.11 / SIGILO</span>
        </div>

        <nav className="main-nav" aria-label="Guias do dossiê">
          <p className="nav-heading">CADERNO DE CAMPO</p>
          {guias.map((item) => (
            <button
              className={`nav-item ${guia === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setGuia(item.id)}
              aria-current={guia === item.id ? "page" : undefined}
            >
              <span className="nav-icon"><AppIcon nome={item.id} /></span>
              <span className="nav-name">{item.nome}</span>
              <span className="nav-number">{item.numero}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-file">
          <div className="file-topline"><span>OPERAÇÃO</span><span>BR-042</span></div>
          <p className="file-title">Estância do<br />Fogo Frio</p>
          <div className="file-rule" />
          <p className="file-meta">LOCALIZAÇÃO</p>
          <p className="file-detail">Serra da Mantiqueira, MG</p>
          <p className="file-meta">STATUS</p>
          <p className="file-detail"><span className="status-live" /> Isolamento em curso</p>
        </div>

        <div className="sidebar-bottom">
          <span className="seal">DG</span>
          <div><p>ACESSO RESTRITO</p><small>Distribuição controlada</small></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>CASOS</span><span className="crumb-slash">/</span><span>ESTÂNCIA DO FOGO FRIO</span></div>
          <div className="topbar-actions">
            {modoMestre && (
              <div className="session-indicators">
                <span><i className="indicator-dot muted" /> DIA {String(estado.dia).padStart(2, "0")}</span>
                <span><i className="indicator-dot flame" /> TENSÃO {estado.tensao}/10</span>
              </div>
            )}
            {personagemAtivo && <span className="active-agent-chip">{personagemAtivo.codigo} · {personagemAtivo.nome}</span>}
            <span className={`socket-indicator ${statusSocket}`} title={erroSocket || "Presença em tempo real"}>
              <i />{statusSocket === "conectado" ? `${presencas.length} no mapa` : statusSocket === "erro" ? "Socket indisponível" : "Conectando"}
            </span>
            <button
              className="profile-switch"
              onClick={() => salvarPerfil(modoMestre ? "jogador" : "mestre")}
              title="Alternar entre os perfis de Mestre e Jogador"
            >
              Trocar perfil <strong>{modoMestre ? "Mestre → Jogador" : "Jogador → Mestre"}</strong>
            </button>
            {modoMestre && <button className="reset-button" onClick={resetarEstado} title="Restaurar todos os dados iniciais" aria-label="Resetar estado inicial">↺</button>}
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="section-kicker"><span className="kicker-line" /> CADERNO DE INVESTIGAÇÃO <span className="kicker-line" /></div>
              <h1>{guias.find((item) => item.id === guia)?.nome}</h1>
              <p className="page-subtitle">
                {modoMestre
                  ? "Registros internos · acesso restrito ao Guardião"
                  : "Material compartilhado · visão dos investigadores"}
              </p>
            </div>
            <div className={`visibility-stamp ${modoMestre ? "master" : "player"}`}>
              <span className="stamp-icon">{modoMestre ? "◉" : "○"}</span>
              <div><strong>{modoMestre ? "VISÃO DO MESTRE" : "VISÃO DOS JOGADORES"}</strong><small>{modoMestre ? "Todos os arquivos" : "Somente revelado"}</small></div>
            </div>
          </div>

          {avisoExibido && <div className="notice" role="status"><span>i</span>{avisoExibido}<button onClick={() => setAviso("")} aria-label="Fechar aviso">×</button></div>}

          <div className="tab-strip" role="tablist" aria-label="Guias">
            {guias.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={guia === item.id}
                className={`tab-button ${guia === item.id ? "active" : ""}`}
                onClick={() => setGuia(item.id)}
              >
                <AppIcon nome={item.id} /><span>{item.nome}</span>
                {item.id === "acervo" && modoMestre && <b className="tab-count">{estado.acervo.length}</b>}
              </button>
            ))}
          </div>

          {guia === "trama" && (
            <section className="view-panel dossier-view">
              <div className="dossier-grid">
                <div className="story-main">
                  <div className="section-title-row">
                    <div><p className="eyebrow">RELATÓRIO DE SITUAÇÃO · 01</p><h2>Um mês longe de tudo.</h2></div>
                    <span className="document-mark">CONFIDENCIAL</span>
                  </div>
                  <p className="premise">
                    Dez pessoas foram chamadas para preparar uma antiga estância para a temporada.
                    O hotel fecha por um mês para reformas; a estrada, quase intransitável, será
                    bloqueada pela chuva. Na primeira noite, alguém encontra páginas escondidas.
                    Na segunda, o fogo começa a responder.
                  </p>
                  <div className="story-separator"><span>LINHAS DE INVESTIGAÇÃO</span><i /></div>
                  {modoMestre && (
                    <div className="plot-manager">
                      <div className="plot-manager-actions">
                        <label className="plot-import-button">
                          <span aria-hidden="true">↑</span> Importar JSON
                          <input
                            type="file"
                            accept=".json,application/json"
                            onChange={(evento) => void importarTramas(evento)}
                          />
                        </label>
                        <button className="primary-button" type="button" onClick={iniciarNovaTrama}>
                          <span>＋</span> Nova trama
                        </button>
                      </div>
                      <p className="plot-json-hint">
                        O JSON deve conter <code>{"{ \"tramas\": [{ \"titulo\": \"...\", \"descricao\": \"...\", \"revelado\": false }] }"}</code>.
                        Importar adiciona os itens ao final; por padrão, ficam ocultos.
                      </p>
                    </div>
                  )}
                  {modoMestre && rascunhoTrama && (
                    <form className="plot-editor" onSubmit={salvarTrama}>
                      <div className="form-heading">
                        <div>
                          <p className="eyebrow">EDIÇÃO DE DOSSIÊ</p>
                          <h3>{rascunhoTrama.id ? "Editar trama" : "Nova trama"}</h3>
                        </div>
                        <button
                          className="close-button"
                          type="button"
                          aria-label="Cancelar edição"
                          onClick={() => setRascunhoTrama(null)}
                        >
                          ×
                        </button>
                      </div>
                      <label className="field-label">
                        Título
                        <input
                          autoFocus
                          required
                          value={rascunhoTrama.titulo}
                          onChange={(evento) =>
                            setRascunhoTrama((atual) =>
                              atual ? { ...atual, titulo: evento.target.value } : atual,
                            )
                          }
                          placeholder="Título da trama"
                        />
                      </label>
                      <label className="field-label">
                        Descrição
                        <textarea
                          value={rascunhoTrama.descricao}
                          onChange={(evento) =>
                            setRascunhoTrama((atual) =>
                              atual ? { ...atual, descricao: evento.target.value } : atual,
                            )
                          }
                          placeholder="Detalhes, pistas e acontecimentos..."
                        />
                      </label>
                      <div className="plot-editor-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setRascunhoTrama(null)}
                        >
                          Cancelar
                        </button>
                        <button className="primary-button" type="submit">
                          Salvar trama <span>↗</span>
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="plot-axes">
                    {tramasVisiveis.map((trama, index) => {
                      const bloqueada = modoMestre && !trama.revelado;
                      return (
                        <article
                          className={`plot-axis ${bloqueada ? "is-screen-hidden" : ""}`}
                          key={trama.id}
                        >
                          <span className="axis-index">
                            {bloqueada ? "••" : String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="axis-symbol">
                            {bloqueada ? "⊘" : ["⌁", "◌", "†"][index % 3]}
                          </span>
                          <div className="plot-copy">
                            {bloqueada ? (
                              <>
                                <h3>Conteúdo oculto</h3>
                                <p>Este trecho está bloqueado nesta tela.</p>
                              </>
                            ) : (
                              <>
                                <h3>{trama.titulo}</h3>
                                {trama.descricao && <p>{trama.descricao}</p>}
                              </>
                            )}
                            {modoMestre && (
                              <span
                                className={`plot-visibility ${trama.revelado ? "released" : "locked"}`}
                              >
                                {trama.revelado
                                  ? "VISÍVEL PARA TODOS"
                                  : "BLOQUEADO NESTA TELA"}
                              </span>
                            )}
                          </div>
                          {modoMestre ? (
                            <div className="plot-item-actions">
                              <button
                                className={`plot-eye-button ${trama.revelado ? "is-visible" : ""}`}
                                type="button"
                                onClick={() => alternarRevelacaoTrama(trama.id)}
                                aria-label={
                                  trama.revelado
                                    ? "Ocultar trama nesta tela e dos jogadores"
                                    : "Mostrar trama nesta tela e para os jogadores"
                                }
                                title={
                                  trama.revelado
                                    ? "Bloquear nesta tela e para os jogadores"
                                    : "Reexibir nesta tela e para os jogadores"
                                }
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
                                  <circle cx="12" cy="12" r="2.5" />
                                  {!trama.revelado && <path d="M3 3 21 21" />}
                                </svg>
                              </button>
                              {!bloqueada && (
                                <>
                                  <button
                                    className="plot-edit-button"
                                    type="button"
                                    onClick={() => editarTrama(trama)}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    className="plot-delete-button"
                                    type="button"
                                    onClick={() => removerTrama(trama)}
                                    aria-label={`Excluir trama ${trama.titulo}`}
                                    title="Excluir trama"
                                  >
                                    ×
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="axis-arrow">↗</span>
                          )}
                        </article>
                      );
                    })}
                    {tramasVisiveis.length === 0 && (
                      <p className="plot-empty">
                        {modoMestre
                          ? "Nenhuma trama cadastrada. Importe um JSON ou crie a primeira."
                          : "Nenhuma linha de investigação foi liberada."}
                      </p>
                    )}
                  </div>
                  <div className="story-footnote"><span>✳</span> A chama não ilumina este lugar. Ela o reconhece.</div>
                </div>

                <aside className="story-side">
                  <div className="side-card current-status">
                    <div className="card-overline"><span>ESTADO DA OPERAÇÃO</span><span className="live-dot" /></div>
                    <div className="day-counter"><span>DIA</span><strong>{String(estado.dia).padStart(2, "0")}</strong><small>de 30</small></div>
                    {modoMestre ? (
                      <>
                        <label className="field-label" htmlFor="dia">Etapa do isolamento</label>
                        <input id="dia" className="number-input" type="number" min="1" max="30" value={estado.dia} onChange={(e) => atualizarEstado((atual) => ({ ...atual, dia: Math.min(30, Math.max(1, Number(e.target.value))) }))} />
                        <label className="field-label range-label" htmlFor="tensao">Tensão da equipe <strong>{estado.tensao}/10</strong></label>
                        <input id="tensao" className="range-input" type="range" min="0" max="10" value={estado.tensao} onChange={(e) => atualizarEstado((atual) => ({ ...atual, tensao: Number(e.target.value) }))} />
                        <label className="field-label" htmlFor="pistas">Pistas descobertas</label>
                        <input id="pistas" className="number-input" type="number" min="0" value={estado.pistas} onChange={(e) => atualizarEstado((atual) => ({ ...atual, pistas: Math.max(0, Number(e.target.value)) }))} />
                      </>
                    ) : (
                      <p className="player-note">A equipe está isolada. A estrada segue fechada.</p>
                    )}
                  </div>
                  <div className="side-card notes-card">
                    <div className="notes-heading"><div><p className="eyebrow">REGISTRO PRIVADO</p><h3>Notas da sessão</h3></div><span className="pencil-icon">✎</span></div>
                    {modoMestre ? (
                      <textarea
                        aria-label="Notas da sessão"
                        value={estado.anotacoes}
                        onChange={(e) => atualizarEstado((atual) => ({ ...atual, anotacoes: e.target.value }))}
                        placeholder="Registre acontecimentos, decisões e pontas soltas..."
                      />
                    ) : <p className="locked-note">◆ Anotações do Guardião não compartilhadas.</p>}
                    <div className="autosave"><span className="save-dot" /> Salvamento local automático</div>
                  </div>
                  {modoMestre && (
                    <div className="quick-stats">
                      <div><strong>{estado.locais.filter((local) => local.revelado).length}<small>/{estado.locais.length}</small></strong><span>locais revelados</span></div>
                      <div><strong>{pessoasReveladas}<small>/{estado.pessoas.length}</small></strong><span>pessoas visíveis</span></div>
                      <div><strong>{pistasReveladas}<small>/{estado.acervo.length}</small></strong><span>itens liberados</span></div>
                    </div>
                  )}
                </aside>
              </div>
            </section>
          )}

          {guia === "mapa" && (
            <section className="view-panel map-view">
              <div className="map-toolbar">
                <div><p className="eyebrow">CARTOGRAFIA ILUSTRADA · ESTÂNCIA VILAR</p><h2>Território & arredores</h2></div>
                <div className="map-toolbar-side">
                  <div className="map-legend"><span><i className="legend-dot safe" /> Investigado</span><span><i className="legend-dot threat" /> Perigoso</span>{modoMestre && <span><i className="legend-dot hidden" /> Oculto</span>}<span className="online-count"><i /> {presencas.length} no mapa</span></div>
                  {!modoMestre && personagemAtivo && <p className="map-instruction">Você joga como <strong>{personagemAtivo.codigo}</strong> · clique no local onde está seu personagem.</p>}
                  {erroSocket && <p className="socket-error" role="status">{erroSocket}</p>}
                </div>
              </div>
              <div className="map-layout">
                <div className="map-canvas-scroll">
                  <div className="map-canvas" role="group" aria-label="Mapa interativo da estância">
                    <Image
                      className="map-artwork"
                      src="/mapa-estancia-v2.jpg"
                      alt="Mapa ilustrado da Estância Vilar"
                      fill
                      sizes="(max-width: 820px) 100vw, 60vw"
                    />
                    {locaisVisiveis.map((local) => (
                    <button
                      key={local.id}
                      className={`map-pin ${local.estado.toLowerCase()} ${local.numeroMapa ? "" : "sem-numero"} ${localSelecionado === local.id ? "selected" : ""}`}
                      style={{ left: `${local.x}%`, top: `${local.y}%` }}
                      onClick={() => selecionarLocalNoMapa(local.id)}
                      aria-label={`${local.numeroMapa ? `Ponto ${local.numeroMapa}: ` : ""}${local.nome}${!local.revelado ? ", oculto" : ""}`}
                      title={local.nome}
                    >
                      {presencas.filter((presenca) => presenca.localId === local.id).length > 0 && (
                        <span className="pin-occupants">
                          {presencas.filter((presenca) => presenca.localId === local.id).map((presenca) => (
                            <span className="pin-agent" key={presenca.socketId} title={`${presenca.codigo} · ${presenca.nome}`}>{presenca.codigo.slice(-2)}</span>
                          ))}
                        </span>
                      )}
                    </button>
                  ))}
                  </div>
                </div>
                <aside className="location-panel">
                  {localAtual ? (
                    <>
                      <div className="location-photo"><span className="photo-cross">✳</span><span className="photo-caption">ARQUIVO DE CAMPO · {localAtual.id.toUpperCase()}</span></div>
                      <div className="location-info">
                        <div className="location-overline"><span>{localAtual.categoria}</span><span className={`status-chip ${localAtual.estado.toLowerCase()}`}>{localAtual.estado}</span></div>
                        <h3>{localAtual.nome}</h3>
                        <p>{localAtual.descricao}</p>
                        {presencas.filter((presenca) => presenca.localId === localAtual.id).length > 0 && (
                          <div className="location-presence">
                            <span className="eyebrow">PRESENTES NESTE LOCAL</span>
                            {presencas.filter((presenca) => presenca.localId === localAtual.id).map((presenca) => (
                              <span key={presenca.socketId}><i />{presenca.codigo} · {presenca.nome}</span>
                            ))}
                          </div>
                        )}
                        {modoMestre && (
                          <div className="location-controls">
                            <label className="field-label" htmlFor="estado-local">Estado do local</label>
                            <select id="estado-local" value={localAtual.estado} onChange={(e) => atualizarLocal(localAtual.id, { estado: e.target.value as EstadoLocal })}>
                              {chavesLocal.map((estadoLocal) => <option key={estadoLocal}>{estadoLocal}</option>)}
                            </select>
                            <button className={`reveal-button ${localAtual.revelado ? "is-visible" : ""}`} onClick={() => atualizarLocal(localAtual.id, { revelado: !localAtual.revelado })}>
                              <span>{localAtual.revelado ? "◉" : "⊘"}</span>{localAtual.revelado ? "Visível aos jogadores" : "Oculto dos jogadores"}
                            </button>
                          </div>
                        )}
                        {!modoMestre && <div className="player-disclosure">LOCAL REVELADO · REGISTRO COMPARTILHADO</div>}
                      </div>
                    </>
                  ) : <div className="empty-panel">Nenhum local revelado neste mapa.</div>}
                </aside>
              </div>
              <section className="who-is-who" aria-labelledby="who-is-who-title">
                <div className="who-is-who-heading">
                  <div>
                    <p className="eyebrow">ELENCO & PRESENÇA</p>
                    <h2 id="who-is-who-title">Quem é quem <span>{pessoasVisiveis.length.toString().padStart(2, "0")}</span></h2>
                  </div>
                  <p>{presencas.length} {presencas.length === 1 ? "convocado conectado" : "convocados conectados"}</p>
                </div>
                <div className="who-is-who-grid">
                  {pessoasVisiveis.map((pessoa) => {
                    const presenca = presencas.find(
                      (item) => item.personagemId === pessoa.id,
                    );
                    const nomeLocal = presenca
                      ? locaisVisiveis.find((local) => local.id === presenca.localId)?.nome
                      : undefined;
                    const statusPessoa = chavesPessoa.find(
                      (item) => item.valor === pessoa.estado,
                    );
                    return (
                      <article
                        className={`who-card ${presenca ? "online" : ""}`}
                        key={pessoa.id}
                      >
                        <div className="who-card-avatar">{iniciais(pessoa.nome)}</div>
                        <div className="who-card-copy">
                          <div className="who-card-topline">
                            <span>{pessoa.codigo}</span>
                            <span className={`who-presence ${presenca ? "online" : ""}`}>
                              <i />{presenca ? "NO MAPA" : "SEM CONEXÃO"}
                            </span>
                          </div>
                          <h3>{pessoa.nome}</h3>
                          <p>{pessoa.funcao}</p>
                          <span className="who-card-location">
                            {presenca ? nomeLocal ?? "Local não identificado" : "Aguardando conexão"}
                          </span>
                          {(modoMestre || pessoa.statusRevelado) && (
                            <span className={`who-card-status ${statusPessoa?.classe ?? ""}`}>
                              {pessoa.estado}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
              <div className="map-footer"><span>COORDENADAS APROXIMADAS · USO INTERNO</span><span>ESTÂNCIA VILAR / SETOR SERRA</span></div>
            </section>
          )}

          {guia === "personagens" && (
            <section className="view-panel cast-view">
              <div className="content-toolbar">
                <div><p className="eyebrow">FICHA DE PESSOAL · EQUIPE DE PREPARAÇÃO</p><h2>Os convocados <span>{pessoasVisiveis.length.toString().padStart(2, "0")}</span></h2></div>
                <p className="toolbar-note">{modoMestre ? "Dez nomes. Um mês sem contato externo." : "Pessoas atualmente conhecidas pela equipe."}</p>
              </div>
              <div className="cast-grid">
                {pessoasVisiveis.map((pessoa, index) => {
                  const estadoVisual = chavesPessoa.find((item) => item.valor === pessoa.estado);
                  return (
                    <article className="person-card" key={pessoa.id}>
                      <div className={`person-photo photo-tone-${index % 5}`} style={pessoa.foto ? { backgroundImage: `linear-gradient(180deg, transparent 40%, rgba(12, 14, 12, .65)), url("${pessoa.foto}")` } : undefined}>
                        {!pessoa.foto && <span>{iniciais(pessoa.nome)}</span>}
                        <span className="photo-id">{pessoa.codigo}</span>
                        {(modoMestre || pessoa.statusRevelado) && (
                          <span className={`person-status ${estadoVisual?.classe ?? ""}`}><i />{pessoa.estado}</span>
                        )}
                      </div>
                      <div className="person-content">
                        <div className="person-heading"><div><h3>{pessoa.nome}</h3><p>{pessoa.funcao}</p></div><span className="person-mark">✳</span></div>
                        <p className="person-note">{pessoa.notaPublica}</p>
                        <div className="person-actions">
                            <button className="edit-person" onClick={() => abrirFicha(pessoa)}>{modoMestre ? "Editar ficha" : "Ver ficha"} <span>↗</span></button>
                            {modoMestre && (
                            <button className={`mini-visibility ${pessoa.revelado ? "on" : ""}`} onClick={() => alternarRevelacaoPessoa(pessoa.id)} aria-label={pessoa.revelado ? "Ocultar dos jogadores" : "Revelar aos jogadores"} title={pessoa.revelado ? "Visível aos jogadores" : "Oculto dos jogadores"}>{pessoa.revelado ? "◉" : "⊘"}</button>
                            )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {modoMestre && <div className="cast-footnote"><span>◆</span> As informações acima são registros internos. Controle individualmente o que será compartilhado.</div>}
            </section>
          )}

          {guia === "acervo" && (
            <section className="view-panel archive-view">
              <div className="content-toolbar">
                <div><p className="eyebrow">ANEXOS · PROVAS · MATERIAL RECUPERADO</p><h2>Acervo <span>{itensVisiveis.length.toString().padStart(2, "0")}</span></h2></div>
                {modoMestre && (
                  <div className="archive-toolbar-actions">
                    <label className="plot-import-button">
                      <span aria-hidden="true">↧</span> Importar save point
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={(evento) => void importarSavePoint(evento)}
                      />
                    </label>
                    <label className="plot-import-button">
                      <span aria-hidden="true">↑</span> Importar itens JSON
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={(evento) => void importarAcervo(evento)}
                      />
                    </label>
                    <button className="primary-button" type="button" onClick={iniciarNovoItem}>
                      <span>＋</span> Adicionar ao acervo
                    </button>
                  </div>
                )}
              </div>
              {modoMestre && (
                <div className="archive-import-hints">
                  <p className="plot-json-hint archive-json-hint">
                    Save point completo: JSON com <code>{"{ \"tramas\": [], \"locais\": [], \"pessoas\": [], \"acervo\": [], \"anotacoes\": \"\", \"dia\": 1, \"tensao\": 0, \"pistas\": 0 }"}</code>.
                    Substitui todo o estado local após confirmação.
                  </p>
                  <p className="plot-json-hint archive-json-hint">
                    Para adicionar somente itens: <code>{"{ \"acervo\": [{ \"titulo\": \"...\", \"categoria\": \"Pista\", \"descricao\": \"...\", \"imagem\": \"https://...\", \"revelado\": false }] }"}</code>.
                    Também aceita uma lista na raiz; novos itens ficam bloqueados por padrão.
                  </p>
                </div>
              )}
              {modoMestre && rascunhoItem && (
                <form className="add-item-form" onSubmit={salvarItem}>
                  <div className="form-heading">
                    <div>
                      <p className="eyebrow">NOVO MATERIAL</p>
                      <h3>{rascunhoItem.id ? "Editar item" : "Registrar item"}</h3>
                    </div>
                    <button
                      type="button"
                      className="close-button"
                      onClick={() => setRascunhoItem(null)}
                      aria-label="Fechar edição"
                    >
                      ×
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field-label">
                      Título
                      <input
                        required
                        value={rascunhoItem.titulo}
                        onChange={(evento) =>
                          setRascunhoItem((atual) =>
                            atual ? { ...atual, titulo: evento.target.value } : atual,
                          )
                        }
                        placeholder="Ex.: Foto no corredor norte"
                      />
                    </label>
                    <label className="field-label">
                      Tipo
                      <select
                        value={rascunhoItem.categoria}
                        onChange={(evento) =>
                          setRascunhoItem((atual) =>
                            atual
                              ? {
                                  ...atual,
                                  categoria: evento.target.value as ItemAcervo["categoria"],
                                }
                              : atual,
                          )
                        }
                      >
                        <option>Fotografia</option>
                        <option>Documento</option>
                        <option>Pista</option>
                      </select>
                    </label>
                    <label className="field-label span-two">
                      Descrição
                      <textarea
                        value={rascunhoItem.descricao}
                        onChange={(evento) =>
                          setRascunhoItem((atual) =>
                            atual ? { ...atual, descricao: evento.target.value } : atual,
                          )
                        }
                        placeholder="O que os investigadores encontram?"
                      />
                    </label>
                    <label className="field-label span-two">
                      Imagem por URL
                      <input
                        type="url"
                        value={rascunhoItem.imagem.startsWith("data:") ? "" : rascunhoItem.imagem}
                        onChange={(evento) =>
                          setRascunhoItem((atual) =>
                            atual ? { ...atual, imagem: evento.target.value } : atual,
                          )
                        }
                        placeholder="https://..."
                      />
                    </label>
                    <label className="upload-field span-two">ou escolha um arquivo local<input type="file" accept="image/*" onChange={carregarImagem} /><span>JPG, PNG ou WEBP · até 1,2 MB</span></label>
                  </div>
                  {rascunhoItem.imagem.startsWith("data:") && (
                    <div className="archive-image-status">
                      Imagem local anexada
                      <button
                        type="button"
                        className="plot-edit-button"
                        onClick={() =>
                          setRascunhoItem((atual) => (atual ? { ...atual, imagem: "" } : atual))
                        }
                      >
                        Remover imagem
                      </button>
                    </div>
                  )}
                  <div className="form-actions">
                    <span>
                      {rascunhoItem.id
                        ? "A visibilidade atual será mantida."
                        : "O novo item começa bloqueado nesta tela e para os jogadores."}
                    </span>
                    <button className="primary-button" type="submit">
                      {rascunhoItem.id ? "Salvar alterações" : "Salvar no acervo"} <span>↗</span>
                    </button>
                  </div>
                </form>
              )}
              {itensVisiveis.length > 0 ? (
                <div className="archive-grid">
                  {itensVisiveis.map((item, index) => (
                    <article
                      className={`archive-card ${modoMestre && !item.revelado ? "archive-hidden" : ""}`}
                      key={item.id}
                    >
                      {modoMestre && !item.revelado ? (
                        <>
                          <div className="archive-cover archive-cover-blocked">
                            <span className="cover-glyph">⊘</span>
                            <span className="archive-type">BLOQUEADO</span>
                          </div>
                          <div className="archive-details">
                            <div className="archive-locked-copy">
                              <strong>Conteúdo ocultado nesta tela</strong>
                              <p>O material está bloqueado para a transmissão.</p>
                            </div>
                            <div className="archive-hidden-actions">
                              <button
                                className="archive-unlock-button"
                                type="button"
                                onClick={() => alternarRevelacaoItem(item.id)}
                                aria-label="Reexibir conteúdo nesta tela e para os jogadores"
                              >
                                <span>◉</span> Reexibir material
                              </button>
                              <button
                                className="plot-delete-button"
                                type="button"
                                onClick={() => removerItemAcervo(item.id)}
                                aria-label="Excluir item do acervo"
                                title="Excluir item do acervo"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            className={`archive-cover cover-${index % 4}`}
                            style={
                              item.imagem
                                ? {
                                    backgroundImage: `linear-gradient(180deg, rgba(10,12,10,.05), rgba(10,12,10,.48)), url("${item.imagem}")`,
                                  }
                                : undefined
                            }
                          >
                            {!item.imagem && (
                              <>
                                <span className="cover-glyph">
                                  {item.categoria === "Fotografia"
                                    ? "▧"
                                    : item.categoria === "Documento"
                                      ? "≋"
                                      : "†"}
                                </span>
                                <span className="cover-caption">
                                  {item.categoria === "Fotografia"
                                    ? "NEGATIVO · 35 MM"
                                    : item.categoria === "Documento"
                                      ? "PAPEL RECUPERADO"
                                      : "EVIDÊNCIA · NÍVEL 02"}
                                </span>
                              </>
                            )}
                            <span className="archive-type">{item.categoria}</span>
                          </div>
                          <div className="archive-details">
                            <div className="archive-title-row">
                              <h3>{item.titulo}</h3>
                              <span className="archive-index">#{String(index + 1).padStart(2, "0")}</span>
                            </div>
                            <p>{item.descricao}</p>
                            <div className="archive-card-actions">
                              <button
                                className="archive-action-button"
                                type="button"
                                onClick={() => setItemVisualizadoId(item.id)}
                              >
                                Visualizar
                              </button>
                              {modoMestre && (
                                <>
                                  <button
                                    className="archive-action-button"
                                    type="button"
                                    onClick={() => editarItem(item)}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    className={`plot-eye-button ${item.revelado ? "is-visible" : ""}`}
                                    type="button"
                                    onClick={() => alternarRevelacaoItem(item.id)}
                                    aria-label="Bloquear conteúdo nesta tela e para os jogadores"
                                    title="Bloquear conteúdo nesta tela e para os jogadores"
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
                                      <circle cx="12" cy="12" r="2.5" />
                                    </svg>
                                  </button>
                                  <button
                                    className="plot-delete-button"
                                    type="button"
                                    onClick={() => removerItemAcervo(item.id)}
                                    aria-label="Excluir item do acervo"
                                    title="Excluir item do acervo"
                                  >
                                    ×
                                  </button>
                                </>
                              )}
                            </div>
                            {!modoMestre && (
                              <span className="shared-label"><i /> MATERIAL COMPARTILHADO</span>
                            )}
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              ) : <div className="empty-archive"><span>⊘</span><h3>Nenhum material liberado</h3><p>O Guardião ainda não compartilhou provas com a equipe.</p></div>}
            </section>
          )}

          <footer className="page-footer"><span>ESTÂNCIA VILAR <i>·</i> ARQUIVO DE CAMPO BR-042</span><span>{modoMestre ? "DOCUMENTO CONFIDENCIAL" : "REGISTRO COMPARTILHADO"} <i>·</i> ARQUIVO LOCAL ATIVO</span></footer>
        </div>
      </section>

      {editando && rascunhoPessoa && (
        <div
          className="modal-backdrop"
          onMouseDown={(evento) => {
            if (evento.target === evento.currentTarget) {
              setEditando(null);
              setRascunhoPessoa(null);
              setEdicaoFicha(false);
            }
          }}
        >
          {modoMestre && edicaoFicha ? (
            <form className="edit-modal dossier-sheet" onSubmit={salvarPessoa}>
              <div className="form-heading sheet-heading">
                <div><p className="eyebrow">ARQUIVO DE PESSOAL · {rascunhoPessoa.codigo}</p><h2>Ficha do convocado</h2></div>
                <button type="button" className="close-button" onClick={() => { setEditando(null); setRascunhoPessoa(null); setEdicaoFicha(false); }} aria-label="Fechar">×</button>
              </div>
              <section className="sheet-section identity-section">
                <div className={`sheet-portrait photo-tone-${estado.pessoas.findIndex((pessoa) => pessoa.id === rascunhoPessoa.id) % 5}`} style={rascunhoPessoa.foto ? { backgroundImage: `linear-gradient(180deg, transparent 40%, rgba(12,14,12,.65)), url("${rascunhoPessoa.foto}")` } : undefined}>
                  {!rascunhoPessoa.foto && iniciais(rascunhoPessoa.nome)}
                  <span>{rascunhoPessoa.codigo}</span>
                </div>
                <div className="identity-fields">
                  <div className="sheet-field-pair">
                    <label className="field-label">Nome<input required value={rascunhoPessoa.nome} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, nome: e.target.value })} /></label>
                    <label className="field-label">Função / ocupação<input required value={rascunhoPessoa.funcao} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, funcao: e.target.value })} /></label>
                  </div>
                  <div className="sheet-field-pair">
                    <label className="field-label">Status atual<select value={rascunhoPessoa.estado} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, estado: e.target.value as EstadoPessoa })}>{chavesPessoa.map((item) => <option key={item.valor} value={item.valor}>{item.valor}</option>)}</select></label>
                    <label className="field-label">Foto por URL<input type="url" value={rascunhoPessoa.foto} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, foto: e.target.value })} placeholder="https://..." /></label>
                  </div>
                  <label className="field-label">Notas públicas<textarea value={rascunhoPessoa.notaPublica} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, notaPublica: e.target.value })} /></label>
                  <label className="field-label secret-field">Segredo do Mestre<textarea value={rascunhoPessoa.segredoMestre} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, segredoMestre: e.target.value })} /></label>
                </div>
              </section>

              <section className="visibility-controls" aria-label="Controle de revelação">
                <span className="eyebrow">REVELAÇÃO PARA JOGADORES</span>
                <label>Identificação<button type="button" className={`switch ${rascunhoPessoa.revelado ? "checked" : ""}`} role="switch" aria-checked={rascunhoPessoa.revelado} onClick={() => setRascunhoPessoa({ ...rascunhoPessoa, revelado: !rascunhoPessoa.revelado })}><i /></button></label>
                <label>Status<button type="button" className={`switch ${rascunhoPessoa.statusRevelado ? "checked" : ""}`} role="switch" aria-checked={rascunhoPessoa.statusRevelado} onClick={() => setRascunhoPessoa({ ...rascunhoPessoa, statusRevelado: !rascunhoPessoa.statusRevelado })}><i /></button></label>
                <label>Ficha mecânica<button type="button" className={`switch ${rascunhoPessoa.fichaRevelada ? "checked" : ""}`} role="switch" aria-checked={rascunhoPessoa.fichaRevelada} onClick={() => setRascunhoPessoa({ ...rascunhoPessoa, fichaRevelada: !rascunhoPessoa.fichaRevelada })}><i /></button></label>
              </section>

              <section className="sheet-section">
                <div className="sheet-section-heading"><div><p className="eyebrow">ATRIBUTOS BASE</p><h3>Capacidades</h3></div><span>VALORES DG</span></div>
                <div className="attribute-grid">
                  {([
                    ["STR", "Força"],
                    ["CON", "Constituição"],
                    ["DEX", "Destreza"],
                    ["INT", "Inteligência"],
                    ["POW", "Poder"],
                    ["CHA", "Carisma"],
                  ] as const).map(([atributo, nome]) => (
                    <label className="stat-field" key={atributo}><span>{atributo}<small>{nome}</small></span><input type="number" min="0" max="20" value={rascunhoPessoa.atributos[atributo]} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, atributos: { ...rascunhoPessoa.atributos, [atributo]: Number(e.target.value) } })} /></label>
                  ))}
                </div>
              </section>

              <section className="sheet-section">
                <div className="sheet-section-heading"><div><p className="eyebrow">STATUS DERIVADOS</p><h3>Condição atual</h3></div><span>ATUAL / MÁXIMO</span></div>
                <div className="derived-grid">
                  {([
                    ["hpAtual", "HP atual"],
                    ["hpMaximo", "HP máximo"],
                    ["wpAtual", "WP atual"],
                    ["wpMaximo", "WP máximo"],
                    ["sanAtual", "SAN atual"],
                    ["sanInicial", "SAN inicial"],
                    ["breakingPoint", "Breaking Point"],
                  ] as const).map(([campo, rotulo]) => (
                    <label className="stat-field derived-field" key={campo}><span>{rotulo}</span><input type="number" min="0" value={rascunhoPessoa.derivados[campo]} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, derivados: { ...rascunhoPessoa.derivados, [campo]: Number(e.target.value) } })} /></label>
                  ))}
                </div>
              </section>

              <section className="sheet-section">
                <div className="sheet-section-heading"><div><p className="eyebrow">PERÍCIAS PRINCIPAIS</p><h3>Competências</h3></div><button type="button" className="inline-add" onClick={() => setRascunhoPessoa({ ...rascunhoPessoa, pericias: [...rascunhoPessoa.pericias, { nome: "Nova perícia", valor: 0 }] })}>＋ Adicionar perícia</button></div>
                <div className="skill-list">
                  {rascunhoPessoa.pericias.map((pericia, indice) => (
                    <div className="skill-row" key={`${pericia.nome}-${indice}`}><input aria-label={`Perícia ${indice + 1}`} value={pericia.nome} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, pericias: rascunhoPessoa.pericias.map((item, i) => i === indice ? { ...item, nome: e.target.value } : item) })} /><input aria-label={`Percentual ${pericia.nome}`} type="number" min="0" max="100" value={pericia.valor} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, pericias: rascunhoPessoa.pericias.map((item, i) => i === indice ? { ...item, valor: Number(e.target.value) } : item) })} /><span>%</span><button type="button" className="remove-row" onClick={() => setRascunhoPessoa({ ...rascunhoPessoa, pericias: rascunhoPessoa.pericias.filter((_, i) => i !== indice) })} aria-label={`Remover perícia ${pericia.nome}`}>×</button></div>
                  ))}
                </div>
              </section>

              <section className="sheet-section">
                <div className="sheet-section-heading"><div><p className="eyebrow">VÍNCULOS</p><h3>Conexões emocionais</h3></div><button type="button" className="inline-add" onClick={() => setRascunhoPessoa({ ...rascunhoPessoa, vinculos: [...rascunhoPessoa.vinculos, { nome: "Novo vínculo", pontuacao: 0, danificado: false }] })}>＋ Adicionar vínculo</button></div>
                <div className="bond-list">
                  {rascunhoPessoa.vinculos.map((vinculo, indice) => (
                    <div className={`bond-row ${vinculo.danificado ? "damaged" : ""}`} key={`${vinculo.nome}-${indice}`}><input aria-label={`Vínculo ${indice + 1}`} value={vinculo.nome} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, vinculos: rascunhoPessoa.vinculos.map((item, i) => i === indice ? { ...item, nome: e.target.value } : item) })} /><label className="bond-score">PONTOS<input type="number" min="0" max="15" value={vinculo.pontuacao} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, vinculos: rascunhoPessoa.vinculos.map((item, i) => i === indice ? { ...item, pontuacao: Math.min(15, Math.max(0, Number(e.target.value))) } : item) })} /></label><label className="damaged-check"><input type="checkbox" checked={vinculo.danificado} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, vinculos: rascunhoPessoa.vinculos.map((item, i) => i === indice ? { ...item, danificado: e.target.checked } : item) })} /> Danificado</label><button type="button" className="remove-row" onClick={() => setRascunhoPessoa({ ...rascunhoPessoa, vinculos: rascunhoPessoa.vinculos.filter((_, i) => i !== indice) })} aria-label={`Remover vínculo ${vinculo.nome}`}>×</button></div>
                  ))}
                </div>
              </section>

              <section className="sheet-section narrative-fields">
                <label className="field-label">Motivações<textarea value={rascunhoPessoa.motivacoes.join("\n")} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, motivacoes: e.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} placeholder="Uma motivação por linha" /></label>
                <label className="field-label">Traumas / desordens adquiridas<textarea value={rascunhoPessoa.traumas} onChange={(e) => setRascunhoPessoa({ ...rascunhoPessoa, traumas: e.target.value })} placeholder="Registre traumas ou desordens do isolamento" /></label>
              </section>

              <div className="sheet-actions"><button type="button" className="secondary-button" onClick={() => { setEditando(null); setRascunhoPessoa(null); setEdicaoFicha(false); }}>Cancelar</button><button className="primary-button" type="submit">Salvar ficha <span>↗</span></button></div>
            </form>
          ) : (
            <section className="edit-modal dossier-sheet player-sheet" aria-labelledby="player-sheet-title">
              <div className="form-heading sheet-heading">
                <div><p className="eyebrow">ARQUIVO LIBERADO · {rascunhoPessoa.codigo}</p><h2 id="player-sheet-title">{rascunhoPessoa.nome}</h2></div>
                <button type="button" className="close-button" onClick={() => { setEditando(null); setRascunhoPessoa(null); }} aria-label="Fechar ficha">×</button>
              </div>
              <div className="player-identity">
                <div className={`player-sheet-photo photo-tone-${estado.pessoas.findIndex((pessoa) => pessoa.id === rascunhoPessoa.id) % 5}`} style={rascunhoPessoa.foto ? { backgroundImage: `linear-gradient(180deg, transparent 40%, rgba(12,14,12,.65)), url("${rascunhoPessoa.foto}")` } : undefined}>
                  {!rascunhoPessoa.foto && iniciais(rascunhoPessoa.nome)}
                </div>
                <div className="player-identity-copy"><span className="player-code">{rascunhoPessoa.codigo}</span><strong>{rascunhoPessoa.funcao}</strong>{(modoMestre || rascunhoPessoa.statusRevelado) && <span className={`sheet-status ${chavesPessoa.find((item) => item.valor === rascunhoPessoa.estado)?.classe ?? ""}`}><i />{rascunhoPessoa.estado}</span>}</div>
              </div>
              <section className="public-note"><p className="eyebrow">REGISTRO PÚBLICO</p><p>{rascunhoPessoa.notaPublica}</p></section>
              {(modoMestre || rascunhoPessoa.fichaRevelada) ? (
                <>
                  <section className="sheet-section">
                    <div className="sheet-section-heading"><div><p className="eyebrow">ATRIBUTOS BASE</p><h3>Capacidades</h3></div></div>
                    <div className="attribute-grid read-only">
                      {([
                        ["STR", "Força"],
                        ["CON", "Constituição"],
                        ["DEX", "Destreza"],
                        ["INT", "Inteligência"],
                        ["POW", "Poder"],
                        ["CHA", "Carisma"],
                      ] as const).map(([atributo, nome]) => <div className="read-stat" key={atributo}><span>{atributo}<small>{nome}</small></span><strong>{rascunhoPessoa.atributos[atributo]}</strong></div>)}
                    </div>
                  </section>
                  <section className="sheet-section">
                    <div className="sheet-section-heading"><div><p className="eyebrow">STATUS DERIVADOS</p><h3>Condição atual</h3></div></div>
                    <div className="derived-readout">
                      <span>HP <strong>{rascunhoPessoa.derivados.hpAtual}/{rascunhoPessoa.derivados.hpMaximo}</strong></span>
                      <span>WP <strong>{rascunhoPessoa.derivados.wpAtual}/{rascunhoPessoa.derivados.wpMaximo}</strong></span>
                      <span>SAN <strong>{rascunhoPessoa.derivados.sanAtual}/{rascunhoPessoa.derivados.sanInicial}</strong></span>
                      <span>BREAKING POINT <strong>{rascunhoPessoa.derivados.breakingPoint}</strong></span>
                    </div>
                  </section>
                  <section className="sheet-section">
                    <div className="sheet-section-heading"><div><p className="eyebrow">PERÍCIAS PRINCIPAIS</p><h3>Competências</h3></div></div>
                    <div className="player-skill-list">{rascunhoPessoa.pericias.map((pericia, indice) => <div key={`${pericia.nome}-${indice}`}><span>{pericia.nome}</span><strong>{pericia.valor}%</strong></div>)}</div>
                  </section>
                  <section className="sheet-section">
                    <div className="sheet-section-heading"><div><p className="eyebrow">VÍNCULOS & MOTIVAÇÕES</p><h3>O que ainda importa</h3></div></div>
                    <div className="player-bonds">{rascunhoPessoa.vinculos.map((vinculo, indice) => <div key={`${vinculo.nome}-${indice}`}><span>{vinculo.nome}{vinculo.danificado && <small> · DANIFICADO</small>}</span><strong>{vinculo.pontuacao}/15</strong></div>)}</div>
                    {rascunhoPessoa.motivacoes.length > 0 && <div className="player-motivations"><h4>Motivações</h4><ul>{rascunhoPessoa.motivacoes.map((motivacao, indice) => <li key={`${motivacao}-${indice}`}>{motivacao}</li>)}</ul></div>}
                    {rascunhoPessoa.traumas && <div className="player-trauma"><h4>Traumas / desordens</h4><p>{rascunhoPessoa.traumas}</p></div>}
                  </section>
                </>
              ) : (
                <div className="locked-sheet"><span>⊘</span><p>A ficha mecânica ainda não foi liberada pelo Mestre.</p></div>
              )}
              {modoMestre && <section className="master-secret"><p className="eyebrow">SEGREDO DO MESTRE</p><p>{rascunhoPessoa.segredoMestre}</p></section>}
            </section>
          )}
        </div>
      )}

      {itemVisualizado && (
        <div
          className="modal-backdrop"
          onMouseDown={(evento) => {
            if (evento.target === evento.currentTarget) setItemVisualizadoId(null);
          }}
        >
          <section
            className="edit-modal archive-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-preview-title"
          >
            <div className="form-heading">
              <div>
                <p className="eyebrow">PRÉ-VISUALIZAÇÃO · {itemVisualizado.categoria}</p>
                <h2 id="archive-preview-title">{itemVisualizado.titulo}</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setItemVisualizadoId(null)}
                aria-label="Fechar visualização"
              >
                ×
              </button>
            </div>
            {itemVisualizado.imagem && (
              <div
                className="archive-preview-image"
                role="img"
                aria-label={itemVisualizado.titulo}
                style={{ backgroundImage: `url("${itemVisualizado.imagem}")` }}
              />
            )}
            <p className="archive-preview-description">
              {itemVisualizado.descricao || "Este item não possui descrição."}
            </p>
            {modoMestre && (
              <span className="archive-preview-status">
                {itemVisualizado.revelado
                  ? "LIBERADO PARA JOGADORES"
                  : "BLOQUEADO NESTA TELA"}
              </span>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
