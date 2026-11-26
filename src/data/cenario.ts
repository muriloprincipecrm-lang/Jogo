import type { EstadoCenario } from "@/types/cenario";
import { personagensIniciais } from "@/data/characters";

export const estadoInicial: EstadoCenario = {
  tramas: [
    {
      id: "sobreviver",
      titulo: "Sobreviver",
      descricao:
        "Isolamento, desgaste e uma ameaça que aprende com cada incêndio.",
      revelado: true,
    },
    {
      id: "paginas",
      titulo: "Alguém leu as páginas",
      descricao:
        "Suspeita, corrupção e a pergunta: quem abriu o que não devia?",
      revelado: true,
    },
    {
      id: "faca",
      titulo: "Achar a faca",
      descricao:
        "Uma lâmina capaz de matar demônios — se ainda estiver na propriedade.",
      revelado: true,
    },
  ],
  locais: [
    {
      id: "sede",
      nome: "Sede / Hotel",
      categoria: "Edificação principal",
      descricao:
        "A casa-grande foi preparada às pressas para a temporada. O cheiro de verniz novo não cobre o odor antigo que vem do assoalho.",
      estado: "Investigado",
      revelado: true,
      numeroMapa: "01",
      x: 50.1,
      y: 45.4,
    },
    {
      id: "cabana",
      nome: "Cabana da represa",
      categoria: "Construção isolada",
      descricao:
        "Uma cabana fechada há anos, escondida depois da curva do riacho. Há marcas recentes na fechadura e fuligem no lado de dentro da chaminé.",
      estado: "Bloqueado",
      revelado: false,
      numeroMapa: "02",
      x: 17.6,
      y: 25.4,
    },
    {
      id: "mata",
      nome: "Trilha da mata",
      categoria: "Área externa",
      descricao:
        "A trilha desaparece entre pinheiros altos. À noite, as árvores parecem inclinar-se na direção de quem caminha sozinho.",
      estado: "Perigoso",
      revelado: true,
      numeroMapa: "03",
      x: 34.9,
      y: 65.9,
    },
    {
      id: "galpao",
      nome: "Galpão de lenha",
      categoria: "Anexo",
      descricao:
        "Lenha empilhada até o teto, ferramentas enferrujadas e um círculo de cinzas que não estava ali ontem.",
      estado: "Livre",
      revelado: true,
      numeroMapa: "04",
      x: 76.8,
      y: 69.9,
    },
    {
      id: "porão",
      nome: "Porão da sede",
      categoria: "Subsolo",
      descricao:
        "A porta está emperrada. Do outro lado, alguma coisa arranha a madeira no ritmo de três batidas, uma pausa, três batidas.",
      estado: "Bloqueado",
      revelado: false,
      numeroMapa: "05",
      x: 60.3,
      y: 58.5,
    },
    {
      id: "capela",
      nome: "Capela em ruínas",
      categoria: "Ruína",
      descricao:
        "Restam quatro paredes cobertas de hera e um altar rachado. As marcas no altar parecem recentes, apesar da chuva.",
      estado: "Livre",
      revelado: false,
      numeroMapa: "06",
      x: 86.0,
      y: 22.5,
    },
    {
      id: "represa",
      nome: "Represa seca",
      categoria: "Área externa",
      descricao:
        "O leito de pedra está seco há décadas. Pegadas úmidas surgem na lama e terminam de repente no meio do caminho.",
      estado: "Investigado",
      revelado: true,
      numeroMapa: "07",
      x: 25.7,
      y: 45.2,
    },
  ],
  pessoas: personagensIniciais,
  acervo: [
    {
      id: "pagina-7",
      titulo: "Página arrancada — 7",
      categoria: "Documento",
      descricao:
        "Um trecho sobre nomes pronunciados diante do fogo. A margem está queimada.",
      imagem: "",
      revelado: false,
    },
    {
      id: "foto-capela",
      titulo: "A capela antes da reforma",
      categoria: "Fotografia",
      descricao:
        "Fotografia encontrada no arquivo do hotel. Há alguém parado na janela.",
      imagem: "",
      revelado: true,
    },
    {
      id: "faca",
      titulo: "Desenho de uma faca ritual",
      categoria: "Pista",
      descricao:
        "O esboço cita uma lâmina de ferro frio capaz de ferir o que o fogo não consome.",
      imagem: "",
      revelado: false,
    },
    {
      id: "bilhete",
      titulo: "Bilhete na recepção",
      categoria: "Documento",
      descricao:
        "“Não abram o que está escondido sob as tábuas. Nem mesmo para limpar.”",
      imagem: "",
      revelado: true,
    },
  ],
  anotacoes: "",
  dia: 1,
  tensao: 2,
  pistas: 0,
};
