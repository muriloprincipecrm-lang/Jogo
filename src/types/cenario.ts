export type EstadoLocal = "Livre" | "Investigado" | "Perigoso" | "Bloqueado";
export type EstadoPessoa =
  | "VIVO"
  | "SUSPEITO"
  | "DESAPARECIDO"
  | "FERIDO"
  | "POSSUÍDO";

export type AtributoDG = "STR" | "CON" | "DEX" | "INT" | "POW" | "CHA";

export interface LocalCenario {
  id: string;
  nome: string;
  categoria: string;
  descricao: string;
  estado: EstadoLocal;
  revelado: boolean;
  x: number;
  y: number;
}

export interface PessoaCenario {
  id: string;
  codigo: string;
  nome: string;
  funcao: string;
  estado: EstadoPessoa;
  notaPublica: string;
  segredoMestre: string;
  foto: string;
  revelado: boolean;
  statusRevelado: boolean;
  fichaRevelada: boolean;
  atributos: Record<AtributoDG, number>;
  derivados: {
    hpAtual: number;
    hpMaximo: number;
    wpAtual: number;
    wpMaximo: number;
    sanAtual: number;
    sanInicial: number;
    breakingPoint: number;
  };
  pericias: { nome: string; valor: number }[];
  vinculos: { nome: string; pontuacao: number; danificado: boolean }[];
  motivacoes: string[];
  traumas: string;
}

export interface ItemAcervo {
  id: string;
  titulo: string;
  categoria: "Fotografia" | "Documento" | "Pista";
  descricao: string;
  imagem: string;
  revelado: boolean;
}

export interface EstadoCenario {
  locais: LocalCenario[];
  pessoas: PessoaCenario[];
  acervo: ItemAcervo[];
  anotacoes: string;
  dia: number;
  tensao: number;
  pistas: number;
}
