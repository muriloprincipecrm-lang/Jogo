import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estância do Fogo Frio — Arquivo de Investigação",
  description: "Dossiê de campo e controle de revelações para uma investigação de horror.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
