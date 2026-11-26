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
  const pessoasSalvas = Array.isArray(dados.pessoas) ? dados.pessoas : [];
  return {
    ...estadoInicial,
    ...dados,
    locais: Array.isArray(dados.locais) ? dados.locais : estadoInicial.locais,
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
  const [adicionandoItem, setAdicionandoItem] = useState(false);
  const [novoItem, setNovoItem] = useState({
    titulo: "",
    categoria: "Pista" as ItemAcervo["categoria"],
    descricao: "",
    imagem: "",
  });
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

  function atualizarEstado(atualizador: (atual: EstadoCenario) => EstadoCenario) {
    const atualizado = atualizador(estado);
    setEstadoLido(atualizado);
    try {
      window.localStorage.setItem(chaveArmazenamento, JSON.stringify(atualizado));
      window.dispatchEvent(new Event("estancia:estado"));
    } catch {
      setAviso("Não foi possível salvar. O armazenamento do navegador pode estar cheio.");
    }
  }

  function salvarPerfil(novoPerfil: Perfil) {
    try {
      window.localStorage.setItem(chavePerfil, novoPerfil);
      window.dispatchEvent(new Event("estancia:perfil"));
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
    atualizarEstado((atual) => ({
      ...atual,
      acervo: atual.acervo.map((item) =>
        item.id === id ? { ...item, revelado: !item.revelado } : item,
      ),
    }));
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

  function adicionarItem(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const item: ItemAcervo = {
      ...novoItem,
      id: `item-${Date.now()}`,
      revelado: false,
    };
    atualizarEstado((atual) => ({ ...atual, acervo: [item, ...atual.acervo] }));
    setNovoItem({ titulo: "", categoria: "Pista", descricao: "", imagem: "" });
    setAdicionandoItem(false);
    setAviso("Item adicionado oculto. Libere a visibilidade quando quiser.");
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
      if (typeof leitor.result === "string") {
        setNovoItem((atual) => ({ ...atual, imagem: leitor.result as string }));
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
    setAdicionandoItem(false);
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
                  <div className="plot-axes">
                    <article className="plot-axis">
                      <span className="axis-index">01</span><span className="axis-symbol">⌁</span>
                      <div><h3>Sobreviver</h3><p>Isolamento, desgaste e uma ameaça que aprende com cada incêndio.</p></div>
                      <span className="axis-arrow">↗</span>
                    </article>
                    <article className="plot-axis">
                      <span className="axis-index">02</span><span className="axis-symbol">◌</span>
                      <div><h3>Alguém leu as páginas</h3><p>Suspeita, corrupção e a pergunta: quem abriu o que não devia?</p></div>
                      <span className="axis-arrow">↗</span>
                    </article>
                    <article className="plot-axis">
                      <span className="axis-index">03</span><span className="axis-symbol">†</span>
                      <div><h3>Achar a faca</h3><p>Uma lâmina capaz de matar demônios — se ainda estiver na propriedade.</p></div>
                      <span className="axis-arrow">↗</span>
                    </article>
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
                <div><p className="eyebrow">PLANTA ESQUEMÁTICA · ESTÂNCIA VILAR</p><h2>Território & arredores</h2></div>
                <div className="map-toolbar-side">
                  <div className="map-legend"><span><i className="legend-dot safe" /> Investigado</span><span><i className="legend-dot threat" /> Perigoso</span>{modoMestre && <span><i className="legend-dot hidden" /> Oculto</span>}<span className="online-count"><i /> {presencas.length} no mapa</span></div>
                  {!modoMestre && personagemAtivo && <p className="map-instruction">Você joga como <strong>{personagemAtivo.codigo}</strong> · clique no local onde está seu personagem.</p>}
                  {erroSocket && <p className="socket-error" role="status">{erroSocket}</p>}
                </div>
              </div>
              <div className="map-layout">
                <div className="map-canvas" aria-label="Mapa interativo da estância">
                  <div className="map-grid" />
                  <svg className="map-trails" viewBox="0 0 1000 650" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M490 310 C430 290 360 310 250 310 S190 230 170 180 M490 310 C520 350 540 410 590 400 S720 420 750 470 M490 310 C550 270 650 280 720 230 S800 190 840 170 M490 310 C460 380 460 430 590 400" />
                    <path className="trail-secondary" d="M250 310 C270 380 250 430 250 480 M750 470 C800 440 840 390 860 340 M590 400 C610 470 650 510 700 540" />
                  </svg>
                  <div className="north-mark"><span>N</span><i>↑</i></div>
                  <span className="map-label label-water">REPRESA</span>
                  <span className="map-label label-forest">MATA FECHADA</span>
                  <span className="map-label label-east">MORRO DO CEDRO</span>
                  {locaisVisiveis.map((local, index) => (
                    <button
                      key={local.id}
                      className={`map-pin ${local.estado.toLowerCase()} ${localSelecionado === local.id ? "selected" : ""}`}
                      style={{ left: `${local.x}%`, top: `${local.y}%` }}
                      onClick={() => selecionarLocalNoMapa(local.id)}
                      aria-label={`${local.nome}${!local.revelado ? ", oculto" : ""}`}
                    >
                      <span className="pin-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="pin-label">{local.nome}</span>
                      {presencas.filter((presenca) => presenca.localId === local.id).length > 0 && (
                        <span className="pin-occupants">
                          {presencas.filter((presenca) => presenca.localId === local.id).map((presenca) => (
                            <span className="pin-agent" key={presenca.socketId} title={`${presenca.codigo} · ${presenca.nome}`}>{presenca.codigo.slice(-2)}</span>
                          ))}
                        </span>
                      )}
                    </button>
                  ))}
                  <div className="map-scale"><span>0</span><i /><span>200 m</span></div>
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
                {modoMestre && <button className="primary-button" onClick={() => setAdicionandoItem((atual) => !atual)}><span>＋</span> Adicionar ao acervo</button>}
              </div>
              {modoMestre && adicionandoItem && (
                <form className="add-item-form" onSubmit={adicionarItem}>
                  <div className="form-heading"><div><p className="eyebrow">NOVO MATERIAL</p><h3>Registrar item</h3></div><button type="button" className="close-button" onClick={() => setAdicionandoItem(false)} aria-label="Fechar">×</button></div>
                  <div className="form-grid">
                    <label className="field-label">Título<input required value={novoItem.titulo} onChange={(e) => setNovoItem((atual) => ({ ...atual, titulo: e.target.value }))} placeholder="Ex.: Foto no corredor norte" /></label>
                    <label className="field-label">Tipo<select value={novoItem.categoria} onChange={(e) => setNovoItem((atual) => ({ ...atual, categoria: e.target.value as ItemAcervo["categoria"] }))}><option>Fotografia</option><option>Documento</option><option>Pista</option></select></label>
                    <label className="field-label span-two">Descrição<textarea required value={novoItem.descricao} onChange={(e) => setNovoItem((atual) => ({ ...atual, descricao: e.target.value }))} placeholder="O que os investigadores encontram?" /></label>
                    <label className="field-label span-two">Imagem por URL<input type="url" value={novoItem.imagem.startsWith("data:") ? "" : novoItem.imagem} onChange={(e) => setNovoItem((atual) => ({ ...atual, imagem: e.target.value }))} placeholder="https://..." /></label>
                    <label className="upload-field span-two">ou escolha um arquivo local<input type="file" accept="image/*" onChange={carregarImagem} /><span>JPG, PNG ou WEBP · até 1,2 MB</span></label>
                  </div>
                  <div className="form-actions"><span>Será criado oculto para os jogadores.</span><button className="primary-button" type="submit">Salvar no acervo <span>↗</span></button></div>
                </form>
              )}
              {itensVisiveis.length > 0 ? (
                <div className="archive-grid">
                  {itensVisiveis.map((item, index) => (
                    <article className={`archive-card ${!item.revelado ? "archive-hidden" : ""}`} key={item.id}>
                      <div className={`archive-cover cover-${index % 4}`} style={item.imagem ? { backgroundImage: `linear-gradient(180deg, rgba(10,12,10,.05), rgba(10,12,10,.48)), url("${item.imagem}")` } : undefined}>
                        {!item.imagem && <><span className="cover-glyph">{item.categoria === "Fotografia" ? "▧" : item.categoria === "Documento" ? "≋" : "†"}</span><span className="cover-caption">{item.categoria === "Fotografia" ? "NEGATIVO · 35 MM" : item.categoria === "Documento" ? "PAPEL RECUPERADO" : "EVIDÊNCIA · NÍVEL 02"}</span></>}
                        <span className="archive-type">{item.categoria}</span>
                      </div>
                      <div className="archive-details"><div className="archive-title-row"><h3>{item.titulo}</h3><span className="archive-index">#{String(index + 1).padStart(2, "0")}</span></div><p>{item.descricao}</p>
                        {modoMestre && <button className={`reveal-button archive-reveal ${item.revelado ? "is-visible" : ""}`} onClick={() => alternarRevelacaoItem(item.id)}><span>{item.revelado ? "◉" : "⊘"}</span>{item.revelado ? "Liberado para jogadores" : "Oculto · só mestre"}</button>}
                        {!modoMestre && <span className="shared-label"><i /> MATERIAL COMPARTILHADO</span>}
                      </div>
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
    </main>
  );
}
