export interface CartaDeServico {
  atribuicoes: string;
  escala: string;
  colaboracao: string;
  areasRestritas: string;
}

export const cartasDeServico: Record<string, CartaDeServico> = {
  helena: {
    atribuicoes:
      "Coordenar a equipe, distribuir tarefas e acompanhar a preparação das áreas comuns.",
    escala: "Segunda a sexta, das 8h às 17h; sábado, das 8h às 12h.",
    colaboracao:
      "Reunir os responsáveis no início do turno e compartilhar mudanças de prioridade.",
    areasRestritas:
      "Oficina e salas técnicas sem o responsável pelo setor.",
  },
  raul: {
    atribuicoes:
      "Executar reparos gerais e verificar portas, encanamento, telhados e ferramentas.",
    escala: "Segunda a sábado, das 7h às 16h; domingo, folga.",
    colaboracao:
      "Registrar materiais usados e avisar a coordenação antes de interromper uma área.",
    areasRestritas:
      "Telhados sem equipamento de segurança e áreas isoladas durante manutenção.",
  },
  ines: {
    atribuicoes:
      "Organizar a cozinha, preparar refeições da equipe e conferir o armazenamento de alimentos.",
    escala: "Terça a domingo, das 6h às 14h; segunda-feira, folga.",
    colaboracao:
      "Combinar horários das refeições com a coordenação e informar necessidades alimentares à enfermagem.",
    areasRestritas:
      "Quartos em preparação e salas técnicas, salvo solicitação de um responsável.",
  },
  marcos: {
    atribuicoes:
      "Inspecionar a instalação elétrica e reparar iluminação e tomadas das áreas de serviço.",
    escala: "Segunda a sexta, das 9h às 18h; sábado, das 9h às 12h, sob chamada.",
    colaboracao:
      "Sinalizar circuitos desligados e avisar a manutenção antes de fechar uma área.",
    areasRestritas:
      "Telhados sem equipamento de segurança e espaços técnicos fora da ordem de serviço.",
  },
  bia: {
    atribuicoes:
      "Manter o posto de primeiros socorros, organizar materiais e registrar ocorrências de saúde.",
    escala: "Segunda a sábado, das 8h às 16h; domingo, folga.",
    colaboracao:
      "Manter a coordenação informada sobre incidentes e combinar o atendimento com a equipe.",
    areasRestritas:
      "Salas técnicas e áreas em manutenção sem acompanhamento do responsável.",
  },
  davi: {
    atribuicoes:
      "Cuidar dos jardins, revisar canteiros e manter os caminhos externos em condições de uso.",
    escala: "Segunda a sábado, das 6h às 15h; domingo, folga.",
    colaboracao:
      "Informar à coordenação quais trechos foram vistoriados e pedir apoio para serviços pesados.",
    areasRestritas:
      "Trilhas externas após o pôr do sol e áreas de máquinas sem autorização.",
  },
  lara: {
    atribuicoes:
      "Fotografar os espaços preparados para o material de divulgação da próxima temporada.",
    escala: "Segunda a sexta, das 10h às 18h; sábado, das 9h às 12h, com agendamento.",
    colaboracao:
      "Confirmar com a governança quais ambientes estão prontos antes de fotografá-los.",
    areasRestritas:
      "Quartos fechados, salas técnicas e telhados sem autorização do responsável.",
  },
  joaquim: {
    atribuicoes:
      "Apoiar o preparo das refeições, organizar utensílios e manter a cozinha em ordem.",
    escala: "Quarta a segunda, das 11h às 19h; terça-feira, folga.",
    colaboracao:
      "Combinar a divisão das tarefas com a equipe da cozinha e comunicar falta de insumos.",
    areasRestritas:
      "Depósitos de produtos de limpeza e áreas técnicas fora da sua ordem de serviço.",
  },
  celia: {
    atribuicoes:
      "Preparar os quartos liberados, conferir enxoval e atualizar o inventário de limpeza.",
    escala: "Segunda a sábado, das 7h às 15h; domingo, folga.",
    colaboracao:
      "Confirmar liberações com a coordenação e avisar a manutenção sobre defeitos encontrados.",
    areasRestritas:
      "Quartos fechados sem ordem de serviço, oficina e cozinha durante o atendimento.",
  },
  tomas: {
    atribuicoes:
      "Conferir o veículo da estância e realizar os transportes de equipe e suprimentos programados.",
    escala: "Segunda a sábado, das 8h às 17h; saídas fora desse horário, somente agendadas.",
    colaboracao:
      "Confirmar passageiros e carga antes de cada saída e registrar horários de retorno.",
    areasRestritas:
      "Garagem durante manobras e estrada de acesso fora de um deslocamento autorizado.",
  },
};
